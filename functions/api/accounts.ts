/* ============================================================
   Quản lý TÀI KHOẢN nhân sự (ADMIN). Lưu KV key "accounts:v1".
   GET  /api/accounts                                   (admin) -> { ok, accounts:[{id,email,name,roleId,disabled}] }
   POST /api/accounts { action:"save", accounts:[{email,name,roleId,disabled,newPassword?}] }  (admin)
        -> ghi đè danh sách; account mới hoặc có newPassword thì băm lại; giữ hash cũ nếu không đổi.
   POST /api/accounts { action:"reset-password", email, newPassword } (admin) -> { ok }
   POST /api/accounts { action:"delete", email }        (admin) -> { ok }
   Mật khẩu KHÔNG bao giờ trả về client (chỉ trả field công khai).
   ============================================================ */
import { isAdminReq } from "./_admin";
import {
  ensureSeeded, getAccounts, putAccounts, findAccount, makeCredential, publicAccount,
  checkPassword,
  type Account,
} from "./_session";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestGet = async ({ request, env }: any): Promise<Response> => {
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);
  const accounts = await ensureSeeded(env);
  return json({ ok: true, accounts: accounts.map(publicAccount) });
};

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env?.QA_KV) return json({ error: "no_kv" }, 500);
  const b: any = await request.json().catch(() => ({}));
  const action = b?.action;
  const current = await getAccounts(env);

  if (action === "save") {
    const incoming = Array.isArray(b?.accounts) ? b.accounts : null;
    if (!incoming) return json({ error: "invalid_payload" }, 400);
    const out: Account[] = [];
    for (const row of incoming) {
      const email = String(row?.email || "").trim().toLowerCase();
      const name = String(row?.name || "").trim().slice(0, 60);
      const roleId = String(row?.roleId || "").trim();
      if (!email || !EMAIL_RE.test(email) || !roleId) continue; // bỏ dòng thiếu
      const prev = findAccount(current, email);
      let salt = prev?.salt || "";
      let hash = prev?.hash || "";
      const newPassword = String(row?.newPassword || "");
      if (newPassword) {
        if (!checkPassword(newPassword)) return json({ error: "weak_password", email }, 400);
        const cred = await makeCredential(newPassword);
        salt = cred.salt; hash = cred.hash;
      }
      // Không bắt buộc mật khẩu: tài khoản đăng nhập bằng Google (salt/hash rỗng là hợp lệ).
      out.push({ id: email, email, name, roleId, salt, hash, disabled: !!row?.disabled });
    }
    if (!out.length) return json({ error: "empty" }, 400);
    // Chặn tự khoá hết admin: phải còn ít nhất 1 admin đang bật.
    if (!out.some((a) => a.roleId === "admin" && !a.disabled)) {
      return json({ error: "need_active_admin" }, 400);
    }
    await putAccounts(env, out);
    return json({ ok: true, accounts: out.map(publicAccount) });
  }

  if (action === "reset-password") {
    const email = String(b?.email || "").trim().toLowerCase();
    const newPassword = String(b?.newPassword || "");
    if (!checkPassword(newPassword)) return json({ error: "weak_password" }, 400);
    const acc = findAccount(current, email);
    if (!acc) return json({ error: "not_found" }, 404);
    const cred = await makeCredential(newPassword);
    acc.salt = cred.salt; acc.hash = cred.hash;
    await putAccounts(env, current);
    return json({ ok: true });
  }

  if (action === "delete") {
    const email = String(b?.email || "").trim().toLowerCase();
    const next = current.filter((a) => a.email.toLowerCase() !== email);
    if (!next.some((a) => a.roleId === "admin" && !a.disabled)) {
      return json({ error: "need_active_admin" }, 400);
    }
    await putAccounts(env, next);
    return json({ ok: true });
  }

  return json({ error: "bad_request" }, 400);
};
