/* ============================================================
   Đọc tab "Điều chỉnh - Báo NCC" (gid=DIEU_CHINH_NCC_GID, cùng workbook Lịch Tải) — log mỗi lượt
   NCC/vận hành điều chỉnh/mở mới/huỷ/thêm điểm/đổi lộ trình 1 tuyến, dùng cho "Báo cáo Điều chỉnh".
   Mỗi dòng điểm dừng của 1 tuyến lặp lại y hệt Dạng/Ngày chạy/cột trạng thái -> gộp theo
   (Tên tuyến, Ngày chạy) ra đúng 1 "lượt điều chỉnh". Chỉ giữ dòng đã đánh dấu XONG.
   LƯU Ý (2026-08-11): Sheet gốc từng đặt tên cột trạng thái là "Tool", ops đã đổi thành "Update" +
   thêm nhiều cột mới (Tải trọng/ID/Tên kho/Loại hình/Tới điểm/Rời điểm) — đổi tên cột này từng làm
   findCol() không tìm ra, mọi dòng bị coi "chưa xong" nên loại sạch -> báo cáo trống rỗng im lặng
   (không lỗi, không cảnh báo). Tìm CẢ 2 tên để chịu được nếu Sheet đổi tên cột này lần nữa.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { csvSources, DIEU_CHINH_NCC_GID } from "../config";
import { fetchWithTimeout } from "./fetchTimeout";

/** Nhãn "Dạng" đã chuẩn hoá — Sheet gốc có lẫn 2 cách viết hoa khác nhau cho cùng 1 giá trị
 *  ("Điều chỉnh" / "Điều Chỉnh"), phải gộp về đúng 1 nhãn trước khi đếm. */
export type DangDieuChinh = "Điều chỉnh" | "Mở mới" | "Huỷ" | "Thêm điểm" | "Đổi lộ trình" | "OFF";
const DANG_CANON: { key: string; label: DangDieuChinh }[] = [
  { key: "dieu chinh", label: "Điều chỉnh" },
  { key: "mo moi", label: "Mở mới" },
  { key: "huy", label: "Huỷ" },
  { key: "them diem", label: "Thêm điểm" },
  { key: "doi lo trinh", label: "Đổi lộ trình" },
  { key: "off", label: "OFF" },
];
function normDang(s: string): DangDieuChinh | null {
  const t = (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
  const hit = DANG_CANON.find((d) => d.key === t);
  return hit ? hit.label : null;
}

/** "28/6/2026" -> "2026-06-28". LƯU Ý: sheet này ghi ngày kiểu d/m/yyyy (28 không thể là tháng),
 *  KHÁC với tlld.ts (sheet TLLD ghi kiểu m/d/yyyy, vd "6/15/2026") — m[1]=ngày, m[2]=tháng ở ĐÂY,
 *  ngược thứ tự so với tlld.ts. Nhầm lẫn này từng gây "Invalid time value" crash cho ngày >12
 *  (vd "20/7/2026" -> tháng "20" không tồn tại) — đã verify lại bằng script đối chiếu data thật. */
function parseDate(s: string): string | null {
  const t = (s || "").trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export interface DieuChinhEntry {
  route: string;
  ngayChay: string; // ISO yyyy-mm-dd
  dang: DangDieuChinh;
  ncc: string;
  kho: string; // điểm đại diện (dòng đầu tiên gặp của lượt điều chỉnh này)
}
export interface DieuChinhData { entries: DieuChinhEntry[]; ok: boolean; lastSync: number; }

async function fetchFirst(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const base of sources) {
    try {
      const sep = base.includes("?") ? "&" : "?";
      const res = await fetchWithTimeout(base + sep + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5 && !/Unauthorized|requires you to sign in/i.test(t.slice(0, 200))) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

// Cache TTL + gộp request trùng (giống sheet.ts) — trước đây KHÔNG có, mỗi lần bấm sang tab "Báo
// Cáo" (unmount/mount lại DieuChinhReport) đều tải lại dù vừa xem xong vài giây trước.
const DIEU_CHINH_TTL = 40000;
let dieuChinhCache: { at: number; data: DieuChinhData } | null = null;
let dieuChinhInflight: Promise<DieuChinhData> | null = null;

export async function loadDieuChinhNcc(signal?: AbortSignal, force = false): Promise<DieuChinhData> {
  if (!force) {
    if (dieuChinhCache && Date.now() - dieuChinhCache.at < DIEU_CHINH_TTL) return dieuChinhCache.data;
    if (dieuChinhInflight) return dieuChinhInflight;
  }
  const run = loadDieuChinhNccUncached(signal).then((data) => {
    dieuChinhCache = { at: Date.now(), data };
    return data;
  });
  dieuChinhInflight = run;
  try { return await run; } finally { dieuChinhInflight = null; }
}

async function loadDieuChinhNccUncached(signal?: AbortSignal): Promise<DieuChinhData> {
  const text = await fetchFirst(csvSources(DIEU_CHINH_NCC_GID), signal);
  if (!text) return { entries: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { entries: [], ok: false, lastSync: Date.now() };

  const H = rows[0];
  const cRoute = findCol(H, ["ten tuyen", "ma tuyen"]) >= 0 ? findCol(H, ["ten tuyen", "ma tuyen"]) : 0;
  const cNcc = findCol(H, ["ncc"]);
  const cKho = findCol(H, ["ten kho", "kho", "buu cuc"]);
  const cNgay = findCol(H, ["ngay chay", "ngay"]);
  const cDang = findCol(H, ["dang"]);
  const cTool = findCol(H, ["update", "tool"]);
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  // Gộp theo (route, ngayChay) — mỗi lượt điều chỉnh có nhiều dòng điểm dừng lặp lại y hệt thông tin.
  const seen = new Map<string, DieuChinhEntry>();
  for (const r of rows.slice(1)) {
    const route = g(r, cRoute);
    if (!route) continue;
    const tool = g(r, cTool).toLowerCase();
    if (tool !== "xong") continue; // chỉ lấy lượt ĐÃ XONG
    const ngayChay = parseDate(g(r, cNgay));
    if (!ngayChay) continue;
    // Chặn lỗi nhập liệu năm (đã thấy thật trên Sheet: "3/7/2024", "30/6/3036" — lẽ ra 2026) —
    // KHÔNG tự "sửa" thành năm khác, chỉ loại khỏi báo cáo vì 1 dòng năm sai sẽ làm lệch cả việc
    // xác định "tuần mới nhất/đang chạy" (dòng năm 3036 sẽ luôn bị coi là "mới nhất, đang chạy").
    const rowYear = Number(ngayChay.slice(0, 4));
    const nowYear = new Date().getFullYear();
    if (Math.abs(rowYear - nowYear) > 1) continue;
    const dang = normDang(g(r, cDang));
    if (!dang) continue;
    const key = route + "|" + ngayChay;
    if (seen.has(key)) continue; // đã có đại diện cho lượt này (dòng điểm dừng đầu tiên)
    seen.set(key, { route, ngayChay, dang, ncc: g(r, cNcc), kho: g(r, cKho) });
  }
  return { entries: [...seen.values()], ok: true, lastSync: Date.now() };
}
