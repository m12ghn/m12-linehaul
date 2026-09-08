/* ============================================================
   TICKET XIN TĂNG CƯỜNG (09/2026) — thay dần luồng Google Sheet "Nội thành"/
   "Nội vùng" của project riêng tai-tang-cuong-vercel (đăng ký + GSVT phản hồi
   + bot Playwright tạo app tăng cường trên vantai-dieuphoi/express/config).
   Xem bối cảnh đầy đủ ở supabase/migrations/0008_ticket_xin_tang_cuong.sql.

   CỐ Ý TÁCH BIỆT HOÀN TOÀN với bảng `tickets` (project tai-tang-cuong-vercel):
   bảng `addon_trip_ticket` không FK, không join gì tới bảng đó.

   GET  /api/ticket-xtc?scope=noi-thanh|noi-vung|all&from=YYYY-MM-DD&to=YYYY-MM-DD
     -> { ok, rows: AddonTripTicket[] }
     ĐỌC MỞ (không cần đăng nhập) — cùng lý do api/tickets.ts: trang mới dựng
     khung, chưa có gì nhạy cảm hơn dữ liệu vận hành đang hiện công khai trên
     Sheet cho GSVT xem hằng ngày.
     scope lọc theo `region`: "noi-thanh" = Hồ Chí Minh, "noi-vung" = còn lại,
     "all"/không truyền = không lọc.
     from/to (09/2026) lọc theo `created_at` (giờ VN +07:00), CẢ HAI tuỳ chọn —
     thiếu 1 trong 2 thì chỉ chặn 1 phía. Client (TicketXinTangCuong.tsx) luôn
     gửi cả 2, mặc định "2 ngày gần nhất", để tránh kéo cả 3700+ dòng lịch sử
     mỗi lần mở trang. Dùng selectAll() (không giới hạn 500 như trước) vì với
     bộ lọc ngày hẹp, số dòng khớp thường nhỏ — còn khi user nới rộng khoảng
     ngày thì vẫn cần trả đủ, không âm thầm cắt bớt.
     select("*") nên tự động trả về CẢ các cột bổ sung ở 0009 (note, ve_ktc,
     da_thong_bao_tele, bl, blacklist, hinh_kho) khi client cần hiển thị đủ
     layout giống sheet gốc — không cần sửa gì thêm ở đây khi thêm cột mới.

   POST /api/ticket-xtc { action:"save", ticketId, patch:{...} } -> { ok, row }
     Cần quyền "ticket-xtc":"edit" (guard). `patch` chỉ nhận đúng các cột GSVT
     được sửa trên UI (whitelist EDITABLE_FIELDS bên dưới) — chặn client gửi
     đè các cột gốc (region, lo_trinh, msnv...) vốn thuộc về luồng đăng ký.
   ============================================================ */
import { selectAll, update, json, SupabaseError } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const MODULE = "ticket-xtc";
const MAX_ID_LEN = 200;

/** Cột GSVT được phép sửa qua trang này — khớp đúng thao tác GSVT làm trên
 *  sheet Nội thành/Nội vùng hiện tại (BKS, tài xế, giờ tới, trạng thái duyệt...)
 *  + phần riêng cho bot Playwright (thu_tu_diem/warehouse/tao_app_trigger/da_tao_app). */
const EDITABLE_FIELDS = [
  "trang_thai", "ngay_duyet", "gio_toi", "ma_chuyen", "ten_ncc",
  "bks", "tai_trong", "thong_tin_tx", "ve_ktc",
  "thu_tu_diem", "warehouse", "tao_app_trigger", "da_tao_app",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function scopeFilter(scope: string | null): Record<string, string> {
  if (scope === "noi-thanh") return { region: "eq.Hồ Chí Minh" };
  if (scope === "noi-vung") return { region: "not.eq.Hồ Chí Minh" };
  return {};
}

/** from/to dạng "YYYY-MM-DD" (giờ VN) -> điều kiện created_at gte/lte. Sai
 *  format thì bỏ qua (không lọc phía đó) thay vì để PostgREST trả 400 khó hiểu. */
function dateRangeFilter(from: string | null, to: string | null): string[] {
  const cond: string[] = [];
  if (from && DATE_RE.test(from)) cond.push("gte." + from + "T00:00:00+07:00");
  if (to && DATE_RE.test(to)) cond.push("lte." + to + "T23:59:59+07:00");
  return cond;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const created = dateRangeFilter(u.searchParams.get("from"), u.searchParams.get("to"));
      const filter: Record<string, string | string[]> = { ...scopeFilter(u.searchParams.get("scope")) };
      if (created.length) filter.created_at = created;
      const rows = await selectAll("addon_trip_ticket", {
        select: "*",
        filter,
        order: "created_at.desc",
      });
      return json({ ok: true, rows });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const g = await guard(req, MODULE, "edit");
    if ("deny" in g) return g.deny;

    const b: any = await req.json().catch(() => ({}));
    const ticketId = String(b?.ticketId || "").trim();
    if (!ticketId || ticketId.length > MAX_ID_LEN) return json({ error: "bad_request", detail: "ticketId" }, 400);

    if (b?.action !== "save") return json({ error: "bad_request", detail: "action" }, 400);

    const rawPatch = b?.patch && typeof b.patch === "object" ? b.patch : {};
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE_FIELDS) {
      if (k in rawPatch) patch[k] = rawPatch[k];
    }
    if (Object.keys(patch).length === 0) return json({ error: "bad_request", detail: "patch_empty" }, 400);
    if ("thu_tu_diem" in patch && patch.thu_tu_diem !== null) {
      const n = Number(patch.thu_tu_diem);
      patch.thu_tu_diem = Number.isFinite(n) ? Math.trunc(n) : null;
    }
    if ("tao_app_trigger" in patch) patch.tao_app_trigger = !!patch.tao_app_trigger;

    const rows = await update("addon_trip_ticket", { ticket_id: "eq." + ticketId }, patch, g.actor.email);
    return json({ ok: true, row: rows[0] ?? null });
  } catch (e: any) {
    if (e instanceof SupabaseError) return json({ error: "server_error", detail: e.message }, 500);
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
