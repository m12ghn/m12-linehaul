/* ============================================================
   Đối chiếu dữ liệu lịch tải Sheet <-> Supabase — Pha 1.
   Chỉ gọi TAY (nút "So sánh ngay" trong SupabaseShadowCompare, admin-
   only, sau cờ VITE_SUPABASE_SHADOW_COMPARE=1) — KHÔNG tự chạy trong
   luồng tải trang bình thường, không ảnh hưởng hiệu năng/độ ổn định
   của Dash khi Pha 1 chưa bật hoặc chưa ai bấm so sánh.
   ============================================================ */
import { loadSheet } from "./sheet";
import { loadSheetFromDb } from "./sheetFromDb";

export interface CompareDiff {
  routeName: string;
  field: string;
  sheetValue: string;
  dbValue: string;
}
export interface CompareReport {
  sheetRouteCount: number;
  dbRouteCount: number;
  sheetOnlyRoutes: string[];
  dbOnlyRoutes: string[];
  diffs: CompareDiff[]; // giới hạn 200 dòng đầu — tránh tràn UI nếu lệch nhiều
}

const MAX_DIFFS = 200;

export async function compareRegion(gid: string, regionKey: string): Promise<CompareReport> {
  const [sheet, db] = await Promise.all([loadSheet(gid, undefined, true), loadSheetFromDb(regionKey)]);
  const sheetMap = new Map(sheet.routes.map((r) => [r.route, r]));
  const dbMap = new Map(db.routes.map((r) => [r.route, r]));

  const sheetOnlyRoutes = [...sheetMap.keys()].filter((k) => !dbMap.has(k)).sort((a, b) => a.localeCompare(b, "vi"));
  const dbOnlyRoutes = [...dbMap.keys()].filter((k) => !sheetMap.has(k)).sort((a, b) => a.localeCompare(b, "vi"));

  const diffs: CompareDiff[] = [];
  for (const [name, sRoute] of sheetMap) {
    const dRoute = dbMap.get(name);
    if (!dRoute) continue;
    if (diffs.length >= MAX_DIFFS) break;
    if (sRoute.stops.length !== dRoute.stops.length)
      diffs.push({ routeName: name, field: "so_diem_dung", sheetValue: String(sRoute.stops.length), dbValue: String(dRoute.stops.length) });
    if ((sRoute.load || "") !== (dRoute.load || ""))
      diffs.push({ routeName: name, field: "tai_trong", sheetValue: sRoute.load || "", dbValue: dRoute.load || "" });
    if ((sRoute.category || "") !== (dRoute.category || ""))
      diffs.push({ routeName: name, field: "loai_tuyen", sheetValue: sRoute.category || "", dbValue: dRoute.category || "" });
    if ((sRoute.bks || "") !== (dRoute.bks || ""))
      diffs.push({ routeName: name, field: "bks", sheetValue: sRoute.bks || "", dbValue: dRoute.bks || "" });
  }

  return { sheetRouteCount: sheet.routes.length, dbRouteCount: db.routes.length, sheetOnlyRoutes, dbOnlyRoutes, diffs };
}
