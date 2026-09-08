/* ============================================================
   TICKET XIN TĂNG CƯỜNG — lớp đọc/ghi client cho tab mới, khớp
   api/ticket-xtc.ts + bảng addon_trip_ticket (xem
   supabase/migrations/0008_ticket_xin_tang_cuong.sql).
   ============================================================ */
import { adminHeaders, forceReauth } from "./useUser";

export type TicketXtcScope = "noi-thanh" | "noi-vung";

/** Khớp đúng tên cột của bảng addon_trip_ticket (snake_case — giữ nguyên,
 *  không đổi sang camelCase, để đỡ phải map 2 chiều khi còn đang xây dựng). */
export interface AddonTripTicket {
  id: string;
  created_at: string;
  ticket_id: string;
  region: string | null;
  warehouse_name: string | null;
  warehouse_khac: string | null;
  lo_trinh: string | null;
  msnv: string | null;
  telegram: string | null;
  sdt: string | null;
  so_kien: number | null;
  the_tich: string | null;
  ngay_mong_muon: string | null;
  gio_mong_muon: string | null;
  ghi_chu: string | null;
  trang_thai: string | null;
  ngay_duyet: string | null;
  gio_toi: string | null;
  ma_chuyen: string | null;
  ten_ncc: string | null;
  bks: string | null;
  tai_trong: string | null;
  thong_tin_tx: string | null;
  note: string | null;
  ve_ktc: string | null;
  da_thong_bao_tele: boolean;
  bl: boolean;
  blacklist: string | null;
  thu_tu_diem: number | null;
  warehouse: string | null;
  tao_app_trigger: boolean;
  da_tao_app: string | null;
  hinh_kho: string | null;
  updated_at: string;
}

/** Các cột GSVT được sửa qua UI — PHẢI khớp EDITABLE_FIELDS ở api/ticket-xtc.ts. */
export type AddonTripTicketPatch = Partial<Pick<AddonTripTicket,
  "trang_thai" | "ngay_duyet" | "gio_toi" | "ma_chuyen" | "ten_ncc" |
  "bks" | "tai_trong" | "thong_tin_tx" | "ve_ktc" |
  "thu_tu_diem" | "warehouse" | "tao_app_trigger" | "da_tao_app"
>>;

export interface TicketXtcDateRange { from: string; to: string; } // "YYYY-MM-DD" (giờ VN)

/** range tuỳ chọn — không truyền thì API trả toàn bộ (không lọc ngày). UI luôn
 *  truyền range (mặc định "2 ngày gần nhất") để tránh kéo hết lịch sử mỗi lần mở trang. */
export async function loadTicketXtc(scope: TicketXtcScope, range?: TicketXtcDateRange, signal?: AbortSignal): Promise<AddonTripTicket[]> {
  const p = new URLSearchParams({ scope });
  if (range?.from) p.set("from", range.from);
  if (range?.to) p.set("to", range.to);
  const r = await fetch("/api/ticket-xtc?" + p.toString(), { signal, cache: "no-store" });
  const d = await r.json();
  if (!d?.ok) throw new Error(d?.error || "load_failed");
  return (d.rows || []) as AddonTripTicket[];
}

/** true = thành công, trả về dòng đã cập nhật (giá trị thật từ server, ví dụ
 *  updated_at mới) để cập nhật UI ngay. 401 (phiên hết hạn) tự đưa về màn đăng nhập. */
export async function saveTicketXtc(ticketId: string, patch: AddonTripTicketPatch): Promise<AddonTripTicket | null> {
  try {
    const r = await fetch("/api/ticket-xtc", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action: "save", ticketId, patch }),
    });
    if (r.status === 401) { forceReauth(); return null; }
    const d = await r.json();
    return d?.ok ? (d.row as AddonTripTicket) : null;
  } catch { return null; }
}
