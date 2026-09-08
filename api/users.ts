/* ============================================================
   GHI NHẬN NGƯỜI DÙNG ĐÃ ĐĂNG NHẬP — port từ functions/api/users.ts (KV "users:list").
   POST { email, name }  -> cập nhật/thêm (dedupe theo email)
   GET                    -> danh sách (cần quyền phan-quyen:view)

   Bản KV cũ phải đọc cả mảng, sửa, ghi lại. Ở đây là 1 câu upsert.
   ============================================================ */
import { select, one, upsert, json } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "POST") {
      const b: any = await req.json().catch(() => ({}));
      const email = String(b?.email || "").trim().toLowerCase().slice(0, 120);
      if (!EMAIL_RE.test(email)) return json({ error: "bad_email" }, 400);

      const cur = await one<{ hits: number }>("user_activity", {
        select: "hits", filter: { email_lc: "eq." + email },
      });
      await upsert("user_activity", {
        email_lc: email,
        name: String(b?.name || "").slice(0, 60),
        last_seen: new Date().toISOString(),
        hits: (cur?.hits ?? 0) + 1,
      }, "email_lc");
      return json({ ok: true });
    }

    if (req.method === "GET") {
      const g = await guard(req, "phan-quyen", "view");
      if ("deny" in g) return g.deny;
      const rows = await select("user_activity", {
        select: "email_lc,name,first_seen,last_seen,hits", order: "last_seen.desc", limit: 500,
      });
      return json({ ok: true, users: rows });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
