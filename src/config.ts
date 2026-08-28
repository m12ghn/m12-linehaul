/* ============================================================
   CẤU HÌNH TRUNG TÂM
   Mọi thông số (sheet, tab, tần suất, bản đồ) gom về đây.
   ============================================================ */
import type { SheetDef, TopMenu } from "./types";

export const SHEET_ID = "1M_yoD-7FPwmE_TjgoPklgysfiBA2Vhy7n3JZ3peC8ZI";

/**
 * Nguồn ƯU TIÊN #1 cho MỌI *CsvSources(): proxy server-side qua Cloudflare
 * Function /api/sheet-v4, gọi Google Sheets API v4 bằng API key (thay vì
 * trình duyệt người dùng gọi thẳng docs.google.com/gviz|export). Tránh phụ
 * thuộc IP/trình duyệt của người dùng bị Google tạm chặn/giới hạn tốc độ
 * (xảy ra 2026-08-14 do gọi Sheet dồn dập). gviz/export vẫn giữ làm dự
 * phòng #2/#3 — nếu proxy lỗi (thiếu API key, quota...), code tự rơi
 * xuống 2 nguồn cũ như trước, không thay đổi hành vi nếu proxy chưa xong.
 */
function apiV4Source(sheetId: string, gid: string): string {
  return `/api/sheet-v4?id=${sheetId}&gid=${gid}`;
}
function apiV4SourceByName(sheetId: string, sheetName: string): string {
  return `/api/sheet-v4?id=${sheetId}&sheet=${encodeURIComponent(sheetName)}`;
}

/** Tab "BC xin tăng cường" (form ticket xin xe TC) trong workbook chính. */
export const XIN_TC_GID = "907458113";

/** Tab "Lưu trữ TC EVENT" — lịch TC cố định của kỳ event (mỗi SG_TCEV = 1 xe). */
export const TC_EVENT_GID = "361704153";

/** Sheet 17 (workbook TLLD) — TLLD tuyến TC theo ngày event (pivot). */
export const TC_TLLD_GID = "15227999";

/** Tab "Điều chỉnh - Báo NCC" trong workbook chính — log mọi lượt điều chỉnh/mở mới/huỷ tuyến. */
export const DIEU_CHINH_NCC_GID = "1166787822";

/** Bản đồ MyMap của bạn (dùng cho chế độ xem MyMap gốc) */
export const MAP_MID = "13GsCLPeCyljbEDsSa05HHy0-trvNAOM";

/** Sheet toạ độ kho/BC CHÍNH THỨC toàn quốc (Sếp cung cấp 2026-08-21) — thay cho MyMap KML đang
 *  bị Google chặn 403 (đã xác nhận không sửa được qua Drive API, xem functions/api/geo.ts).
 *  Có warehouse_id/warehouse_name/latitude/longitude, cập nhật thường xuyên, đọc qua OAuth Sheets
 *  (đã chạy ổn định) thay vì link KML công khai. */
export const WAREHOUSE_GEO_SHEET_ID = "1lqkSifW2ROTnlYMqhBNcKgHgDd5z-ktcn60cCawqyRs";
export const WAREHOUSE_GEO_GID = "0";

/** Tần suất tự đồng bộ realtime (ms) */
export const REFRESH_MS = 60 * 1000;

/** Tần suất nạp lại toạ độ kho/BC (ms) — sheet ~1.600 dòng toàn quốc, nặng hơn CSV thường nên giãn cách dài hơn REFRESH_MS. */
export const GEO_REFRESH_MS = 5 * 60 * 1000;

/**
 * Nguồn dữ liệu TLLD (tỷ lệ lấp đầy) — workbook riêng.
 * 4 tab hub cùng cấu trúc (cột 0=ngày, 3=mã tuyến, 10=tlld_weight),
 * gộp lại để tra theo mã tuyến.
 */
export const TLLD_SHEET_ID = "1VfkJ6HOzCbidoCGqNTnU2Qs2nNMxwkKJw2_gKTSSchM";
export const TLLD_TABS: { gid: string; hub: string }[] = [
  { gid: "1276580053", hub: "HCM01" },
  { gid: "1306265684", hub: "HCM20" },
  { gid: "294568716", hub: "Sóng Thần" },
  { gid: "1240709030", hub: "Tân Tạo" },
];

