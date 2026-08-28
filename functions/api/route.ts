/* ============================================================
   Proxy ĐỊNH TUYẾN qua Google Maps Directions (server-side — KEY KHÔNG lộ ra client).
   POST { coords: [[lat,lng], ...] }  (>=2 điểm)
   -> { ok:true, legs:[{km,min}], geometry:[[lat,lng]] }  (km + phút có tính kẹt xe)
   -> { ok:false } nếu chưa có key / lỗi  => client tự fallback OSRM.
   Key lấy từ KV cfg:gmaps (ô "Khoá Google Maps") hoặc env GOOGLE_MAPS_KEY.
   ============================================================ */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** Giải mã Encoded Polyline của Google -> [[lat,lng]]. */
function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

async function getKey(env: any): Promise<string | null> {
  try { const v = env.QA_KV ? await env.QA_KV.get("cfg:gmaps") : null; const k = (v || "").split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean)[0]; if (k) return k; } catch { /* bỏ qua */ }
  if (env.GOOGLE_MAPS_KEY) return String(env.GOOGLE_MAPS_KEY).split(/[\s,]+/)[0].trim();
  return null;
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const coords: [number, number][] = Array.isArray(body?.coords) ? body.coords : [];
  if (coords.length < 2) return json({ ok: false });
  const key = await getKey(env);
  if (!key) return json({ ok: false, reason: "no_key" });

  const ll = (c: [number, number]) => `${c[0]},${c[1]}`;
  const origin = ll(coords[0]);
  const destination = ll(coords[coords.length - 1]);
  const waypoints = coords.slice(1, -1).map(ll).join("|");
  const url = "https://maps.googleapis.com/maps/api/directions/json?" + new URLSearchParams({
    origin, destination, mode: "driving", departure_time: "now", language: "vi", region: "vn", key,
    ...(waypoints ? { waypoints } : {}),
  }).toString();

  try {
    const res = await fetch(url);
    const d: any = await res.json();
    if (d?.status !== "OK" || !d?.routes?.[0]) return json({ ok: false, reason: d?.status || "no_route" });
    const route = d.routes[0];
    const legs = (route.legs || []).map((l: any) => ({
      km: (l.distance?.value ?? 0) / 1000,
      min: (l.duration_in_traffic?.value ?? l.duration?.value ?? 0) / 60,
    }));
    const geometry = route.overview_polyline?.points ? decodePolyline(route.overview_polyline.points) : null;
    return json({ ok: true, legs, geometry });
  } catch (e: any) {
    return json({ ok: false, reason: String(e?.message || e) });
  }
};
