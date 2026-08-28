/* ============================================================
   Khớp tên NCC giữa 2 nguồn khác cấu trúc:
   - Lịch tải (cột NCC): tên NGẮN/thường gọi, vd "VẠN LỢI".
   - TT NCC (cột Tên công ty): tên PHÁP LÝ đầy đủ, vd
     "CÔNG TY CP ĐT&PT KHO VẬN VẠN LỢI".
   Tên ngắn luôn là 1 CỤM CON nằm trong tên đầy đủ -> khớp bằng
   includes() sau khi bỏ dấu, KHÔNG so bằng tuyệt đối.
   ============================================================ */
import { stripAccents } from "./normalize";

/** Chuẩn hoá GOM NHÓM trong CÙNG 1 nguồn (giữ dấu — đã dùng ở fleetMix.ts/NccPerformance.tsx). */
export const normNcc = (s: string) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");

/** Chuẩn hoá để SO KHỚP CHÉO giữa 2 nguồn (bỏ dấu, chịu lỗi gõ nhẹ). */
const normKey = (s: string) => stripAccents(s).replace(/\s+/g, " ").trim();

export type NccConfidence = "exact" | "unique" | "ambiguous" | "none";
export interface NccMatch { ten: string; confidence: NccConfidence; candidates: string[] }

/**
 * Khớp 1 tên ngắn (lịch tải) với danh sách tên công ty đầy đủ (TT NCC).
 * "ambiguous" = tên ngắn là cụm con của NHIỀU công ty khác nhau (cần người kiểm tra
 * lại sheet TT NCC — có thể 1 công ty bị ghi trùng 2 kiểu viết tắt khác nhau).
 * "none" = NCC có chạy tuyến thật nhưng CHƯA có hồ sơ trong TT NCC.
 */
export function matchNccName(shortName: string, fullNames: string[]): NccMatch {
  const key = normKey(shortName);
  if (!key) return { ten: shortName, confidence: "none", candidates: [] };
  const uniq = [...new Set(fullNames)];
  const exact = uniq.filter((f) => normKey(f) === key);
  if (exact.length === 1) return { ten: exact[0], confidence: "exact", candidates: exact };
  const sub = uniq.filter((f) => normKey(f).includes(key));
  if (sub.length === 1) return { ten: sub[0], confidence: "unique", candidates: sub };
  if (sub.length > 1) return { ten: sub[0], confidence: "ambiguous", candidates: sub };
  return { ten: shortName, confidence: "none", candidates: [] };
}

/** Giá trị KHÔNG phải NCC thuê ngoài thật trong cột NCC lịch tải (xe nhà/nội bộ/chưa gán). */
export function isHouseOrJunk(name: string): boolean {
  const n = normNcc(name);
  return !n || n === "GHN" || n === "NỘI BỘ" || /^(CH[ƯU]A|KH[ÔO]NG|-+|N\/?A)$/i.test(n);
}
