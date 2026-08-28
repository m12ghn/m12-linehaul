/* ============================================================
   Phân tích TỰ ĐỘNG mỗi ngày 09:00 (giờ VN) cho 1 mục số liệu.
   - Lưu kết quả + thời điểm vào KV (key "daily:<id>") -> mọi người xem
     cùng 1 bản, chạy AI 1 lần/ngày (tiết kiệm lượt Gemini).
   - Lần đầu mở SAU 09:00 mà chưa có bản hôm nay -> tự sinh & lưu.
   - force=true: phân tích lại ngay (nút "Phân tích lại").
   POST { id, digest, force? } -> { text, at, date, status }
   ============================================================ */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Ngày & giờ hiện tại theo giờ VN (UTC+7). */
function vnNow(): { date: string; hour: number } {
  const v = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: v.toISOString().slice(0, 10), hour: v.getUTCHours() };
}

/** Câu "xin lỗi hết quota" mà assistant.ts trả khi CẢ pool AI đều fail (bắt đầu bằng "⚠") —
 *  đây KHÔNG phải phân tích thật, phải coi là LỖI: không cache, không hiện như báo cáo chính thức. */
function isApology(text: string): boolean {
  return /^\s*⚠/.test(text || "");
}

/** Dữ liệu sếp nạp thêm (đã lưu) cho mục này -> đưa vào phân tích. */
async function loadExtra(env: any, id: string): Promise<string> {
  try {
    const raw = env.QA_KV ? await env.QA_KV.get("extra:" + id) : null;
    const d = raw ? JSON.parse(raw) : null;
    if (!d?.items?.length) return "";
    return (
      "\n\n[DỮ LIỆU SẾP NẠP THÊM — đọc kỹ, dùng để phân tích & tìm nguyên nhân]\n" +
      d.items.map((x: any, i: number) => `(${i + 1}) Nguồn: ${x.source}\n${x.text}`).join("\n---\n").slice(0, 55000)
    );
  } catch {
    return "";
  }
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const id = String(body?.id || "").slice(0, 80);
  const digest = String(body?.digest || "");
  const force = !!body?.force;
  if (!id) return json({ status: "error", text: "Thiếu id." }, 400);

  const KEY = "daily:" + id;
  let cached: { date: string; at: number; text: string } | null = null;
  try {
    const raw = env.QA_KV ? await env.QA_KV.get(KEY) : null;
    if (raw) cached = JSON.parse(raw);
  } catch { /* bỏ qua */ }

  const { date: today, hour } = vnNow();

  // Đã có bản hôm nay & không ép -> trả về luôn.
  if (!force && cached && cached.date === today) {
    return json({ status: "ok", text: cached.text, at: cached.at, date: cached.date });
  }
  // Chống dồn: nhiều người bấm "Phân tích lại" cùng lúc -> chỉ thực sự tạo mới 1 lần mỗi ~25s,
  // những người còn lại nhận luôn bản vừa tạo (tiết kiệm lượt Gemini khi đông người).
  if (cached && cached.date === today && Date.now() - cached.at < 25000) {
    return json({ status: "ok", text: cached.text, at: cached.at, date: cached.date });
  }
  // Chưa tới 09:00 và không ép -> trả bản cũ (nếu có) + báo chờ.
  if (!force && hour < 9) {
    return json({
      status: cached ? "stale" : "waiting",
      text: cached?.text || "",
      at: cached?.at || 0,
      date: cached?.date || "",
    });
  }
  // Cần phân tích mới mà không có số liệu -> không làm gì.
  if (!digest.trim()) {
    return json({ status: cached ? "stale" : "waiting", text: cached?.text || "", at: cached?.at || 0, date: cached?.date || "" });
  }

  // Gọi nội bộ /api/assistant (tái dùng prompt ANALYZE + KB + model fallback).
  // Gộp thêm dữ liệu sếp đã nạp (link/đoạn text) để phân tích nguyên nhân.
  const fullText = digest + (await loadExtra(env, id));
  let text = "";
  let errMsg = "";
  try {
    const r = await fetch(new URL("/api/assistant", request.url).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "analyze", text: fullText }),
    });
    const d: any = await r.json();
    text = d?.reply || "";
    // CẢ pool AI đều fail -> assistant.ts trả câu xin lỗi (configured vẫn true, reply không rỗng)
    // -> KHÔNG được coi là phân tích thật, dù không ném exception.
    if (d?.configured === false || isApology(text)) { errMsg = text || "Trợ lý chưa có nguồn AI nào khả dụng."; text = ""; }
  } catch (e: any) {
    errMsg = "Lỗi gọi trợ lý: " + (e?.message || e);
  }
  if (!text && !errMsg) errMsg = "Trợ lý không phản hồi.";

  // THẤT BẠI (lỗi thật hoặc xin lỗi hết quota): KHÔNG cache vào KV, và GIỮ LẠI bản tốt gần nhất
  // (nếu có) thay vì xoá trắng — người xem vẫn thấy phân tích cũ, kèm errMsg báo lần mới bị lỗi.
  if (errMsg) {
    return json({
      status: cached ? "stale" : "error",
      text: cached?.text || "",
      at: cached?.at || 0,
      date: cached?.date || "",
      errMsg,
    });
  }

  const rec = { date: today, at: Date.now(), text };
  try {
    if (env.QA_KV) await env.QA_KV.put(KEY, JSON.stringify(rec));
  } catch { /* bỏ qua */ }
  return json({ status: "ok", text: rec.text, at: rec.at, date: rec.date });
};
