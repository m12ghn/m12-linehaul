/* ============================================================
   Chuẩn hoá chuỗi để KHỚP tên Bưu Cục giữa Sheet và KML.
   LƯU Ý: logic này được nhân bản trong scripts/build-geo.mjs —
   sửa ở đây thì sửa luôn bên đó để 2 phía khớp nhau.
   ============================================================ */

/** Bỏ dấu tiếng Việt + đ->d, về chữ thường. */
export function stripAccents(s: string): string {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

/**
 * Chuẩn hoá mạnh để so khớp tên kho/bưu cục:
 * - bỏ dấu, chữ thường
 * - cắt tiền tố mã số đầu chuỗi (vd "22494000-(HCM)...", "23053000 ...")
 * - đưa mọi ký tự không phải [a-z0-9] về khoảng trắng (gộp khác biệt dấu '-')
 * - gộp khoảng trắng thừa
 */
export function normalizeName(s: string): string {
  let x = stripAccents(s);
  x = x.replace(/^\s*\d{3,}\s*[-_().\s]+/, " "); // cắt mã số dẫn đầu
  x = x.replace(/[^a-z0-9]+/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

/** Chuẩn hoá nhẹ để tìm kiếm (search) — giữ nguyên cấu trúc. */
export function normSearch(s: string): string {
  return stripAccents(s).replace(/\s+/g, " ").trim();
}

/** Viết tắt KHO của M12SC -> cụm tên đầy đủ (đã bỏ dấu) để khớp gợi ý & tìm kiếm.
 *  HCM20 = Kho Trung Chuyển Hồ Chí Minh 20 · HCM01 = …Minh 01 · TT = Tân Tạo · Q7 = Tân Thuận. */
const KHO_ALIASES: Record<string, string> = {
  hcm20: "ho chi minh 20",
  hcm01: "ho chi minh 01",
  hcm1: "ho chi minh 01",
  tt: "tan tao",
  q7: "tan thuan",
  st: "song than",
};

/** Mở rộng token viết tắt trong chuỗi ĐÃ bỏ dấu (vd "hcm20" -> "ho chi minh 20"). */
export function expandAliases(stripped: string): string {
  return (stripped || "").split(/\s+/).map((t) => KHO_ALIASES[t] || t).join(" ").trim();
}

/** Viết tắt tên kho — Sếp chốt 2026-08-26 (5 vòng chỉnh): CHỈ dùng ở dòng ĐẦU MỤC tóm tắt thẻ tuyến
 *  (vd "TUYẾN 1 | 10:15 | GHN Tân Tạo → HN02 | 8.000kg") — bảng chi tiết lộ trình ("Điểm / Kho")
 *  LUÔN hiện tên đầy đủ, KHÔNG qua hàm này (Sếp cần nguyên tên khi xem/chụp lộ trình chi tiết).
 *  Thử lần lượt các mẫu sau, dừng ở mẫu đầu tiên khớp:
 *  1) "Kho Giao Hàng Nặng - <quận/huyện> - <tỉnh/TP>" -> "GHN <quận/huyện>" (bỏ mã ID + tỉnh/TP cuối).
 *  2) "<tiền tố Kho/Trung Chuyển/Chuyển Tiếp> <tên vùng> <số>" -> chữ đầu mỗi từ tên vùng + số, vd
 *     "Kho Trung Chuyển Hồ Chí Minh 20" -> "HCM20", "Kho Trung Chuyển Hà Nội 02" -> "HN02".
 *  3) "Kho Trung Chuyển <địa danh>" (không có số cuối, mẫu 2 không khớp) -> "KTC <địa danh>", vd
 *     "Kho Trung Chuyển Cần Thơ" -> "KTC Cần Thơ" (giữ nguyên địa danh, chỉ đổi "Kho Trung Chuyển").
 *  4) "Kho Chuyển Tiếp <địa danh>" (không có số cuối) -> "KCT <địa danh>", vd "Kho Chuyển Tiếp Sóng
 *     Thần-Bình Dương" -> "KCT Sóng Thần-Bình Dương".
 *  Không khớp mẫu nào -> giữ nguyên tên đầy đủ (an toàn hơn đoán sai). Gặp kiểu tên mới cần viết tắt
 *  thì bổ sung thêm 1 mẫu riêng ở đây, không tự chế quy tắc khác. */
export function shortKhoName(raw: string): string {
  const s = raw || "";
  // Mẫu 1: "Kho Giao Hàng Nặng - <quận/huyện> - <tỉnh/TP>" (mã ID + đoạn tỉnh/TP cuối TUỲ CHỌN).
  const ghn = s.match(/^(?:\s*\d+\s*-\s*)?Kho\s+Giao\s+Hàng\s+Nặng\s*-\s*([^-]+?)(?:\s*-\s*[^-]+)?\s*$/i);
  if (ghn) return "GHN " + ghn[1].trim();
  // Mẫu 2: "<Kho/Trung Chuyển/Chuyển Tiếp> <tên vùng> <số>" -> chữ đầu tên vùng + số.
  const noId = s.replace(/^\s*\d+\s*-\s*/, "").trim();
  const stripped = stripAccents(noId).replace(/^kho\s+/, "").replace(/^(trung chuyen|chuyen tiep)\s+/, "");
  const m = stripped.match(/^([a-z\s]+?)\s*0*(\d{1,3})\s*$/);
  if (m) {
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase() + m[2].padStart(2, "0");
  }
  // Mẫu 3+4: "Kho Trung Chuyển <địa danh>" -> "KTC ..." · "Kho Chuyển Tiếp <địa danh>" -> "KCT ..."
  // — chỉ lấy ĐỊA DANH CHÍNH, bỏ phần "-<tỉnh/TP>" phía sau nếu có (Sếp chốt: "KCT Sóng Thần-Bình
  // Dương" -> "KCT Sóng Thần", bỏ luôn "Bình Dương").
  const ktc = noId.match(/^Kho\s+Trung\s+Chuyển\s+([^-]+)/i);
  if (ktc) return "KTC " + ktc[1].trim();
  const kct = noId.match(/^Kho\s+Chuyển\s+Tiếp\s+([^-]+)/i);
  if (kct) return "KCT " + kct[1].trim();
  return s;
}

/** Ngày ISO (yyyy-mm-dd...) rơi vào Thứ 7 (6) hoặc Chủ Nhật (0)? -> ngày cuối tuần đáng chú ý. */
export function isWeekendISO(iso: string): boolean {
  if (!iso || iso.length < 10) return false;
  const w = new Date(iso.slice(0, 10) + "T00:00:00").getDay();
  return w === 0 || w === 6;
}

/** Đổi giờ "4:15", "4h15", "13.05" -> số phút để sắp xếp. */
export function timeToMin(t: string): number {
  if (!t) return 999999;
  const m = stripAccents(t).replace(/h/g, ":").match(/(\d{1,2})[:.\s]?(\d{0,2})/);
  if (!m) return 999999;
  return parseInt(m[1] || "0", 10) * 60 + parseInt(m[2] || "0", 10);
}
