/* ============================================================
   Đăng nhập & phiên tài khoản.
   GET  /api/auth                          -> { ok, me?, googleClientId } (me nếu có phiên hợp lệ)
   POST /api/auth { action:"google-login", idToken }         -> { ok, token, ... } (xác thực Google)
   POST /api/auth { action:"login", email, password }        -> { ok, token, ... } (dự phòng: mật khẩu)
   POST /api/auth { action:"change-password", oldPassword, newPassword }  (cần phiên) -> { ok }
   Chỉ email CÓ trong danh sách tài khoản (và không bị khoá) mới vào được.
   ============================================================ */
import {
  ensureSeeded, findAccount, verifyPassword, signSession, sessionExp,
  getSession, getAccounts, putAccounts, makeCredential,
  checkPassword, PW_RULE,
  loginLockedMs, recordLoginFail, clearLoginFail,
  verifyGoogleIdToken,
  randomOtp, storeOtp, checkOtp, sendOtpEmail, otpOnCooldown,
  isGhnMail, canonicalGhnEmail,
} from "./_session";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function googleClientId(env: any): string {
  return String(env?.GOOGLE_CLIENT_ID || "");
}

export const onRequestGet = async ({ request, env }: any): Promise<Response> => {
  const gcid = googleClientId(env);
  const otpReady = !!(env?.BREVO_API_KEY && env?.OTP_FROM_EMAIL);
  const s = await getSession(request, env);
  if (!s) return json({ ok: false, googleClientId: gcid, otpReady }, 200);
  return json({ ok: true, me: { email: s.email, name: s.name, roleId: s.roleId }, googleClientId: gcid, otpReady });
};

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const b: any = await request.json().catch(() => ({}));
  const action = b?.action;

  // ---- Đăng nhập bằng Google (chính) ----
  if (action === "google-login") {
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);
    const gcid = googleClientId(env);
    if (!gcid) return json({ ok: false, error: "google_not_configured" }, 400);
    const idToken = String(b?.idToken || "");
    const gid = await verifyGoogleIdToken(idToken, gcid);
    if (!gid) return json({ ok: false, error: "google_invalid" }, 401);

    // Google đã xác thực danh tính -> chỉ cần email đó nằm trong DS tài khoản.
    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, gid.email);
    if (!acc) return json({ ok: false, error: "not_allowed" }, 403);
    if (acc.disabled) return json({ ok: false, error: "disabled" }, 403);

    const payload = { email: acc.email, roleId: acc.roleId, name: acc.name, exp: sessionExp() };
    const token = await signSession(payload, env);
    return json({ ok: true, token, email: acc.email, name: acc.name, roleId: acc.roleId });
  }

  // ---- ĐĂNG NHẬP NHANH: chỉ cần email GHN là vào (không mã, không mật khẩu) ----
  if (action === "quick-login") {
    const typed = String(b?.email || "").trim().toLowerCase();
    if (!typed) return json({ ok: false, error: "missing" }, 400);
    if (!isGhnMail(typed)) return json({ ok: false, error: "not_ghn" }, 403);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    const canon = canonicalGhnEmail(typed);
    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, canon);
    // Chỉ tài khoản ĐÃ ĐƯỢC DUYỆT trong mục Phân quyền (Tài khoản nhân sự) mới vào được —
    // không tự tạo tài khoản mới cho email GHN lạ (trước đây tự đăng ký vai trò Nhân viên).
    if (!acc) return json({ ok: false, error: "not_allowed" }, 403);
    if (acc.disabled) return json({ ok: false, error: "disabled" }, 403);
    const payload = { email: acc.email, roleId: acc.roleId, name: acc.name, exp: sessionExp() };
    const token = await signSession(payload, env);
    return json({ ok: true, token, email: acc.email, name: acc.name, roleId: acc.roleId });
  }

  // ---- ĐĂNG NHẬP NHANH bước 1: gửi mã về email GHN (tạm không dùng ở UI) ----
  if (action === "request-otp") {
    const typed = String(b?.email || "").trim().toLowerCase();
    if (!typed) return json({ ok: false, error: "missing" }, 400);
    if (!isGhnMail(typed)) return json({ ok: false, error: "not_ghn" }, 403);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    const canon = canonicalGhnEmail(typed);   // 2 đuôi = cùng 1 danh tính
    if (await otpOnCooldown(env, canon)) return json({ ok: false, error: "cooldown" }, 429);

    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, canon);
    if (acc?.disabled) return json({ ok: false, error: "disabled" }, 403);

    const code = randomOtp();
    await storeOtp(env, canon, code);          // lưu theo canonical (dùng chung 2 đuôi)
    const sent = await sendOtpEmail(env, typed, code); // GỬI về đúng email họ nhập
    if (String(env?.OTP_DEV_ECHO || "") === "1") return json({ ok: true, devCode: code }); // CHẾ ĐỘ TEST
    if (!sent) return json({ ok: false, error: "email_failed" }, 500);
    return json({ ok: true });
  }

  // ---- ĐĂNG NHẬP NHANH bước 2: xác mã -> vào luôn (chỉ tài khoản đã duyệt) ----
  if (action === "verify-otp") {
    const typed = String(b?.email || "").trim().toLowerCase();
    const code = String(b?.code || "").trim();
    if (!typed || !code) return json({ ok: false, error: "missing" }, 400);
    if (!isGhnMail(typed)) return json({ ok: false, error: "not_ghn" }, 403);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    const canon = canonicalGhnEmail(typed);
    const lockedMs = await loginLockedMs(env, canon);
    if (lockedMs > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(lockedMs / 60000) }, 429);

    const res = await checkOtp(env, canon, code);
    if (res !== "ok") {
      if (res === "wrong") await recordLoginFail(env, canon);
      const nowLocked = await loginLockedMs(env, canon);
      if (nowLocked > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(nowLocked / 60000) }, 429);
      return json({ ok: false, error: res === "wrong" ? "otp_wrong" : res === "expired" ? "otp_expired" : res === "toomany" ? "otp_toomany" : "otp_none" }, 401);
    }
    await clearLoginFail(env, canon);

    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, canon);
    // Chỉ tài khoản ĐÃ ĐƯỢC DUYỆT trong mục Phân quyền mới vào được (xem ghi chú ở quick-login).
    if (!acc) return json({ ok: false, error: "not_allowed" }, 403);
    if (acc.disabled) return json({ ok: false, error: "disabled" }, 403);

    const payload = { email: acc.email, roleId: acc.roleId, name: acc.name, exp: sessionExp() };
    const token = await signSession(payload, env);
    return json({ ok: true, token, email: acc.email, name: acc.name, roleId: acc.roleId });
  }

  // ---- ĐĂNG KÝ bước 2: xác mã ĐÚNG + TẠO MẬT KHẨU -> vào luôn ----
  if (action === "set-password") {
    const typed = String(b?.email || "").trim().toLowerCase();
    const code = String(b?.code || "").trim();
    const password = String(b?.password || "");
    if (!typed || !code) return json({ ok: false, error: "missing" }, 400);
    if (!isGhnMail(typed)) return json({ ok: false, error: "not_ghn" }, 403);
    if (!checkPassword(password)) return json({ ok: false, error: "weak", rule: PW_RULE }, 400);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    const canon = canonicalGhnEmail(typed);
    const lockedMs = await loginLockedMs(env, canon);
    if (lockedMs > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(lockedMs / 60000) }, 429);

    const res = await checkOtp(env, canon, code);
    if (res !== "ok") {
      if (res === "wrong") await recordLoginFail(env, canon);
      const nowLocked = await loginLockedMs(env, canon);
      if (nowLocked > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(nowLocked / 60000) }, 429);
      return json({ ok: false, error: res === "wrong" ? "otp_wrong" : res === "expired" ? "otp_expired" : res === "toomany" ? "otp_toomany" : "otp_none" }, 401);
    }
    await clearLoginFail(env, canon);

    const purpose = b?.purpose === "reset" ? "reset" : "register";
    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, canon);
    if (acc?.disabled) return json({ ok: false, error: "disabled" }, 403);
    // Chỉ tài khoản ĐÃ ĐƯỢC DUYỆT (có sẵn trong Phân quyền) mới đặt được mật khẩu — không tự tạo
    // tài khoản mới ở bước này nữa (xem ghi chú ở quick-login).
    if (!acc) return json({ ok: false, error: purpose === "reset" ? "no_account" : "not_allowed" }, purpose === "reset" ? 404 : 403);
    // Đăng ký: chặn nếu đã có mật khẩu.
    if (purpose === "register" && acc.salt && acc.hash) return json({ ok: false, error: "already" }, 409);
    const cred = await makeCredential(password);
    // Đặt/đặt lại mật khẩu, GIỮ NGUYÊN vai trò.
    acc.salt = cred.salt; acc.hash = cred.hash;
    if (!acc.name && b?.name) acc.name = String(b.name).trim().slice(0, 60);
    await putAccounts(env, accounts);

    const payload = { email: acc.email, roleId: acc.roleId, name: acc.name, exp: sessionExp() };
    const token = await signSession(payload, env);
    return json({ ok: true, token, email: acc.email, name: acc.name, roleId: acc.roleId });
  }

  // ---- Đăng nhập bằng mật khẩu (dự phòng) ----
  if (action === "login") {
    const password = String(b?.password || "");
    const rawEmail = String(b?.email || "").trim().toLowerCase();
    const email = canonicalGhnEmail(rawEmail); // 2 đuôi GHN = cùng 1 tài khoản
    if (!rawEmail || !password) return json({ ok: false, error: "missing" }, 400);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    // Chống dò: nếu email đang bị khoá thì chặn ngay, không kiểm mật khẩu.
    const lockedMs = await loginLockedMs(env, email);
    if (lockedMs > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(lockedMs / 60000) }, 429);

    const accounts = await ensureSeeded(env);
    const acc = findAccount(accounts, email);
    const ok = acc && !acc.disabled ? await verifyPassword(password, acc) : false;
    if (!ok) {
      await recordLoginFail(env, email);
      const nowLocked = await loginLockedMs(env, email);
      if (nowLocked > 0) return json({ ok: false, error: "locked", lockedMin: Math.ceil(nowLocked / 60000) }, 429);
      return json({ ok: false, error: "invalid" }, 401);
    }
    await clearLoginFail(env, email);

    const payload = { email: acc!.email, roleId: acc!.roleId, name: acc!.name, exp: sessionExp() };
    const token = await signSession(payload, env);
    return json({ ok: true, token, email: acc!.email, name: acc!.name, roleId: acc!.roleId });
  }

  // ---- Đổi mật khẩu (cần phiên) — áp chính sách mạnh ----
  if (action === "change-password") {
    const s = await getSession(request, env);
    if (!s) return json({ ok: false, error: "unauthorized" }, 401);
    const oldPassword = String(b?.oldPassword || "");
    const newPassword = String(b?.newPassword || "");
    if (!checkPassword(newPassword)) return json({ ok: false, error: "weak", rule: PW_RULE }, 400);
    if (!env?.QA_KV) return json({ ok: false, error: "no_kv" }, 500);

    const accounts = await getAccounts(env);
    const acc = findAccount(accounts, s.email);
    if (!acc) return json({ ok: false, error: "not_found" }, 404);
    // Nếu tài khoản CHƯA có mật khẩu (chỉ dùng Google) -> cho đặt mới không cần mật khẩu cũ.
    if (acc.salt && acc.hash) {
      const ok = await verifyPassword(oldPassword, acc);
      if (!ok) return json({ ok: false, error: "wrong_old" }, 401);
    }

    const cred = await makeCredential(newPassword);
    acc.salt = cred.salt;
    acc.hash = cred.hash;
    await putAccounts(env, accounts);
    return json({ ok: true });
  }

  return json({ ok: false, error: "bad_request" }, 400);
};
