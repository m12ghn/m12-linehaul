/* ============================================================
   TICKET XIN TĂNG CƯỜNG (09/2026) — thay dần luồng Google Sheet "Nội thành"/
   "Nội vùng" của project riêng tai-tang-cuong-vercel (đăng ký + GSVT phản hồi
   + bot Playwright tạo app tăng cường trên vantai-dieuphoi/express/config).
   Xem bối cảnh đầy đủ ở supabase/migrations/0008_ticket_xin_tang_cuong.sql.

   CỐ Ý TÁCH BIỆT HOÀN TOÀN với bảng `tickets` (project tai-tang-cuong-vercel):
   bảng `addon_trip_ticket` không FK, không join gì tới bảng đó.

   GET  /api/ticket-xtc?scope=noi-thanh|noi-vung|all
     -> { ok, rows: AddonTripTicket[] }
     ĐỌC MỞ (không cần đăng nhập) — cùng lý do api/tickets.ts: trang mới dựng
     khung, chưa có gì nhạy cảm hơn dữ liệu vận hành đang hiện công khai trên
     Sheet cho GSVT xem hằng ngày.
     scope lọc theo `region`: "noi-thanh" = Hồ Chí Minh, "noi-vung" = còn lại,
     "all"/không truyền = không lọc.
     select("*") nên tự động trả về CẢ các cột bổ sung ở 0009 (note, ve_ktc,
     da_thong_bao_tele, bl, blacklist, hinh_kho) khi client cần hiển thị đủ
     layout giống sheet gốc — không cần sửa gì thêm ở đây khi thêm cột mới.

   POST /api/ticket-xtc { action:"save", ticketId, patch:{...} } -> { ok, row }
     Cần quyền "ticket-xtc":"edit" (guard). `patch` chỉ nhận đúng các cột GSVT
     được sửa trên UI (whitelist EDITABLE_FIELDS bên dưới) — chặn client gửi
     đè các cột gốc (region, lo_trinh, msnv...) vốn thuộc về luồng đăng ký.
   ============================================================ */
import { select, update, json, SupabaseError } from "./_lib/supabase";
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

function scopeFilter(scope: string | null): Record<string, string> {
  if (scope === "noi-thanh") return { region: "eq.Hồ Chí Minh" };
  if (scope === "noi-vung") return { region: "not.eq.Hồ Chí Minh" };
  return {};
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const rows = await select("addon_trip_ticket", {
        select: "*",
        filter: scopeFilter(u.searchParams.get("scope")),
        order: "created_at.desc",
        limit: 500,
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
