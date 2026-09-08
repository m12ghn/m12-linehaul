/* ============================================================
   ĐĂNG NHẬP — port từ functions/api/auth.ts sang Vercel + Supabase.
   Giữ nguyên hợp đồng API để src/lib/useUser.ts không phải sửa gì.

   GET  /api/auth                                    -> { ok, me? }
   POST { action:"quick-login", email }              -> { ok, token, email, name, roleId }
   POST { action:"login", email, password }          -> nt
   POST { action:"request-otp", email }              -> { ok, devCode? }
   POST { action:"verify-otp", email, code }         -> nt
   POST { action:"set-password", email, code, password, name, purpose }
   POST { action:"change-password", oldPassword, newPassword }   (cần phiên)
   ============================================================ */
import { one, insert, update, upsert, remove, json } from "./_lib/supabase";
import {
  signSession, sessionExp, getSession, hashPassword, verifyPassword,
  checkPassword, PW_RULE, isGhnEmail, markLogin,
} from "./_lib/session";

export const config = { runtime: "edge" };

const OTP_TTL_MS = 10 * 60_000;
const OTP_COOLDOWN_MS = 60_000;
const MAX_OTP_TRIES = 5;
const MAX_LOGIN_FAILS = 8;
const LOCK_MS = 15 * 60_000;

interface Account {
  id: string; email: string; name: string; role_id: string;
  pw_salt: string | null; pw_hash: string | null; disabled: boolean;
}

const lc = (e: string) => (e || "").trim().toLowerCase();

function guessName(email: string): string {
  const local = (email.split("@")[0] || "").trim();
  const seg = local.split(/[._\-]/).filter(Boolean)[0] || local;
  const clean = seg.replace(/[0-9]+/g, "");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : "bạn";
}

function findAccount(email: string): Promise<Account | null> {
  return one<Account>("accounts", {
    select: "id,email,name,role_id,pw_salt,pw_hash,disabled",
    filter: { email_lc: "eq." + lc(email) },
  });
}

/** Tài khoản mới tự tạo khi đăng nhập lần đầu bằng email GHN (vai trò staff). */
async function ensureAccount(email: string, name?: string): Promise<Account> {
  const found = await findAccount(email);
  if (found) return found;
  const [row] = await insert<Account>("accounts", {
    email: lc(email), name: name || guessName(email), role_id: "staff",
  });
  return row;
}

async function issue(acc: Account): Promise<Response> {
  if (acc.disabled) return json({ error: "disabled" }, 403);
  const payload = { email: lc(acc.email), roleId: acc.role_id, name: acc.name, exp: sessionExp() };
  const token = await signSession(payload);
  markLogin(acc.email);
  upsert("user_activity", {
    email_lc: lc(acc.email), name: acc.name, last_seen: new Date().toISOString(),
  }, "email_lc").catch(() => {});
  return json({ ok: true, token, email: payload.email, name: acc.name, roleId: acc.role_id });
}

// ---------- chống dò mật khẩu ----------
async function locked(email: string): Promise<boolean> {
  const r = await one<{ locked_until: string | null }>("login_fails", {
    select: "locked_until", filter: { email_lc: "eq." + lc(email) },
  });
  return !!(r?.locked_until && new Date(r.locked_until).getTime() > Date.now());
}
async function noteFail(email: string): Promise<void> {
  const r = await one<{ fails: number }>("login_fails", {
    select: "fails", filter: { email_lc: "eq." + lc(email) },
  });
  const fails = (r?.fails ?? 0) + 1;
  await upsert("login_fails", {
    email_lc: lc(email), fails,
    locked_until: fails >= MAX_LOGIN_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null,
  }, "email_lc");
}
const clearFail = (email: string) =>
  remove("login_fails", { email_lc: "eq." + lc(email) }).catch(() => {});

// ---------- OTP ----------
async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Gửi mã qua Brevo (giữ nguyên nhà cung cấp cũ). Chưa cấu hình -> trả mã để test. */
async function sendOtpEmail(email: string, code: string): Promise<boolean> {
  const env = (globalThis as any).process?.env || {};
  const key = env.BREVO_API_KEY;
  if (!key) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { email: env.OTP_FROM_EMAIL || "no-reply@ghn.vn", name: env.OTP_FROM_NAME || "Dashboard M12" },
      to: [{ email }],
      subject: `Mã đăng nhập Dashboard M12: ${code}`,
      textContent: `Mã đăng nhập của bạn là ${code}. Mã có hiệu lực 10 phút.`,
    }),
  });
  return r.ok;
}

