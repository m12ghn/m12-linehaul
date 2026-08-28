/* ============================================================
   CẢNH BÁO GIỜ CẤM TẢI nội thành HCM cho lịch sắp xe.
   Quy tắc (SỬA TẠI ĐÂY nếu TP đổi quy định / cụm có ngưỡng riêng):
   - Van / xe ≤ 1.700kg  -> KHÔNG vướng cấm tải (đi được mọi khung giờ).
   - Xe tải nhẹ 1.900–2.500kg -> cấm giờ cao điểm 6:00–9:00 & 16:00–20:00.
   - Xe tải nặng > 2.500kg     -> cấm ban ngày 6:00–22:00.
   Quy định CHỈ áp dụng cho điểm nằm TRONG địa giới TP.HCM (xem isOutsideHcm() bên dưới) —
   trước đây áp bừa cho MỌI điểm bất kể ở đâu, nên báo sai điểm ở tỉnh khác (vd Sếp phát hiện
   2026-08-08: "Kho Chuyển Tiếp Sóng Thần" thực ra ở Bình Dương, không phải nội thành HCM).
   Đã CÂN NHẮC dùng khoảng cách toạ độ (haversineKm) để tự suy ra tỉnh nhưng KHÔNG đủ tin cậy:
   kiểm tra trên toạ độ thật trong geo.json thì "Kho GHN TP Thủ Đức, HCM" (10.897, 106.816) lại
   GẦN cụm Sóng Thần/Bình Dương hơn là gần trung tâm HCM — biên giới hành chính thật KHÔNG
   phải đường chia đôi khoảng cách đơn giản, dùng sẽ báo sai chỗ khác thay vì hết sai. Tín hiệu
   ĐÁNG TIN hơn: tên kho trong Sheet/MyMap LUÔN có hậu tố tỉnh/thành thật (do người tạo kho ghi
   đúng, vd "...Sóng Thần-Bình Dương", "...Tân Thuận - HCM") — dùng đúng hậu tố này để loại. */
import { normalizeName } from "./normalize";

const PEAK: [number, number][] = [[6 * 60, 9 * 60], [16 * 60, 20 * 60]]; // giờ cao điểm
const DAYTIME: [number, number][] = [[6 * 60, 22 * 60]];                 // cấm ban ngày

/** Tỉnh/thành KHÔNG áp quy định cấm tải nội thành TP.HCM — khớp theo hậu tố tỉnh trong tên
 *  kho/bưu cục (đã chuẩn hoá bỏ dấu). Rà theo dữ liệu geo.json thật của dự án (2026-08-08):
 *  mọi kho ngoài HCM đều có tên dạng "... - <Tỉnh>" (Bình Dương, Đồng Nai, Bà Rịa - Vũng Tàu…). */
const NGOAI_HCM_TOKENS = [
  "binh duong", "dong nai", "long an", "tay ninh", "ba ria vung tau", "vung tau",
  "binh phuoc", "ben tre", "tien giang", "can tho", "kien giang", "an giang",
  "dong thap", "vinh long", "hau giang", "soc trang", "ca mau", "bac lieu",
  "lam dong", "binh thuan", "ninh thuan", "khanh hoa", "dak lak", "dak nong", "gia lai",
];

function isOutsideHcm(name: string): boolean {
  const n = normalizeName(name);
  return NGOAI_HCM_TOKENS.some((t) => n.includes(t));
}

export interface CamTaiStop { name: string; toi: string; roi: string }
export interface CamTaiResult {
  subject: boolean;        // xe có thuộc diện cấm tải không
  tier: string;            // nhãn hạng xe
  windowsText: string;     // "6:00–9:00 & 16:00–20:00"
  hits: { name: string; time: string }[]; // điểm rơi vào giờ cấm
}

/** "HH:MM" (kể cả vượt 24h khi qua đêm) -> phút trong ngày (0–1439). */
function toMin(hhmm: string): number | null {
  const m = (hhmm || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) % 1440;
}
const hh = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const fmtWins = (w: [number, number][]) => w.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(" & ");
const inAny = (t: number, w: [number, number][]) => w.some(([a, b]) => t >= a && t < b);

/** Xác định hạng xe theo tải trọng + khung cấm tương ứng. */
export function tierOf(cap: number): { subject: boolean; tier: string; windows: [number, number][] } {
  if (cap <= 1700) return { subject: false, tier: "Van / xe ≤1.7T", windows: [] };
  if (cap <= 2500) return { subject: true, tier: "xe tải nhẹ (1.9–2.5T)", windows: PEAK };
  return { subject: true, tier: "xe tải nặng (>2.5T)", windows: DAYTIME };
}

/** Soi lịch: xe có vướng cấm tải không, điểm nào rơi vào giờ cấm. */
export function checkCamTai(cap: number, stops: CamTaiStop[]): CamTaiResult {
  const { subject, tier, windows } = tierOf(cap);
  if (!subject) return { subject: false, tier, windowsText: "", hits: [] };
  const hits: { name: string; time: string }[] = [];
  for (const s of stops) {
    if (isOutsideHcm(s.name)) continue; // điểm ở tỉnh khác -> quy định cấm tải HCM không áp dụng
    const a = toMin(s.toi), b = toMin(s.roi);
    // Xe có mặt tại điểm từ giờ TỚI đến giờ RỜI -> chạm khung cấm là cảnh báo.
    if ((a != null && inAny(a, windows)) || (b != null && inAny(b, windows))) {
      hits.push({ name: s.name, time: s.toi || s.roi });
    }
  }
  return { subject: true, tier, windowsText: fmtWins(windows), hits };
}