/**
 * Nguồn CSV cho workbook TLLD. ƯU TIÊN gviz (đọc trực tiếp model sheet -> cập
 * nhật gần realtime); export là dự phòng (Google cache snapshot -> trễ vài phút).
 */
export function tlldCsvSources(gid: string): string[] {
  return [
    apiV4Source(TLLD_SHEET_ID, gid),
    `https://docs.google.com/spreadsheets/d/${TLLD_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${TLLD_SHEET_ID}/export?format=csv&gid=${gid}`,
  ];
}

/**
 * Nguồn THÔNG TIN XE (biển số + SĐT + tài xế) theo mã tuyến — workbook điều phối.
 * Gộp các tab có cột BKS/SDT, tra theo mã tuyến.
 */
export const VEHICLE_SHEET_ID = "1YBnuXDh6pZEQ0DpfLCPYV1jNK6J4CtocuP7FM1VeOxc";
export const VEHICLE_TABS: string[] = [
  "555582603", // TẢI CẤM + NỘI VÙNG
  "363552999", // LỊCH MỐC 20H
  "570963534", // SÓNG THẦN
  "1947785067", // TÂN TẠO
];
export function vehicleCsvSources(gid: string): string[] {
  return [
    apiV4Source(VEHICLE_SHEET_ID, gid),
    `https://docs.google.com/spreadsheets/d/${VEHICLE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${VEHICLE_SHEET_ID}/export?format=csv&gid=${gid}`,
  ];
}

/**
 * Workbook GXT (bảng cổng xuất làm tay) — biển số nhồi trong ô/tiêu đề.
 * Dùng chế độ "cào" (quét mọi ô bắt cặp mã tuyến ↔ biển số). Không có SĐT.
 */
export const GXT_SHEET_ID = "1otLFPSLRKtBk-2WXdXnVSHbJMwtIzqMBmJnZ5M7bl7c";
export const GXT_TABS: string[] = [
  "901063597", // GXT-HUY 25.06
  "787236888", // GXT-HUY 26.06
  "1757305320", // GXT Thủ Đức nháp NEW
  "1892953261", // Chị Tú coi ở đây
];
export function gxtCsvSources(gid: string): string[] {
  return [
    apiV4Source(GXT_SHEET_ID, gid),
    `https://docs.google.com/spreadsheets/d/${GXT_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${GXT_SHEET_ID}/export?format=csv&gid=${gid}`,
  ];
}

/**
 * Tab "Tăng Cường" trong workbook chính (đổi theo ngày).
 * Hiện chỉ có "Tăng Cường Lấy" (gid 414498895). Khi có tab "Tăng cường Giao"
 * thì điền gid vào TANG_CUONG_GIAO_GID để tự bật mục đó.
 */
// Tăng Cường Lấy & Giao NẰM CHUNG 1 tab (gid 414498895), ngăn bởi dòng "TĂNG CƯỜNG GIAO":
// phần trên = Lấy (SG_TCEV), phần dưới = Giao (TC_*). Tách section theo loại trong loadTangCuong.
export const TANG_CUONG_LAY_GID = "414498895";
export const TANG_CUONG_GIAO_SHEET_ID = SHEET_ID;
export const TANG_CUONG_GIAO_GID = "414498895";

/** Kỳ event T6 (tháng 6) — để SO SÁNH số xe book NCC với kỳ hiện tại. */
export const EVENT_T6_GID = "587684422";

/** Tương thích cũ */
export const TANG_CUONG_GID = TANG_CUONG_LAY_GID;

/**
 * KHO KIẾN THỨC BỔ SUNG (đọc tự động mỗi ngày 1 lần vào CSDL Dash + nạp cho trợ lý).
 * Workbook do Sếp cung cấp — PHẢI công khai "Bất kỳ ai có đường liên kết → Người xem".
 * Thêm gid của từng tab cần đọc vào KNOWLEDGE_SHEET_GIDS.
 */
export const KNOWLEDGE_SHEET_ID = "1mvu295K_b3AtVkAyNSZKrYHAU-xlp-UyhwZ8CXQUKks";
export const KNOWLEDGE_SHEET_GIDS = ["0"]; // bổ sung gid các tab khác sau khi sheet công khai
export const KNOWLEDGE_SHEET_NAME = "Kiến thức bổ sung M12";

