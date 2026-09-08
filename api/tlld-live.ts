/* ============================================================
   ĐỌC TLLD CHO GIAO DIỆN — nguồn Supabase (view m12.tlld_trip, 0005),
   thay cho việc đọc thẳng 4 tab CSV của workbook TLLD cũ.

   GET /api/tlld-live                 -> TOÀN BỘ lịch sử đã nạp
   GET /api/tlld-live?tu=...&den=...  -> lọc theo ngay (nửa khoảng [tu, den))

   Đọc mở, không cần đăng nhập — cùng mức với các endpoint đọc khác (vd.
   api/overview.ts action "get"), vì đây chỉ là số liệu vận hành nội bộ đã
   hiện trên dashboard công khai trong công ty, không phải dữ liệu nhạy cảm
   theo vai trò như api/roles hay api/accounts.

   view tlld_trip đã tự khử trùng lặp điểm-dừng -> chuyến (xem 0005), nên ở
   đây chỉ việc đọc và trả nguyên, KHÔNG xử lý gì thêm. Toàn bộ phép tính
   (TB 7 ngày, cuốn chiếu, tuần lịch...) vẫn nằm ở src/lib/tlld.ts như cũ —
   endpoint này chỉ đổi NGUỒN, không đổi CÁCH TÍNH.
   ============================================================ */
import { selectAll, json } from "./_lib/supabase";

export const config = { runtime: "edge" };

interface DongChuyen {
  ngay: string;
  ma_chuyen: string;
  ma_tuyen: string | null;
  code_norm: string | null;
  loai_lich: string | null;
  loai_tai: string | null;
  hub: string | null;
  bien_so: string | null;
  partner_code: string | null;
  partner_type: string | null;
  tai_trong_xe: number | null;
  is_van: boolean;
  is_special: boolean;
  khoiluong_kg: number | null;
  so_don_hang: number | null;
  tlld_weight_chuyen: number | null;
  tlld_vol_chuyen: number | null;
  kho_dau: string | null;
}

interface DiemDung {
  ngay: string;
  ma_chuyen: string;
  thu_tu: number;
  kho: string | null;
  kho_truoc_do: string | null;
  kho_tiep_theo: string | null;
  loai_tai: string | null;
  khoiluong_kg: number | null;
  so_don_hang: number | null;
  tlld_weight_diem: number | null;
  tlld_vol_diem: number | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const u = new URL(req.url);

    // ?muc=diem&ma_chuyen=... -> CHI TIẾT TỪNG ĐIỂM DỪNG của 1 chuyến (mức thấp nhất, tlld_daily —
    // xem 0004), khác mặc định bên dưới (view tlld_trip, đã gộp 1 dòng/chuyến). Tải RIÊNG theo yêu
    // cầu (1 mã chuyến/lần) — 1 chuyến trung bình ~3.3 điểm dừng (đo thật 30/08: 2647 điểm/809
    // chuyến), tải hết mọi chuyến mọi ngày sẽ nặng gấp nhiều lần không cần thiết. Thêm 01/09/2026
    // khi rebuild TLLD Tuyến (Sếp yêu cầu góc nhìn "theo điểm dừng" bên cạnh "cả chuyến").
    const muc = u.searchParams.get("muc");
    if (muc === "diem") {
      const maChuyen = (u.searchParams.get("ma_chuyen") || "").trim();
      if (!maChuyen) return json({ error: "thieu_ma_chuyen" }, 400);
      const rows = await selectAll<DiemDung>("tlld_daily", {
        select:
          "ngay,ma_chuyen,thu_tu,kho,kho_truoc_do,kho_tiep_theo,loai_tai," +
          "khoiluong_kg,so_don_hang,tlld_weight_diem,tlld_vol_diem",
        filter: { ma_chuyen: "eq." + maChuyen },
        order: "thu_tu.asc",
      });
      return json({ ok: true, ma_chuyen: maChuyen, so_diem: rows.length, rows });
    }

    const tu = u.searchParams.get("tu");
    const den = u.searchParams.get("den");
    const filter: Record<string, string> = {};
    if (tu && den) filter.and = `(ngay.gte.${tu},ngay.lt.${den})`;
    else if (tu) filter.ngay = "gte." + tu;
    else if (den) filter.ngay = "lt." + den;

    const rows = await selectAll<DongChuyen>("tlld_trip", {
      select:
        "ngay,ma_chuyen,ma_tuyen,code_norm,loai_lich,loai_tai,hub,bien_so,partner_code," +
        "partner_type,tai_trong_xe,is_van,is_special,khoiluong_kg,so_don_hang," +
        "tlld_weight_chuyen,tlld_vol_chuyen,kho_dau",
      filter,
      order: "ngay.asc",
    });

    return json({ ok: true, so_chuyen: rows.length, rows });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
