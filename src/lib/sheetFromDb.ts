/* ============================================================
   Đọc 1 vùng (region_key) TỪ SUPABASE thay vì Google Sheet — Pha 1.
   Trả về CÙNG hình dạng ParsedSheet như src/lib/sheet.ts để so sánh
   trực tiếp (xem compareSheetSupabase.ts) — KHÔNG dùng để thay thế
   loadSheet() trong luồng đọc chính thức của Dash cho tới khi đối
   chiếu xong (xem supabase/README.md mục 5).

   Toạ độ vẫn tra qua src/lib/geo.ts (geo.json + /api/geo realtime) —
   CỐ Ý chưa đổi sang bảng `warehouses` trong Pha 1, để việc so sánh
   route/stop không lẫn với việc so sánh nguồn toạ độ (2 việc tách
   riêng, xem README supabase/).
   ============================================================ */
import { getSupabase } from "./supabaseClient";
import { lookupCoord } from "./geo";
import type { ParsedSheet } from "./sheet";
import type { Route, Stop } from "../types";

interface RouteRow {
  id: number;
  route_name: string;
  load_text: string | null;
  category: string | null;
  ncc: string | null;
  bks: string | null;
}
interface StopRow {
  route_id: number;
  warehouse_name: string | null;
  loai_hinh: string | null;
  gio_toi: string | null;
  gio_roi: string | null;
  sheet_row_id: string | null;
  source_row_index: number;
}

/** Sắp xếp danh mục theo alphabet (khác src/lib/sheet.ts: KHÔNG có CATEGORY_ORDER ở đây vì mục
 *  đích Pha 1 là đối chiếu dữ liệu thô, không phải hiển thị cho người dùng cuối). */
function sortCategories(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "vi"));
}

export async function loadSheetFromDb(regionKey: string): Promise<ParsedSheet> {
  const db = getSupabase();
  if (!db) throw new Error("Supabase chưa cấu hình (.env thiếu VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)");

  const { data: routeRows, error: rErr } = await db
    .from("routes")
    .select("id, route_name, load_text, category, ncc, bks")
    .eq("region_key", regionKey);
  if (rErr) throw new Error("Lỗi đọc bảng routes: " + rErr.message);
  const routesData = (routeRows ?? []) as RouteRow[];
  if (routesData.length === 0) return { routes: [], categories: [], missingGeo: [] };

  const ids = routesData.map((r) => r.id);
  const { data: stopRows, error: sErr } = await db
    .from("route_stops")
    .select("route_id, warehouse_name, loai_hinh, gio_toi, gio_roi, sheet_row_id, source_row_index")
    .in("route_id", ids)
    .order("source_row_index", { ascending: true });
  if (sErr) throw new Error("Lỗi đọc bảng route_stops: " + sErr.message);

  const stopsByRoute = new Map<number, StopRow[]>();
  for (const row of (stopRows ?? []) as StopRow[]) {
    if (!stopsByRoute.has(row.route_id)) stopsByRoute.set(row.route_id, []);
    stopsByRoute.get(row.route_id)!.push(row);
  }

  const missing = new Set<string>();
  const routes: Route[] = routesData.map((r) => {
    const rows = stopsByRoute.get(r.id) ?? [];
    let mappedCount = 0;
    const stops: Stop[] = rows.map((sr) => {
      const kho = (sr.warehouse_name || "").trim();
      const coord = lookupCoord(kho);
      if (kho) { if (coord) mappedCount++; else missing.add(kho); }
      return { kho, loaiHinh: sr.loai_hinh || "", toi: sr.gio_toi || "", roi: sr.gio_roi || "", coord, id: sr.sheet_row_id || "" };
    });
    return { route: r.route_name, load: r.load_text || "", category: r.category || "", ncc: r.ncc || "", bks: r.bks || "", stops, mappedCount };
  });

  const categories = sortCategories([...new Set(routes.map((r) => r.category).filter(Boolean))]);
  return { routes, categories, missingGeo: [...missing].sort((a, b) => a.localeCompare(b, "vi")) };
}