/** Nguồn CSV cho 1 workbook + gid bất kỳ (gviz trước, export sau). */
export function sheetCsvSources(sheetId: string, gid: string): string[] {
  return [
    apiV4Source(sheetId, gid),
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
  ];
}

/**
 * Tab "Sản Lượng" trong workbook chính -> menu con tương ứng.
 * Đọc bằng gviz theo TÊN tab (không cần gid). Tab nào chưa có data thì
 * không khai báo -> menu đó vẫn dùng nhập tay.
 */
export const SL_SHEETS: Record<string, string> = {
  "ktc-hcm20": "SL HCM20",
  "ktc-st": "SL ST",
};

/**
 * Nguồn phân tích biến động sản lượng LẤY HÀNG theo bưu cục cụm M12 — tab "ST LAY BC"
 * trong đúng workbook chính (SHEET_ID), KHÔNG còn qua workbook chép tay riêng.
 * Cột: dt | warehouse_id | warehouse_name | district_name | volume | weight_kg.
 * Chỉ chứa category "1. Lấy hàng" — mỗi dòng = 1 BC × 1 ngày. Dashboard tự đọc realtime qua gviz.
 */
export const BC_LAY_GID = "266027908";
export function bcLayCsvSources(): string[] {
  return [
    apiV4Source(SHEET_ID, BC_LAY_GID),
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${BC_LAY_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${BC_LAY_GID}`,
  ];
}

/**
 * Tab LỊCH TRỰC GSVT trong workbook chính — đọc theo TÊN tab (không cần gid).
 * Tạo 1 tab tên đúng như dưới, cột: Ca | Khung giờ | Họ tên | SĐT.
 * Chưa tạo tab -> Dash tự dùng lịch trực mặc định trong src/lib/gsvt.ts.
 */
export const GSVT_ROSTER_SHEET = "LỊCH TRỰC GSVT";

/** Email nhận góp ý */
export const FEEDBACK_EMAIL = "bachht@ghn.vn";

/** Tâm bản đồ mặc định (TP.HCM) */
export const MAP_CENTER: [number, number] = [10.776, 106.7];
export const MAP_ZOOM = 11;

/**
 * 6 tab (sheet) của Google Sheet — khớp menu "Lịch Tải" cấp 2.
 * key dùng nội bộ, gid là id tab thật, label là tên hiển thị.
 */
export const SHEETS: SheetDef[] = [
  { key: "noi-thanh-hcm", gid: "0", label: "Nội Thành HCM" },
  // Nội Vùng HCM — M12 KHÔNG quản nữa (Sếp chốt 2026-07-24): ẩn khỏi mọi bộ chọn vùng trên UI
  // (hidden). VẪN GIỮ entry ở đây (không xoá) vì tlldExclude.ts nạp gid này để lấy danh sách mã
  // tuyến Nội Vùng rồi LOẠI khỏi báo cáo TLLD tổng cụm — xoá hẳn sẽ làm tuyến Nội Vùng lọt ngược vào tổng.
  { key: "noi-vung-hcm", gid: "961518640", label: "Nội Vùng HCM", hidden: true },
  { key: "lien-vung-mn", gid: "84848529", label: "Liên Vùng MN" },
  { key: "mbh-song-than", gid: "541305122", label: "MBH Sóng Thần" },
  { key: "mbh-tan-tao", gid: "1937583700", label: "MBH Tân Tạo" },
  { key: "mbh-tan-thuan-q7", gid: "722712650", label: "MBH Tân Thuận Q7" },
];

/** Các vùng HIỂN THỊ trên UI (bỏ vùng `hidden`). Dùng ở MỌI bộ chọn vùng (SheetTabs, dropdown
 *  TLLD/Ghép Tải, điều hướng AI). Logic tổng hợp/loại trừ nội bộ vẫn dùng `SHEETS` đầy đủ. */
export const VISIBLE_SHEETS: SheetDef[] = SHEETS.filter((s) => !s.hidden);

/** Vùng KHÔNG thuộc phạm vi M12 quản lý (đã chốt với Sếp) — loại khỏi mọi số liệu TỔNG HỢP
 *  cấp cụm (năng lực NCC cố định `nccFixedCapacity.ts`, đội xe/tải trọng `fleetMix.ts`...).
 *  Tab "noi-vung-hcm" (gid 961518640) hiện KHÔNG còn là dữ liệu tuyến Lịch Tải nữa (nội dung
 *  đã đổi thành bảng BC↔NCC↔chat_id khác cấu trúc hoàn toàn, không có cột tải trọng) — càng
 *  cần loại trừ khỏi tổng hợp, nếu không mọi tuyến trong đó bị tính nhầm thành "chưa ghi tải".
 *  VẪN GIỮ trong `SHEETS` để menu "Lịch Tải" xem riêng tab này khi cần — chỉ loại khỏi TỔNG cụm. */
export const EXCLUDED_REGION_KEYS = ["noi-vung-hcm"];

/** Menu cấp 1 — các mục đích khác nhau của dashboard */
export const TOP_MENUS: { key: TopMenu; label: string }[] = [
  { key: "tong-quan", label: "Tổng Quan" },
  { key: "lich-tai", label: "Lịch Tải" },
  // ĐÃ ẨN theo yêu cầu — toàn bộ code/dữ liệu (view LoTrinh) vẫn còn nguyên.
  // MỞ LẠI: bỏ comment dòng dưới là menu "Lộ trình" hiện lại ngay.
  // { key: "lo-trinh", label: "Lộ trình" },
  { key: "tlld-tuyen", label: "TLLD Tuyến" },
  { key: "tang-cuong", label: "Vùng HCM" },
  { key: "san-luong", label: "Sản Lượng" },
  { key: "ds-ncc", label: "Performance NCC" },
  { key: "plan-event", label: "Plan Event" },
  { key: "sap-lich-tai", label: "Trợ lý Lịch Tải" },
  { key: "phan-quyen", label: "Phân quyền" },
];

/**
 * Nhãn đẹp cho từng giá trị cột "Loại tuyến" (menu cấp 3).
 * Giá trị không có trong map sẽ hiển thị nguyên văn.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  "Nội thành CK 1": "Nội thành CK 1",
  "Nội thành CK2": "Nội thành CK 2",
  "Nội thành CA1": "Nội thành CA 1",
  "Nội thành CA2": "Nội thành CA 2",
  "Lấy Trưa": "Lấy Trưa",
  "Lấy HCM01": "Lấy HCM01",
  "Lấy HCM20": "Lấy HCM20",
  "Lấy 2 Kho": "Lấy 2 Kho",
  "Lấy Chiều": "Lấy Chiều",
  "Lấy MBH TT": "Lấy MBH TT",
  "Lấy MBH ST": "Lấy MBH ST",
  "Lấy MBH Q7": "Lấy MBH Q7",
  "01_FW_20": "01_FW_20",
  GHN: "GHN",
};

/** Thứ tự ưu tiên menu cấp 3 (giá trị không liệt kê xếp sau, theo alphabet) */
export const CATEGORY_ORDER = [
  "Nội thành CK 1", "Nội thành CK2", "Nội thành CA1", "Nội thành CA2",
  "Lấy Trưa", "Lấy HCM01", "Lấy HCM20", "Lấy 2 Kho", "Lấy Chiều",
  "Lấy MBH TT", "Lấy MBH ST", "Lấy MBH Q7", "01_FW_20", "GHN",
];

/**
 * Nguồn CSV. ƯU TIÊN gviz (đọc trực tiếp model sheet -> cập nhật gần realtime).
 * export?format=csv là dự phòng (Google redirect sang googleusercontent + cache
 * snapshot -> edit mới bị trễ vài phút). /api/sheet proxy là dự phòng cuối khi
 * cả 2 bị chặn CORS (vd mở file:// cục bộ).
 */
export function csvSources(gid: string): string[] {
  return [
    apiV4Source(SHEET_ID, gid),
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
  ];
}

/** Nguồn theo TÊN tab (không cần gid) — dùng cho SL_SHEETS, GSVT_ROSTER_SHEET, "FC HCM20"/"FC ST". */
export function csvSourcesByName(sheetName: string): string[] {
  return [
    apiV4SourceByName(SHEET_ID, sheetName),
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
  ];
}
