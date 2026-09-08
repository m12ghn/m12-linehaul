/* ============================================================
   LỚP DỮ LIỆU MỚI — đọc/ghi Lịch Tải qua /api/lichtai (Supabase),
   thay cho src/lib/sheet.ts (đọc CSV Google Sheet).

   Giữ NGUYÊN kiểu Route/Stop/SheetData trong src/types.ts để các view hiện có
   (LichTai, LoTrinh, TlldTuyen, GhepTai, MapPanel...) không phải sửa gì — chỉ
   thêm 2 trường mới `id` và `rev` phục vụ việc sửa trực tiếp.
   ============================================================ */
import { adminHeaders } from "../useUser";
import { lookupCoord } from "../geo";
import type { Route, Stop, SheetData } from "../../types";

/** Điểm dừng có định danh thật -> sửa/xoá được theo id thay vì dò nội dung.
 *  CHÚ Ý: `Stop.id` (đã có sẵn) là cột "ID" trên Sheet cũ, dùng khi xuất Excel —
 *  KHÔNG phải khoá chính. Khoá chính uuid đặt tên `sid` để không phá code cũ. */
export interface DbStop extends Stop {
  sid: string;
  seq: number;
  rev: string;
}
export interface DbRoute extends Route {
  id: string;
  rev: string;
  stops: DbStop[];
}
export interface DbSheetData extends SheetData {
  routes: DbRoute[];
}

export type EditError =
  | "unauthorized" | "forbidden" | "conflict" | "row_not_found" | "duplicate_route"
  | "invalid_value" | "bad_request" | "db_error" | "network" | "server_error";

export interface MutResult {
  ok: boolean;
  id?: string;
  rev?: string;
  error?: EditError;
  field?: string;
  current?: string;
}

/** Câu tiếng Việt cho từng mã lỗi — giữ giọng như bản cũ (lichTaiEdit.ts). */
export function editErrorText(e?: string, extra?: { current?: string; field?: string }): string {
  switch (e) {
    case "unauthorized": return "Phiên đăng nhập đã hết hạn. Đăng nhập lại giúp em.";
    case "forbidden": return "Vai trò của bạn chưa có quyền sửa Lịch Tải.";
    case "conflict": return `Người khác vừa sửa dòng này lúc ${extra?.current ? new Date(extra.current).toLocaleTimeString("vi-VN") : "?"}. Tải lại rồi sửa tiếp giúp em.`;
    case "row_not_found": return "Dòng này vừa bị xoá trên hệ thống. Đang tải lại…";
    case "duplicate_route": return "Mã tuyến này đã có trong vùng. Đặt mã khác giúp em.";
    case "invalid_value": return `Giá trị không hợp lệ${extra?.field ? ` (ô ${extra.field})` : ""}.`;
    case "db_error": return "Cơ sở dữ liệu từ chối thao tác này.";
    case "network": return "Lỗi kết nối, thử lại giúp em.";
    default: return "Không lưu được, thử lại giúp em.";
  }
}

// ---------- ĐỌC ----------
// CACHE + GỘP REQUEST: cùng lý do đã có ở src/lib/sheet.ts (loadSheet) thời còn đọc CSV —
// nhiều nơi cùng cần 1 vùng trong cùng lúc (useSchedule đang xem vùng X, allRoutes/fleetMix/gsvt
// tải CẢ 6 vùng để gộp) -> không có cache thì bấm nhanh/đổi vùng liên tục ra nhiều request trùng.
// TTL khớp REFRESH_MS (chưa tới nhịp tự đồng bộ thì dùng lại, không hỏi Supabase thêm).
const REGION_TTL = 40000;
const regionCache = new Map<string, { at: number; data: DbSheetData }>();
const regionInflight = new Map<string, Promise<DbSheetData>>();

