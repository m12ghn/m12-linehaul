/* ============================================================
   Gọi OSRM (router.project-osrm.org) 1 lần lấy:
   - legs:     quãng đường từng chặng (km)  -> cột Km
   - geometry: hình dạng ĐƯỜNG ĐI THỰC TẾ ([lat,lng][]) -> vẽ trên bản đồ
   Cache theo chuỗi toạ độ (dùng chung 1 request). Lỗi/timeout -> null để fallback.
   ============================================================ */

interface RouteInfo {
  legs: number[] | null; // km từng chặng
  legsMin: number[] | null; // phút chạy từng chặng
  geometry: [number, number][] | null;
}

const cache = new Map<string, Promise<RouteInfo | null>>();

function key(coords: [number, number][]): string {
  return coords.map((c) => c[0].toFixed(5) + "," + c[1].toFixed(5)).join(";");
}

async function request(coords: [number, number][]): Promise<RouteInfo | null> {
  // Định tuyến MIỄN PHÍ bằng OSRM (đường bộ thật, km + giờ chạy từng chặng).
  // OSRM dùng thứ tự lng,lat; overview=full + geojson để lấy đường thực tế.
  const path = coords.map((c) => `${c[1]},${c[0]}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;
    const legs = Array.isArray(route.legs)
      ? route.legs.map((l: { distance?: number }) => (l.distance ?? 0) / 1000)
      : null;
    const legsMin = Array.isArray(route.legs)
      ? route.legs.map((l: { duration?: number }) => (l.duration ?? 0) / 60)
      : null;
    const coordsGeo = route.geometry?.coordinates;
    const geometry: [number, number][] | null = Array.isArray(coordsGeo)
      ? coordsGeo.map((c: [number, number]) => [c[1], c[0]] as [number, number])
      : null;
    return { legs, legsMin, geometry };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function fetchRoute(coords: [number, number][]): Promise<RouteInfo | null> {
  const k = key(coords);
  const hit = cache.get(k);
  if (hit) return hit;
  const p = request(coords).then((r) => {
    if (r == null) cache.delete(k); // lỗi -> cho thử lại sau
    return r;
  });
  cache.set(k, p);
  return p;
}

/** Quãng đường từng chặng (km). */
export async function fetchRoadLegs(coords: [number, number][]): Promise<number[] | null> {
  if (coords.length < 2) return [];
  const r = await fetchRoute(coords);
  return r?.legs ?? null;
}

/** Hình dạng đường đi thực tế ([lat,lng][]) để vẽ polyline. */
export async function fetchRoadGeometry(coords: [number, number][]): Promise<[number, number][] | null> {
  if (coords.length < 2) return null;
  const r = await fetchRoute(coords);
  return r?.geometry ?? null;
}

/** Từng chặng kèm km + phút chạy (dùng cho Sắp Lịch tải). */
export async function fetchRoadLegsFull(
  coords: [number, number][]
): Promise<{ km: number; min: number }[] | null> {
  if (coords.length < 2) return [];
  const r = await fetchRoute(coords);
  if (!r?.legs || !r?.legsMin) return null;
  return r.legs.map((km, i) => ({ km, min: r.legsMin![i] ?? 0 }));
}
