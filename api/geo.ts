/* ============================================================
   Vercel Edge Function — Toạ độ kho/BC.
   Port từ functions/api/geo.ts (Cloudflare, đọc OAuth Google Sheet mỗi
   lần gọi + cache KV 5 phút) sang query THẲNG bảng warehouses trong
   Supabase (đã có dữ liệu từ supabase/migrate.mjs, Pha 0) — không cần
   OAuth/cache riêng nữa, Postgres đã là nguồn thật.
   GET /api/geo -> { ok, count, at, geo: { <tên đã chuẩn hoá>: [lat,lng] }, places }
   normalized_name đã được migrate.mjs tính sẵn (khớp normalizeName()
   trong src/lib/normalize.ts) -> đọc thẳng cột này, KHÔNG tính lại ở đây.
   ============================================================ */
export const config = { runtime: "edge" };

import { db } from "./_kv";

// Cache-Control riêng cho endpoint này (khác json() mặc định no-store trong _kv.ts):
// src/lib/planner.ts gọi initLiveGeo() (-> /api/geo) MỖI LẦN tính lịch (planSchedule), dựa vào cache
// rẻ để lặp lại nhiều lần không tốn round-trip DB — PHẢI giữ cùng mức cache 5 phút như bản Cloudflare
// gốc (KV cache 5'), nếu không mỗi lần tính lịch sẽ query thẳng Postgres trên đường găng của tính năng.
function geoJson(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

interface WarehouseRow {
  warehouse_id: string | null;
  warehouse_name: string;
  normalized_name: string;
  latitude: number | null;
  longitude: number | null;
}

export default async function handler(): Promise<Response> {
  const supa = db();
  if (!supa) return geoJson({ ok: false, geo: {}, error: "not_configured" });

  const { data, error } = await supa
    .from("warehouses")
    .select("warehouse_id, warehouse_name, normalized_name, latitude, longitude");
  if (error) return geoJson({ ok: false, geo: {}, error: error.message });

  const geo: Record<string, [number, number]> = {};
  const places: { id: string; name: string }[] = [];
  for (const row of (data ?? []) as WarehouseRow[]) {
    if (row.latitude == null || row.longitude == null || !row.normalized_name) continue;
    geo[row.normalized_name] = [row.latitude, row.longitude];
    places.push({ id: row.warehouse_id || "", name: row.warehouse_name });
  }

  return geoJson({ ok: true, count: Object.keys(geo).length, at: Date.now(), geo, places });
}