export async function loadRegion(regionKey: string, signal?: AbortSignal, force = false): Promise<DbSheetData> {
  if (!force) {
    const c = regionCache.get(regionKey);
    if (c && Date.now() - c.at < REGION_TTL) return c.data;
    const p = regionInflight.get(regionKey);
    if (p) return p; // đang tải vùng này -> dùng chung promise, không gọi trùng
  }
  const run = loadRegionUncached(regionKey, signal).then((data) => {
    regionCache.set(regionKey, { at: Date.now(), data });
    return data;
  });
  regionInflight.set(regionKey, run);
  try { return await run; } finally { regionInflight.delete(regionKey); }
}

async function loadRegionUncached(regionKey: string, signal?: AbortSignal): Promise<DbSheetData> {
  const r = await fetch(`/api/lichtai?region=${encodeURIComponent(regionKey)}`, {
    headers: adminHeaders(), cache: "no-store", signal,
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d?.ok) throw new Error(d?.error || "HTTP " + r.status);

  const missingGeo = new Set<string>();
  const routes: DbRoute[] = (d.routes || []).map((x: any) => {
    let mapped = 0;
    const stops: DbStop[] = (x.stops || []).map((s: any) => {
      const coord = lookupCoord(s.kho);
      if (coord) mapped++; else if (s.kho) missingGeo.add(s.kho);
      return {
        sid: s.id, seq: s.seq, rev: s.rev,
        kho: s.kho, loaiHinh: s.loaiHinh, toi: s.toi, roi: s.roi,
        id: s.extId || undefined,          // cột "ID" cũ — giữ cho exportExcel
        coord: coord || undefined,
      } as DbStop;
    });
    return {
      id: x.id, rev: x.rev,
      route: x.route, load: x.load, category: x.category,
      ncc: x.ncc, bks: x.bks, stops, mappedCount: mapped,
    };
  });

  return {
    routes,
    categories: d.categories || [],
    lastSync: Date.now(),
    loading: false,
    error: null,
    missingGeo: [...missingGeo],
  };
}

// ---------- GHI ----------
async function mutate(body: any): Promise<MutResult> {
  try {
    const r = await fetch("/api/lichtai", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    const d: any = await r.json().catch(() => ({}));
    if (d?.ok) return { ok: true, id: d.id, rev: d.rev };
    return { ok: false, error: (d?.error || "server_error") as EditError, field: d?.field, current: d?.current };
  } catch {
    return { ok: false, error: "network" };
  }
}

export interface RouteInput {
  code?: string; category?: string; load?: string; ncc?: string; bks?: string;
  driver?: string; driverPhone?: string; note?: string;
}
export interface StopInput {
  kho?: string; loaiHinh?: string; toi?: string; roi?: string; seq?: number; note?: string;
}

export const createRoute = (region: string, route: RouteInput & { stops?: StopInput[] }) =>
  mutate({ action: "route.create", region, route });

/** `rev` = dấu thời gian bản ghi client đang xem -> server từ chối nếu người khác vừa sửa. */
export const updateRoute = (id: string, patch: RouteInput, rev?: string) =>
  mutate({ action: "route.update", id, patch, rev });

/** Mặc định xoá MỀM (ẩn khỏi dashboard, giữ lịch sử). hard=true mới xoá hẳn. */
export const deleteRoute = (id: string, hard = false) =>
  mutate({ action: "route.delete", id, hard });

export const createStop = (routeId: string, stop: StopInput) =>
  mutate({ action: "stop.create", routeId, stop });

export const updateStop = (id: string, patch: StopInput, rev?: string) =>
  mutate({ action: "stop.update", id, patch, rev });

export const deleteStop = (id: string) =>
  mutate({ action: "stop.delete", id });

export const reorderStops = (routeId: string, ids: string[]) =>
  mutate({ action: "stop.reorder", routeId, ids });

/** Xuất vùng hiện tại ra Google Sheet (Sheet chỉ để xem). */
export async function exportToSheet(region: string): Promise<{ ok: boolean; rows?: number; error?: string }> {
  try {
    const r = await fetch("/api/export-sheet", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ region }),
    });
    const d: any = await r.json().catch(() => ({}));
    return d?.ok ? { ok: true, rows: d.rows } : { ok: false, error: d?.error || "server_error" };
  } catch {
    return { ok: false, error: "network" };
  }
}
