/* ============================================================
   QUẢN LÝ TÀI KHOẢN — port từ functions/api/accounts.ts (KV "accounts:v1").
   GET  /api/accounts                                              -> { accounts }
   POST { action:"save", accounts:[{email,name,roleId,disabled,newPassword?}] }
   POST { action:"reset-password", email, newPassword }
   POST { action:"delete", email }
   Tất cả cần quyền phan-quyen:edit. MẬT KHẨU KHÔNG BAO GIỜ TRẢ VỀ CLIENT.
   ============================================================ */
import { select, upsert, update, remove, json } from "./_lib/supabase";
import { guard, hashPassword, checkPassword, PW_RULE } from "./_lib/session";

export const config = { runtime: "edge" };

const lc = (e: string) => String(e || "").trim().toLowerCase();

export default async function handler(req: Request): Promise<Response> {
  try {
    const g = await guard(req, "phan-quyen", req.method === "GET" ? "view" : "edit");
    if ("deny" in g) return g.deny;

    if (req.method === "GET") {
      // CHỈ chọn cột công khai — không bao giờ đưa pw_salt/pw_hash ra khỏi server.
      const accounts = await select("accounts", {
        select: "id,email,name,role_id,disabled,last_login,created_at",
        order: "email.asc", limit: 1000,
      });
      return json({ ok: true, accounts });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));

    if (b?.action === "delete") {
      const email = lc(b?.email);
      if (!email) return json({ error: "bad_request" }, 400);
      if (email === lc(g.actor.email)) return json({ error: "cannot_delete_self" }, 400);
      await remove("accounts", { email_lc: "eq." + email }, g.actor.email);
      return json({ ok: true });
    }

    if (b?.action === "reset-password") {
      const email = lc(b?.email);
      const pw = String(b?.newPassword || "");
      if (!email) return json({ error: "bad_request" }, 400);
      if (!checkPassword(pw)) return json({ error: "weak_password", rule: PW_RULE }, 400);
      const { salt, hash } = await hashPassword(pw);
      const rows = await update("accounts", { email_lc: "eq." + email },
                                { pw_salt: salt, pw_hash: hash }, g.actor.email);
      if (!rows.length) return json({ error: "not_found" }, 404);
      return json({ ok: true });
    }

    if (b?.action !== "save") return json({ error: "bad_request" }, 400);

    const list: any[] = Array.isArray(b?.accounts) ? b.accounts : [];
    if (!list.length) return json({ error: "bad_request" }, 400);

    // Không cho tự hạ vai trò của CHÍNH MÌNH khỏi admin -> tránh khoá ngoài toàn hệ thống.
    const me = lc(g.actor.email);
    for (const a of list) {
      if (lc(a?.email) === me && a?.roleId && a.roleId !== "admin") {
        return json({ error: "cannot_demote_self" }, 400);
      }
    }

    const rows: any[] = [];
    for (const a of list) {
      const email = lc(a?.email);
      if (!email) continue;
      const row: any = {
        email,
        name: String(a?.name || "").slice(0, 60),
        role_id: String(a?.roleId || "staff"),
        disabled: !!a?.disabled,
      };
      // Chỉ băm lại khi admin thực sự nhập mật khẩu mới; bỏ trống = GIỮ mật khẩu cũ.
      if (a?.newPassword) {
        if (!checkPassword(String(a.newPassword))) {
          return json({ error: "weak_password", email, rule: PW_RULE }, 400);
        }
        const { salt, hash } = await hashPassword(String(a.newPassword));
        row.pw_salt = salt;
        row.pw_hash = hash;
      }
      rows.push(row);
    }
    if (!rows.length) return json({ error: "bad_request" }, 400);

    await upsert("accounts", rows, "email_lc", g.actor.email);
    return json({ ok: true, saved: rows.length });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
