/* ============================================================
   LỊCH TỰ ĐỘNG: đẩy toàn bộ vùng từ Supabase ra Google Sheet.
   GET /api/cron/export-sheets     (Vercel Cron gọi, kèm Authorization: Bearer CRON_SECRET)

   VÌ SAO CÓ FILE NÀY: bạn đã chọn "Sheet chỉ xuất khi cần". Nhưng gói Vercel Pro cho
   cron chạy tối thiểu 1 PHÚT/lần (Hobby chỉ 1 lần/ngày), nên rẻ hơn nhiều nếu để nó
   tự đẩy mỗi 15 phút — người quen dùng Sheet vẫn luôn thấy bản gần đúng thực tế,
   giảm hẳn lý do họ quay lại nhập trên Sheet.
   Không muốn thì xoá mục "crons" trong vercel.json, nút bấm tay vẫn chạy bình thường.

   Biến môi trường: CRON_SECRET, EXPORT_SHEET_ID.
   ⚠ CRON_SECRET Vercel KHÔNG tự sinh — phải tự tạo trong Settings → Environment
     Variables, rồi Vercel mới lấy giá trị đó gắn vào header Authorization khi gọi
     cron. Thiếu nó thì cron chạy đều nhưng lần nào cũng bị chính endpoint này trả
     401, mà cron lỗi thì im lặng nên không ai biết (đã xảy ra: 401 mỗi 15 phút
     suốt từ lúc deploy).
   ============================================================ */
import { select, json } from "./../_lib/supabase";
import { exportRegion, sheetsToken } from "./../_lib/exportSheet";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const env = (globalThis as any).process?.env || {};

  // Chỉ Vercel Cron được gọi. Không có secret -> từ chối, tránh ai đó gọi liên tục
  // làm cạn hạn mức Google Sheets API.
  const secret = env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) return json({ error: "unauthorized" }, 401);

  const sheetId = String(env.EXPORT_SHEET_ID || "");
  if (!sheetId) return json({ error: "no_sheet_id" }, 400);

  try {
    // Chỉ xuất vùng đang hiển thị trên UI; vùng `hidden` (Nội Vùng HCM) không còn dùng.
    const regions = await select<{ key: string; label: string }>("regions", {
      select: "key,label", filter: { hidden: "is.false" }, order: "sort.asc",
    });

    // Lấy token 1 lần dùng cho mọi vùng (mỗi lần mint là 1 vòng ký RSA + 1 request).
    const token = await sheetsToken();

    const done: Record<string, number> = {};
    const failed: Record<string, string> = {};
    for (const r of regions) {
      try {
        done[r.key] = await exportRegion(r.key, sheetId, r.label, "lịch tự động", token);
      } catch (e: any) {
        // 1 vùng lỗi KHÔNG được chặn các vùng còn lại.
        failed[r.key] = String(e?.message || e).slice(0, 200);
      }
    }
    return json({ ok: Object.keys(failed).length === 0, done, failed, at: Date.now() });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
