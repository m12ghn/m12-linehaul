/* ============================================================
   DANH SÁCH NCC VẬN TẢI (tab "TT CC" — gid 918430252, workbook chính).
   Cột: Trạng thái · Miền · Tên công ty · Khu vực hoạt động ·
   Người liên hệ (tên · SĐT · chức danh) · Giám đốc (tên · SĐT · chức danh) ·
   Email · Địa chỉ. Dùng cho trang tra cứu nhanh + nạp cho trợ lý.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { csvSources } from "../config";

export const NCC_VT_GID = "918430252";

export interface NccVT {
  status: string; mien: string; ten: string; khuVuc: string;
  lhTen: string; lhSdt: string; lhChuc: string;   // người liên hệ trực tiếp
  gdTen: string; gdSdt: string; gdChuc: string;    // giám đốc / chủ DN
  email: string; diaChi: string;
  // Hồ sơ năng lực (Performance NCC) — text thô NCC tự khai, KHÔNG suy diễn thêm.
  xeTheoTaiTrong: string;  // Tổng số xe theo tải trọng
  nangLucThucThi: string;  // Năng lực thực thi Cố định
  event: string;           // Năng lực cấp xe vào Event
  phamViHoatDong: string;  // Phạm vi hoạt động
  cacLoiDangCo: string;    // Các lỗi đang có
  giaCa: string;           // Giá cả
}
export interface NccVTData { list: NccVT[]; ok: boolean; lastSync: number; }

async function fetchFirst(signal?: AbortSignal): Promise<string | null> {
  for (const b of csvSources(NCC_VT_GID)) {
    try {
      const r = await fetch(b + "&_=" + Date.now(), { cache: "no-store", signal });
      if (r.ok) { const t = await r.text(); if (t.trim().length > 5 && !/^\s*<!doctype html|sign in/i.test(t.slice(0, 200))) return t; }
    } catch { /* nguồn kế */ }
  }
  return null;
}

export async function loadNccVT(signal?: AbortSignal): Promise<NccVTData> {
  const text = await fetchFirst(signal);
  if (!text) return { list: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { list: [], ok: false, lastSync: Date.now() };
  const H = rows[0];
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
  const pick = (found: number, fb: number) => (found >= 0 ? found : fb);
  const cStatus = findCol(H, ["trang thai", "trạng thái"]);
  const cMien = findCol(H, ["mien", "miền"]);
  const cTen = findCol(H, ["ten cong ty", "tên công ty"]);
  const cKhu = findCol(H, ["khu vuc", "khu vực"]);
  const cEmail = findCol(H, ["email"]);
  const cDiaChi = findCol(H, ["dia chi", "địa chỉ"]);
  const cXeTaiTrong = findCol(H, ["tong so xe theo tai trong", "so xe theo tai trong"]);
  const cNangLuc = findCol(H, ["nang luc thuc thi"]);
  const cEvent = findCol(H, ["event"]);
  const cPhamVi = findCol(H, ["pham vi hoat dong"]);
  const cLoi = findCol(H, ["cac loi dang co", "loi dang co"]);
  const cGia = findCol(H, ["gia ca"]);
  // Vị trí cố định (2 cột SĐT/Chức danh lặp cho Liên hệ & Giám đốc; 6 cột hồ sơ năng lực nối sau).
  const F = {
    status: 0, mien: 1, ten: 2, khu: 3, lhTen: 4, lhSdt: 5, lhChuc: 6, gdTen: 7, gdSdt: 8, gdChuc: 9, email: 10, diaChi: 11,
    xeTaiTrong: 12, nangLuc: 13, event: 14, phamVi: 15, loi: 16, gia: 17,
  };

  const list: NccVT[] = [];
  for (const r of rows.slice(1)) {
    const ten = g(r, pick(cTen, F.ten));
    if (!ten) continue;
    list.push({
      status: g(r, pick(cStatus, F.status)),
      mien: g(r, pick(cMien, F.mien)),
      ten,
      khuVuc: g(r, pick(cKhu, F.khu)),
      lhTen: g(r, F.lhTen), lhSdt: g(r, F.lhSdt), lhChuc: g(r, F.lhChuc),
      gdTen: g(r, F.gdTen), gdSdt: g(r, F.gdSdt), gdChuc: g(r, F.gdChuc),
      email: g(r, pick(cEmail, F.email)),
      diaChi: g(r, pick(cDiaChi, F.diaChi)),
      xeTheoTaiTrong: g(r, pick(cXeTaiTrong, F.xeTaiTrong)),
      nangLucThucThi: g(r, pick(cNangLuc, F.nangLuc)),
      event: g(r, pick(cEvent, F.event)),
      phamViHoatDong: g(r, pick(cPhamVi, F.phamVi)),
      cacLoiDangCo: g(r, pick(cLoi, F.loi)),
      giaCa: g(r, pick(cGia, F.gia)),
    });
  }
  return { list, ok: true, lastSync: Date.now() };
}

/** Rút gọn thành text NẠP cho trợ lý (mỗi NCC 1 dòng gọn). */
export function nccVTDigest(list: NccVT[]): string {
  return list
    .map((n) => {
      let line = `- ${n.ten}${n.mien ? ` [${n.mien}]` : ""}: KV ${n.khuVuc || "?"}. LH ${n.lhTen || "?"}${n.lhSdt ? " " + n.lhSdt : ""}${n.lhChuc ? " (" + n.lhChuc + ")" : ""}${n.gdTen ? `; GĐ ${n.gdTen}${n.gdSdt ? " " + n.gdSdt : ""}` : ""}${n.email ? `; ${n.email}` : ""}`;
      const cap: string[] = [];
      if (n.xeTheoTaiTrong) cap.push(`xe: ${n.xeTheoTaiTrong}`);
      if (n.nangLucThucThi) cap.push(`năng lực: ${n.nangLucThucThi}`);
      if (n.event) cap.push(`event: ${n.event}`);
      if (n.phamViHoatDong) cap.push(`phạm vi: ${n.phamViHoatDong}`);
      if (n.giaCa) cap.push(`giá: ${n.giaCa}`);
      if (n.cacLoiDangCo) cap.push(`lỗi: ${n.cacLoiDangCo}`);
      if (cap.length) line += `. ${cap.join("; ")}`;
      return line;
    })
    .join("\n");
}
