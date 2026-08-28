import type { Route } from "../types";
import type { TCRoute } from "./tangcuong";
import type { GsvtVehicle } from "./gsvt";
import { stripAccents } from "./normalize";

/** Xuất lịch TĂNG CƯỜNG của 1 NCC (tách Lấy/Giao) để gửi cho NCC. 1 dòng = 1 điểm. */
export async function exportTcNcc(routes: TCRoute[], nccName: string, kindLabel: string, dateLabel: string): Promise<void> {
  const XLSX = await import("xlsx");
  const header = ["Tuyến", "Trọng tải (kg)", "STT", `Điểm ${kindLabel} / Kho`, "Quận", "Giờ đến", "Giờ đi", "Biển số", "Tài xế", "SĐT"];
  const aoa: (string | number)[][] = [header];
  for (const r of routes) {
    r.stops.forEach((s, i) => {
      aoa.push([r.code, i === 0 ? r.trongTai : "", i + 1, s.name, s.quan, s.den, s.di, i === 0 ? r.bks : "", i === 0 ? r.tx : "", i === 0 ? r.sdt : ""]);
    });
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 5 }, { wch: 42 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 16 }, { wch: 13 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `TC ${kindLabel}`);
  XLSX.writeFile(wb, `TangCuong_${kindLabel}_${safeName(nccName)}_${safeName(dateLabel) || stampNow()}.xlsx`);
}

/** Xuất lịch tải ra file Excel đúng format sheet gốc (1 dòng = 1 điểm dừng).
 *  Thư viện xlsx (nặng) được nạp ĐỘNG -> không làm phình bundle lúc mở trang. */
export async function exportLichTai(routes: Route[], regionLabel: string): Promise<void> {
  const XLSX = await import("xlsx");
  const header = ["Tên tuyến", "Tải trọng", "ID", "Tên kho", "Loại hình", "Tới điểm", "Rời điểm"];
  const aoa: (string | number)[][] = [header];
  for (const r of routes) {
    for (const s of r.stops) {
      aoa.push([r.route, r.load, s.id || "", s.kho, s.loaiHinh, s.toi, s.roi]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Độ rộng cột cho dễ nhìn
  ws["!cols"] = [{ wch: 14 }, { wch: 9 }, { wch: 11 }, { wch: 48 }, { wch: 13 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lịch tải");
  XLSX.writeFile(wb, `LichTai_${safeName(regionLabel)}_${stampNow()}.xlsx`);
}

/**
 * Xuất lịch GSVT ra Excel CÓ ĐỊNH DẠNG (giống file lịch tải làm tay):
 * - đúng bố cục cột: Tên tuyến | Tải trọng | ID | Tên kho | Loại hình | Tới điểm | Rời điểm
 * - tiêu đề tô xanh + chữ trắng đậm + bộ lọc (autofilter)
 * - dòng KHO / Phân loại (đầu mỗi tuyến) tô ĐỎ để dễ tách tuyến
 * Dùng xlsx-js-style (fork ghi được style) — nạp động, không phình bundle.
 */
export async function exportGsvt(vehicles: GsvtVehicle[], title: string): Promise<void> {
  const XLSX = await import("xlsx-js-style");
  const header = ["Tên tuyến", "Tải trọng", "ID", "Tên kho", "Loại hình", "Tới điểm", "Rời điểm"];
  const aoa: (string | number)[][] = [header];
  const redRows = new Set<number>(); // dòng kho/phân loại -> tô đỏ
  const numOrStr = (l: string) => { const n = parseFloat(l); return Number.isFinite(n) && String(n) === (l || "").trim() ? n : (l || ""); };
  for (const v of vehicles) {
    for (const s of v.route.stops) {
      if (/kho|phan loai/.test(stripAccents(`${s.kho} ${s.loaiHinh}`))) redRows.add(aoa.length);
      aoa.push([v.code, numOrStr(v.load), s.id || "", s.kho, s.loaiHinh, s.toi, s.roi]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 50 }, { wch: 12 }, { wch: 9 }, { wch: 9 }];
  ws["!autofilter"] = { ref: `A1:G${aoa.length}` };
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

  const thin = { style: "thin", color: { rgb: "D9D9D9" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const nCols = header.length;
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = { t: "s", v: "" });
      const center = c === 1 || c === 2 || c === 4 || c === 5 || c === 6; // tải/ID/loại/tới/rời canh giữa
      const s: Record<string, unknown> = { border, alignment: { vertical: "center", horizontal: center ? "center" : "left", wrapText: false } };
      if (r === 0) { s.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }; s.fill = { fgColor: { rgb: "1F7A5C" } }; s.alignment = { vertical: "center", horizontal: "center" }; }
      else if (redRows.has(r)) { s.font = { bold: true, color: { rgb: "C00000" } }; s.fill = { fgColor: { rgb: "FCE4E4" } }; }
      cell.s = s;
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lịch GSVT");
  XLSX.writeFile(wb, `GSVT_${safeName(title)}_${stampNow()}.xlsx`);
}

function stampNow(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function safeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^A-Za-z0-9]+/g, "_");
}
const pcX = (v: number | null) => (v == null ? "" : Math.round(v * 100) + "%");

/** Xuất bảng TLLD của nhóm tuyến đang xem. */
export async function exportTlld(
  items: { code: string; n1: number | null; avg7: number | null; avg30: number | null }[],
  title: string
): Promise<void> {
  const XLSX = await import("xlsx");
  const header = ["Mã tuyến", "Lấp đầy N-1", "TB 7 ngày", "TB tháng (30N)", "Trạng thái"];
  const stt = (v: number | null) => (v == null ? "—" : v >= 0.85 ? "Tốt" : v >= 0.6 ? "Khá" : v > 1 ? "Vượt tải" : "Thấp <60%");
  const aoa: (string | number)[][] = [header];
  for (const it of items) {
    const v = it.n1 ?? it.avg7;
    aoa.push([it.code, pcX(it.n1), pcX(it.avg7), pcX(it.avg30), v != null && v > 1 ? "Vượt tải" : stt(v)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TLLD");
  XLSX.writeFile(wb, `TLLD_${safeName(title)}_${stampNow()}.xlsx`);
}

/** Xuất bảng sản lượng theo kỳ đang xem (kèm tách loại hàng). */
export async function exportSanLuong(
  rows: { label: string; total: number; byLoai: Record<string, number> }[],
  loais: string[],
  meta: { title: string; unit: string; gran: string }
): Promise<void> {
  const XLSX = await import("xlsx");
  const header = [meta.gran, `Tổng (${meta.unit})`, ...loais];
  const aoa: (string | number)[][] = [header];
  for (const r of rows) aoa.push([r.label, Math.round(r.total), ...loais.map((l) => Math.round(r.byLoai[l] || 0))]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 14 }, ...loais.map(() => ({ wch: 12 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sản lượng");
  XLSX.writeFile(wb, `SanLuong_${safeName(meta.title)}_${stampNow()}.xlsx`);
}
