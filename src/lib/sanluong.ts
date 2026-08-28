/* ============================================================
   Đọc & phân tích SẢN LƯỢNG kho (workbook chính).
   - Tab "SL HCM20" -> menu "KTC HCM20"
   - Tab "SL ST"    -> menu "KTC SÓNG THẦN"
   Cấu trúc cột (2 tab giống nhau, chỉ khác tên):
     date|action_date, warehouse_id, warehouse_name, loai_hang,
     type (phép: Nhận/Rã/Xuất/Đóng Kiện), vol|order_count,
     weight_kg|total_weight, Week, Month
   Số theo định dạng VN: "." ngăn nghìn, "," thập phân.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { withRetry } from "./retry";
import { csvSourcesByName } from "../config";

export interface SlRow {
  date: string; // YYYY-MM-DD
  warehouse: string;
  loaiHang: string; // Freight / Normal / Bulky
  op: string; // Nhận Kiện / Rã Kiện / Xuất Kiện / Đóng Kiện
  vol: number; // sản lượng (kiện / đơn)
  kg: number; // khối lượng (kg)
  week: string; // "Tuần 44"
  month: string; // "2025-11"
}
export interface SlData {
  rows: SlRow[];
  lastSync: number;
}

/** "108.025,41" -> 108025.41 ; "4.405" -> 4405 ; "11" -> 11 */
export function parseVN(s: string): number {
  if (!s) return 0;
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

function sources(sheetName: string): string[] {
  return csvSourcesByName(sheetName);
}

async function fetchFirstOnce(urls: string[], signal?: AbortSignal): Promise<string> {
  for (const base of urls) {
    const sep = base.includes("?") ? "&" : "?";
    const res = await fetch(base + sep + "_=" + Date.now(), { cache: "no-store", signal });
    if (res.ok) {
      const t = await res.text();
      if (t.trim().length > 20 && !/Unauthorized|requires you to sign in/i.test(t.slice(0, 200))) return t;
    }
  }
  throw new Error("Không tải được nguồn sản lượng");
}

/** Tải CSV sản lượng — tự thử lại khi Google lỗi tạm thời; hết lượt vẫn lỗi -> null. */
async function fetchFirst(urls: string[], signal?: AbortSignal): Promise<string | null> {
  try {
    return await withRetry(() => fetchFirstOnce(urls, signal));
  } catch {
    return null;
  }
}

export async function loadSanLuong(sheetName: string, signal?: AbortSignal): Promise<SlData> {
  const text = await fetchFirst(sources(sheetName), signal);
  if (!text) return { rows: [], lastSync: Date.now() };
  const raw = parseCSV(text);
  if (raw.length < 2) return { rows: [], lastSync: Date.now() };
  const H = raw[0];
  const cDate = findCol(H, ["date", "action_date", "ngay"]);
  const cWh = findCol(H, ["warehouse_name", "kho"]);
  const cLoai = findCol(H, ["loai_hang", "loai hang"]);
  const cType = findCol(H, ["type", "phep"]);
  const cVol = findCol(H, ["vol", "order_count", "san luong"]);
  const cKg = findCol(H, ["weight_kg", "total_weight", "weight"]);
  const cWeek = findCol(H, ["week", "tuan"]);
  const cMonth = findCol(H, ["month", "thang"]);
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  const rows: SlRow[] = [];
  for (const r of raw.slice(1)) {
    const date = g(r, cDate);
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    rows.push({
      date: date.slice(0, 10),
      warehouse: g(r, cWh),
      loaiHang: g(r, cLoai),
      op: g(r, cType),
      vol: parseVN(g(r, cVol)),
      kg: parseVN(g(r, cKg)),
      week: g(r, cWeek),
      month: g(r, cMonth),
    });
  }
  return { rows, lastSync: Date.now() };
}

/* ------------------------ Tổng hợp theo kỳ ------------------------ */

export type Gran = "day" | "week" | "month";
export type Metric = "vol" | "kg";

export interface Bucket {
  key: string; // khoá sắp xếp (ISO)
  label: string; // nhãn hiển thị
  total: number; // tổng metric đã chọn
  byLoai: Record<string, number>; // tách theo loại hàng
}

/** Thứ Hai của tuần chứa ngày d (YYYY-MM-DD) -> ISO date, để gom & sắp tuần. */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // 0 = Mon
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Lọc theo kho + phép, rồi gom theo mốc thời gian.
 * warehouse="" / op="" nghĩa là lấy tất cả.
 */
export function bucketize(
  rows: SlRow[],
  metric: Metric,
  gran: Gran,
  warehouse: string,
  op: string
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    if (warehouse && r.warehouse !== warehouse) continue;
    if (op && r.op !== op) continue;
    let key: string, label: string;
    if (gran === "month") {
      key = r.month || r.date.slice(0, 7);
      label = "Th" + (key.slice(5) || "") + "/" + key.slice(0, 4);
    } else if (gran === "week") {
      key = mondayOf(r.date);
      label = r.week || key;
    } else {
      key = r.date;
      label = r.date.slice(5); // MM-DD
    }
    let b = map.get(key);
    if (!b) { b = { key, label, total: 0, byLoai: {} }; map.set(key, b); }
    const v = metric === "vol" ? r.vol : r.kg;
    b.total += v;
    b.byLoai[r.loaiHang] = (b.byLoai[r.loaiHang] || 0) + v;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Danh sách giá trị duy nhất theo cột (giữ thứ tự xuất hiện hợp lý). */
export function distinct(rows: SlRow[], pick: (r: SlRow) => string): string[] {
  return [...new Set(rows.map(pick).filter(Boolean))];
}

const sumBy = (rs: SlRow[], m: Metric) => rs.reduce((a, r) => a + (m === "vol" ? r.vol : r.kg), 0);
const fmtN = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Tóm tắt TOÀN BỘ dữ liệu sản lượng thành văn bản súc tích để gửi cho trợ lý AI
 * (đọc hết: theo tháng/tuần/ngày × phép, cơ cấu loại hàng, theo kho).
 */
export function buildDigest(data: SlData, title: string, tlld?: string): string {
  const rows = data.rows;
  if (!rows.length) return `Không có dữ liệu sản lượng cho ${title}.`;
  const dates = rows.map((r) => r.date).sort();
  const warehouses = distinct(rows, (r) => r.warehouse);
  const ops = distinct(rows, (r) => r.op);
  const loais = distinct(rows, (r) => r.loaiHang);
  const out: string[] = [];

  out.push(`DỮ LIỆU SẢN LƯỢNG KHO — ${title}`);
  out.push(`Phạm vi: ${fmtN(rows.length)} dòng, ${dates[0]} → ${dates[dates.length - 1]}.`);
  out.push(`Kho: ${warehouses.join(", ")}. Phép (thao tác): ${ops.join(", ")}. Loại hàng: ${loais.join(", ")}.`);
  out.push(`Đơn vị: "kiện" = số kiện (sản lượng); "kg" = khối lượng.`);

  // Đưa các mục QUAN TRỌNG cho kết luận nhanh (cơ cấu, theo kho, TLLD) lên TRƯỚC phần lịch sử
  // theo tháng — vì toàn văn bản bị cắt cứng ở 60.000 ký tự trước khi gửi AI (functions/api/
  // assistant.ts); nếu 1 phần bị cắt thì nên mất chi tiết lịch sử cũ, không phải phần tóm tắt.
  const loaiLine = (m: Metric) => loais.map((l) => `${l} ${fmtN(sumBy(rows.filter((r) => r.loaiHang === l), m))}`).join(", ");
  out.push(`\n== CƠ CẤU LOẠI HÀNG (toàn kỳ) ==\n  kiện: ${loaiLine("vol")}\n  kg: ${loaiLine("kg")}`);

  if (warehouses.length > 1) {
    const whLine = warehouses
      .map((w) => `${w}: ${fmtN(sumBy(rows.filter((r) => r.warehouse === w), "vol"))} kiện / ${fmtN(sumBy(rows.filter((r) => r.warehouse === w), "kg"))} kg`)
      .join("\n  ");
    out.push(`\n== THEO KHO (toàn kỳ) ==\n  ${whLine}`);
  }

  if (tlld && tlld.trim()) out.push(`\n== TLLD HIỆN TẠI (tỷ lệ lấp đầy tuyến) ==\n${tlld.trim()}`);

  // Giới hạn 12 tháng GẦN NHẤT (khớp cách tuần/ngày đã giới hạn bên dưới) — tránh phình vô hạn
  // theo thời gian rồi bị cắt mất phần quan trọng ở trên khi chạm giới hạn 60.000 ký tự.
  const monthsAll = [...new Set(rows.map((r) => r.month).filter(Boolean))].sort();
  const months = monthsAll.slice(-12);
  const monLine = (m: Metric) =>
    months
      .map((mo) => {
        const rs = rows.filter((r) => r.month === mo);
        const byOp = ops.map((o) => `${o.replace(" Kiện", "")} ${fmtN(sumBy(rs.filter((r) => r.op === o), m))}`).join(", ");
        return `  ${mo}: ${byOp} (Σ ${fmtN(sumBy(rs, m))})`;
      })
      .join("\n");
  const monthNote = monthsAll.length > months.length ? ` (12 tháng gần nhất trong tổng ${monthsAll.length} tháng có dữ liệu)` : "";
  out.push(`\n== THEO THÁNG${monthNote} — SỐ KIỆN (tách theo phép) ==\n${monLine("vol")}`);
  out.push(`\n== THEO THÁNG${monthNote} — KG (tách theo phép) ==\n${monLine("kg")}`);

  // Theo tuần (8 gần nhất) & ngày (14 gần nhất) cho từng phép — số kiện.
  for (const o of ops) {
    const wk = bucketize(rows, "vol", "week", "", o).slice(-8);
    if (wk.length) out.push(`\n== ${o} — THEO TUẦN, 8 tuần gần nhất (kiện) ==\n  ${wk.map((b) => `${b.label}: ${fmtN(b.total)}`).join("; ")}`);
  }
  for (const o of ops) {
    const dy = bucketize(rows, "vol", "day", "", o).slice(-14);
    if (dy.length) out.push(`\n== ${o} — THEO NGÀY, 14 ngày gần nhất (kiện) ==\n  ${dy.map((b) => `${b.label}: ${fmtN(b.total)}`).join("; ")}`);
  }

  return out.join("\n");
}
