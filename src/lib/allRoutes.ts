/* Gộp LỊCH TẢI của TẤT CẢ vùng -> Map<mã tuyến chuẩn hoá, Route> (realtime).
   Dùng để khớp lộ trình (giờ tới/rời, loại hình) + tải trọng cho thẻ TLLD dù
   tuyến nằm ở vùng nào.
   01/09/2026: đổi nguồn từ Google Sheet (loadSheet) sang Supabase (loadRegion) —
   cùng hình dạng Route[] nên chỉ đổi hàm gọi + khoá vùng (gid -> region key). */
import { useEffect, useMemo, useState } from "react";
import { loadRegion } from "./db/lichTaiApi";
import { startPoll } from "./poll";
import { SHEETS, REFRESH_MS, EXCLUDED_REGION_KEYS } from "../config";
import { normCode } from "./tlld";
import { getExtraPlaces, useGeoVersion } from "./geo";
import type { Route } from "../types";

let cache: Map<string, Route> | null = null;
let cachedAt = 0;

/** điểm "độ chi tiết" của 1 Route để chọn bản đầy đủ nhất khi mã trùng nhiều vùng. */
const score = (r: Route) =>
  r.stops.length * 10 + (r.load ? 5 : 0) + r.stops.filter((s) => s.toi || s.roi).length;

export async function loadAllRoutes(signal?: AbortSignal): Promise<Map<string, Route>> {
  // Loại vùng M12 không phụ trách (vd "Nội Vùng HCM" — tab đã đổi cấu trúc, không còn là dữ liệu
  // tuyến, xem config.ts EXCLUDED_REGION_KEYS) khỏi TỔNG HỢP toàn cụm — RÀ LẠI 2026-07-21 (Sếp báo
  // "Lịch tải đang tính sai"): cùng bug đã sửa ở fleetMix.ts trước đây nhưng sót file này.
  const results = await Promise.all(
    SHEETS.filter((s) => !EXCLUDED_REGION_KEYS.includes(s.key)).map((s) => loadRegion(s.key, signal).catch(() => null))
  );
  const map = new Map<string, Route>();
  for (const res of results) {
    if (!res) continue;
    for (const r of res.routes) {
      const key = normCode(r.route);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev || score(r) > score(prev)) map.set(key, r);
    }
  }
  cache = map;
  cachedAt = Date.now();
  return map;
}

/** Danh sách tên KHO/BƯU CỤC (hiển thị, duy nhất) từ lịch toàn vùng + sheet toạ độ toàn quốc
 *  (gồm cả BC CHƯA từng chạy tuyến nào trong Lịch Tải — Sếp yêu cầu 2026-08-21, xem getExtraPlaces()
 *  ở geo.ts) — để gợi ý nhập tên. */
export function usePlaceNames(): string[] {
  const map = useAllRoutes();
  const geoVersion = useGeoVersion();
  return useMemo(() => {
    const set = new Set<string>();
    for (const r of map.values()) for (const s of r.stops) { const n = (s.kho || "").trim(); if (n) set.add(n); }
    for (const p of getExtraPlaces()) if (p.name) set.add(p.name);
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoVersion]);
}

/** Tên KHO/BƯU CỤC -> MÃ ID — ưu tiên cột "ID" trong Lịch Tải, bổ sung thêm từ sheet toạ độ toàn
 *  quốc cho các BC chưa có trong Lịch Tải — để gõ mã tìm ra tên. */
export function usePlaceIds(): Map<string, string> {
  const map = useAllRoutes();
  const geoVersion = useGeoVersion();
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const r of map.values()) for (const s of r.stops) {
      const n = (s.kho || "").trim();
      const id = (s.id || "").trim();
      if (n && id && !out.has(n)) out.set(n, id);
    }
    for (const p of getExtraPlaces()) if (p.name && p.id && !out.has(p.name)) out.set(p.name, p.id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoVersion]);
}

/** Danh sách MÃ TUYẾN (hiển thị, duy nhất) từ lịch toàn vùng — để gợi ý khi tìm tên tuyến. */
export function useRouteNames(): string[] {
  const map = useAllRoutes();
  return useMemo(
    () => [...new Set([...map.values()].map((r) => r.route).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [map]
  );
}

export function useAllRoutes(): Map<string, Route> {
  const [m, setM] = useState<Map<string, Route>>(cache || new Map());
  useEffect(() => {
    let alive = true;
    const run = () => loadAllRoutes().then((x) => { if (alive) setM(x); }).catch(() => {});
    if (!cache || Date.now() - cachedAt > REFRESH_MS) run(); else setM(cache);
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);
  return m;
}
