/* ============================================================
   TẢI LÊN HÀNG LOẠT (bulk upload) Lịch Tải — đọc file Excel Sếp chuẩn bị, gộp
   thành danh sách tuyến+điểm dừng, gửi lên /api/lichtai-bulk. Thêm 03/09/2026.

   Đọc theo ĐÚNG bố cục cột nút "Tải Lịch (Excel)" đang xuất (exportLichTai(),
   ../lib/exportExcel.ts): "Tên tuyến | Tải trọng | ID | Tên kho | Loại hình |
   Tới điểm | Rời điểm", 1 dòng = 1 điểm dừng, các cột PHẠM VI TUYẾN (Tải trọng/
   Loại tuyến/NCC/Biển số) chỉ cần điền ở dòng đầu mỗi tuyến — dùng chung 1 định
   dạng cho cả xuất/nhập, Sếp không cần học thêm bố cục mới (quyết định 03/09 qua
   AskUserQuestion: dùng chung với nút Export hiện có).

   Cách dò cột (findCol) + gộp nhiều dòng cùng "Tên tuyến" thành 1 tuyến CỐ Ý
   LẶP LẠI logic của scripts/import-sheets.mjs (readGridTuFile + importRoutes())
   — môi trường khác (trình duyệt, không phải Node script) nên không import
   thẳng được, nhưng phải giữ ĐÚNG luật gộp để Sếp dùng cùng 1 file mẫu cho cả
   2 đường (script nạp lần đầu / upload từ dashboard sau này).
   ============================================================ */
import { adminHeaders } from "./useUser";

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

function findCol(header: string[], keys: string[]): number {
  const h = header.map(norm);
  for (const kw of keys) {
    const k = norm(kw);
    let i = h.findIndex((x) => x === k);
    if (i >= 0) return i;
    i = h.findIndex((x) => x.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}
const cell = (row: any[], i: number): string => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");

/** Dò dòng tiêu đề trong 10 dòng đầu — GIỐNG scripts/import-sheets.mjs. */
function findHeaderRow(grid: any[][]): number {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const H = (grid[i] || []).map((v) => String(v ?? ""));
    let hit = 0;
    for (const k of [["ten tuyen", "ma tuyen"], ["ten kho", "kho"], ["loai hinh"], ["toi diem", "gio toi"], ["roi diem", "gio roi"]]) {
      if (findCol(H, k) >= 0) hit++;
    }
    if (hit >= 3) return i;
  }
  return 0;
}

export interface BulkParsedStop { kho: string; loaiHinh: string; toi: string; roi: string; }
export interface BulkParsedRoute { code: string; category: string; load: string; ncc: string; bks: string; stops: BulkParsedStop[]; }
export interface BulkParseResult { routes: BulkParsedRoute[]; totalStops: number; warnings: string[]; }

/** Gộp nhiều dòng cùng "Tên tuyến" thành 1 tuyến — ĐÚNG logic importRoutes() của
 *  scripts/import-sheets.mjs (xem comment đầu file). */
export function parseBulkGrid(grid: any[][]): BulkParseResult {
  const warnings: string[] = [];
  const h = findHeaderRow(grid);
  const H = (grid[h] || []).map((v) => String(v ?? ""));
  const c = {
    route: (() => { const i = findCol(H, ["ten tuyen", "ma tuyen"]); return i >= 0 ? i : 0; })(),
    load: findCol(H, ["tai trong", "trong tai"]),
    cat: findCol(H, ["loai tuyen"]),
    ncc: findCol(H, ["ncc"]),
    bks: findCol(H, ["bks", "bien so"]),
    kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
    lh: findCol(H, ["loai hinh"]),
    toi: findCol(H, ["toi diem", "gio toi", "gio den"]),
    roi: findCol(H, ["roi diem", "gio roi", "gio di"]),
  };
  if (c.kho < 0) warnings.push('Không tìm thấy cột "Tên kho" trong file — kiểm tra lại dòng tiêu đề.');
  if (c.route < 0) warnings.push('Không tìm thấy cột "Tên tuyến" trong file — kiểm tra lại dòng tiêu đề.');

  const byCode = new Map<string, BulkParsedRoute>();
  let totalStops = 0;
  for (const r of grid.slice(h + 1)) {
    const code = cell(r, c.route);
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, { code, category: "", load: "", ncc: "", bks: "", stops: [] });
    const t = byCode.get(code)!;
    // Cột phạm vi TUYẾN: lấy giá trị KHÔNG RỖNG đầu tiên (Excel chỉ cần điền ở dòng đầu).
    if (!t.load) t.load = cell(r, c.load);
    if (!t.ncc) t.ncc = cell(r, c.ncc);
    if (!t.bks) t.bks = cell(r, c.bks);
    if (!t.category) t.category = cell(r, c.cat);
    const kho = cell(r, c.kho);
    if (kho) {
      t.stops.push({ kho, loaiHinh: cell(r, c.lh), toi: cell(r, c.toi), roi: cell(r, c.roi) });
      totalStops++;
    }
  }
  return { routes: [...byCode.values()], totalStops, warnings };
}

/** Đọc 1 File (.xlsx/.xls) Sếp chọn thành ma trận ô (AOA). Thư viện xlsx (nặng)
 *  nạp ĐỘNG — không phình bundle lúc mở trang, giống các hàm exportXxx() khác. */
export async function readWorkbookFile(file: File): Promise<any[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as any[][];
}

export interface BulkUploadResultRow { code: string; status: "created" | "updated" | "error"; error?: string; stops?: number; }
export interface BulkUploadResponse {
  ok: boolean; total: number; success: number; failed: number;
  results: BulkUploadResultRow[]; error?: string; detail?: string;
}

/** Gửi danh sách tuyến đã đọc/gộp lên /api/lichtai-bulk (endpoint Node riêng, xem
 *  comment ở đó — chạy được lâu hơn cho vùng nhiều tuyến, CHỈ admin gọi được). */
export async function uploadBulkRoutes(region: string, routes: BulkParsedRoute[]): Promise<BulkUploadResponse> {
  try {
    const r = await fetch("/api/lichtai-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ region, routes }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || !d?.ok) {
      return { ok: false, total: 0, success: 0, failed: 0, results: [], error: d?.error || "server_error", detail: d?.detail };
    }
    return d as BulkUploadResponse;
  } catch {
    return { ok: false, total: 0, success: 0, failed: 0, results: [], error: "network" };
  }
}
