/* ============================================================
   TOẠ ĐỘ KHO / BƯU CỤC — port từ functions/api/geo.ts.
   GET /api/geo -> { ok, count, at, geo: { "<tên đã chuẩn hoá>": [lat, lng] } }

   ĐƠN GIẢN HƠN HẲN BẢN CŨ: bản cũ phải giữ refresh_token OAuth trong KV, tự làm mới
   access token, gọi Sheets API, cache 5 phút — tất cả chỉ để đọc 1 bảng toạ độ.
   Nay bảng đó nằm ngay trong Postgres: 1 câu SELECT, hết.
   Cột name_norm do DB tự sinh bằng m12_norm() nên khoá trả về luôn khớp
   normalizeName() phía client.

   Bí danh (warehouse_aliases) được trộn vào cùng map -> sửa tên lệch không cần deploy,
   chỉ cần thêm 1 dòng trong bảng (thay cho hằng ALIASES hardcode ở src/lib/geo.ts).
   ============================================================ */
import { select, json } from "./_lib/supabase";

export const config = { runtime: "edge" };

export default async function handler(_req: Request): Promise<Response> {
  try {
    const [whs, aliases] = await Promise.all([
      select<{ id: string; name_norm: string; lat: number | null; lng: number | null }>("warehouses", {
        select: "id,name_norm,lat,lng", filter: { active: "is.true" }, limit: 10000,
      }),
      select<{ alias_norm: string; warehouse_id: string }>("warehouse_aliases", {
        select: "alias_norm,warehouse_id", limit: 5000,
      }),
    ]);

    const geo: Record<string, [number, number]> = {};
    const byId = new Map<string, [number, number]>();
    for (const w of whs) {
      if (w.lat == null || w.lng == null) continue;
      const c: [number, number] = [w.lat, w.lng];
      geo[w.name_norm] = c;
      byId.set(w.id, c);
    }
    for (const a of aliases) {
      const c = byId.get(a.warehouse_id);
      if (c) geo[a.alias_norm] = c;
    }

    return new Response(JSON.stringify({ ok: true, count: Object.keys(geo).length, at: Date.now(), geo }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Toạ độ đổi rất chậm -> cho CDN giữ 5 phút, giảm tải DB khi nhiều người mở Dash.
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e: any) {
    return json({ ok: false, geo: {}, count: 0, error: String(e?.message || e) }, 502);
  }
}
