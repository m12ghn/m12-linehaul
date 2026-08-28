/* ============================================================
   Bản CHỐT Tổng Quan mỗi ngày lúc 10h sáng (giờ VN).
   - Chốt 1 lần/ngày từ dữ liệu thực tế lúc đó, GIỮ NGUYÊN cả ngày
     (mọi người xem cùng 1 bản ổn định để ra quyết định).
   - Lần đầu ai mở SAU 10h mà chưa có bản hôm nay -> tự chốt & lưu.
   POST { action:"get" }                       -> { snap, today }
   POST { action:"save", refDate, stat, alerts }-> { snap }  (chỉ từ 10h; đã chốt thì giữ nguyên)
   Lưu KV key "ovsnap:<YYYY-MM-DD>".
   ============================================================ */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function vnNow(): { date: string; hour: number } {
  const v = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: v.toISOString().slice(0, 10), hour: v.getUTCHours() };
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const action = body?.action;
  const { date, hour } = vnNow();
  const KEY = "ovsnap:v2:" + date; // v2: đã loại Nội Vùng + CK1/CK2 -> bỏ bản chốt cũ, chốt lại

  let cur: any = null;
  try { const raw = env.QA_KV ? await env.QA_KV.get(KEY) : null; if (raw) cur = JSON.parse(raw); } catch { /* bỏ qua */ }

  if (action === "get") return json({ ok: true, snap: cur, today: date });

  if (action === "save") {
    if (hour < 10) return json({ ok: false, reason: "before10" }); // chưa tới 10h -> chưa chốt
    if (cur) return json({ ok: true, snap: cur, frozen: true });    // đã chốt hôm nay -> giữ nguyên
    const rec = { at: Date.now(), date, refDate: String(body?.refDate || ""), stat: body?.stat ?? null, alerts: body?.alerts ?? null };
    try { if (env.QA_KV) await env.QA_KV.put(KEY, JSON.stringify(rec), { expirationTtl: 8 * 24 * 3600 }); } catch { /* bỏ qua */ }
    return json({ ok: true, snap: rec });
  }
  return json({ ok: false, error: "bad_request" }, 400);
};
