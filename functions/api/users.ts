/* ============================================================
   Ghi nhận người dùng đã đăng nhập (email) — lưu gọn ở KV "users:list".
   Mỗi bản ghi: { e: email, n: tên, f: lần đầu, t: lần gần nhất, c: số lượt }.
   POST { email, name } -> cập nhật/ thêm (dedupe theo email). Tiết kiệm dung lượng.
   GET (admin) -> danh sách (để xem ai đang dùng).
   ============================================================ */
import { isAdminReq } from "./_admin";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const KEY = "users:list";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const b: any = await request.json().catch(() => ({}));
  const email = String(b?.email || "").trim().toLowerCase().slice(0, 120);
  const name = String(b?.name || "").trim().slice(0, 60);
  if (!email || !EMAIL_RE.test(email)) return json({ ok: false }, 400);
  if (!env.QA_KV) return json({ ok: true }); // không có KV thì bỏ qua, không lỗi

  try {
    const raw = await env.QA_KV.get(KEY);
    const list: { e: string; n: string; f: number; t: number; c: number }[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const i = list.findIndex((u) => u.e === email);
    if (i >= 0) {
      if (name) list[i].n = name;
      list[i].t = now;
      list[i].c = (list[i].c || 1) + 1;
    } else {
      list.push({ e: email, n: name, f: now, t: now, c: 1 });
    }
    if (list.length > 2000) list.splice(0, list.length - 2000); // chặn phình
    await env.QA_KV.put(KEY, JSON.stringify(list));
    return json({ ok: true, count: i >= 0 ? list[i].c : 1 });
  } catch {
    return json({ ok: false });
  }
};

export const onRequestGet = async ({ env, request }: any): Promise<Response> => {
  // Chỉ admin (email @ghn.vn qua header x-user-email, hoặc token cũ) mới xem được danh sách.
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);
  try {
    const raw = env.QA_KV ? await env.QA_KV.get(KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return json({ ok: true, total: list.length, users: list.slice(-500) });
  } catch {
    return json({ ok: false });
  }
};