// ---------- điểm vào ----------
export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const s = await getSession(req);
      return json({ ok: true, me: s ? { email: s.email, name: s.name, roleId: s.roleId } : null });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const b: any = await req.json().catch(() => ({}));
    const action = String(b?.action || "");
    const email = lc(b?.email || "");

    switch (action) {
      // Đăng nhập nhanh: email GHN là vào (giữ đúng hành vi bản cũ).
      case "quick-login": {
        if (!isGhnEmail(email)) return json({ error: "not_ghn" }, 403);
        return await issue(await ensureAccount(email, b?.name));
      }

      case "login": {
        if (await locked(email)) return json({ error: "locked" }, 429);
        const acc = await findAccount(email);
        if (!acc || !acc.pw_hash || !(await verifyPassword(String(b?.password || ""), acc.pw_salt!, acc.pw_hash))) {
          await noteFail(email);
          return json({ error: "invalid" }, 401);
        }
        await clearFail(email);
        return await issue(acc);
      }

      case "request-otp": {
        if (!isGhnEmail(email)) return json({ error: "not_ghn" }, 403);
        const prev = await one<{ sent_at: string }>("login_otp", {
          select: "sent_at", filter: { email_lc: "eq." + email },
        });
        if (prev && Date.now() - new Date(prev.sent_at).getTime() < OTP_COOLDOWN_MS) {
          return json({ error: "cooldown" }, 429);
        }
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await upsert("login_otp", {
          email_lc: email, code_hash: await sha256hex(code),
          expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
          tries: 0, sent_at: new Date().toISOString(),
        }, "email_lc");
        const sent = await sendOtpEmail(email, code);
        // Chưa cấu hình email -> trả mã trong phản hồi để còn đăng nhập được (chỉ bật ở môi trường test).
        const echo = (globalThis as any).process?.env?.OTP_DEV_ECHO === "1";
        return json({ ok: true, ...(!sent && echo ? { devCode: code } : {}) });
      }

      case "verify-otp":
      case "set-password": {
        const rec = await one<{ code_hash: string; expires_at: string; tries: number }>("login_otp", {
          select: "code_hash,expires_at,tries", filter: { email_lc: "eq." + email },
        });
        if (!rec) return json({ error: "otp_missing" }, 400);
        if (new Date(rec.expires_at).getTime() < Date.now()) return json({ error: "otp_expired" }, 400);
        if (rec.tries >= MAX_OTP_TRIES) return json({ error: "otp_locked" }, 429);
        if (rec.code_hash !== (await sha256hex(String(b?.code || "").trim()))) {
          await update("login_otp", { email_lc: "eq." + email }, { tries: rec.tries + 1 });
          return json({ error: "otp_wrong" }, 401);
        }
        await remove("login_otp", { email_lc: "eq." + email });

        const acc = await ensureAccount(email, b?.name);
        if (action === "set-password") {
          const pw = String(b?.password || "");
          if (!checkPassword(pw)) return json({ error: "weak_password", rule: PW_RULE }, 400);
          const { salt, hash } = await hashPassword(pw);
          await update("accounts", { email_lc: "eq." + email }, {
            pw_salt: salt, pw_hash: hash, ...(b?.name ? { name: String(b.name).slice(0, 60) } : {}),
          });
        }
        return await issue(acc);
      }

      case "change-password": {
        const s = await getSession(req);
        if (!s) return json({ error: "unauthorized" }, 401);
        const acc = await findAccount(s.email);
        if (!acc) return json({ error: "unauthorized" }, 401);
        if (acc.pw_hash && !(await verifyPassword(String(b?.oldPassword || ""), acc.pw_salt!, acc.pw_hash))) {
          return json({ error: "invalid" }, 401);
        }
        const pw = String(b?.newPassword || "");
        if (!checkPassword(pw)) return json({ error: "weak_password", rule: PW_RULE }, 400);
        const { salt, hash } = await hashPassword(pw);
        await update("accounts", { email_lc: "eq." + lc(s.email) }, { pw_salt: salt, pw_hash: hash });
        return json({ ok: true });
      }

      default:
        return json({ error: "bad_request" }, 400);
    }
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
