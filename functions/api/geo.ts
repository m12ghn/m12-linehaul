/* ============================================================
   TOẠ ĐỘ KHO/BC — đọc từ sheet "Toạ độ kho/BC" CHÍNH THỨC toàn quốc (Sếp cung cấp 2026-08-21),
   có warehouse_id/warehouse_name/latitude/longitude, Sếp xác nhận cập nhật thường xuyên.
   Cache KV 5 phút -> trả JSON gọn { ok, count, at, geo: { <tên đã chuẩn hoá>: [lat, lng] } }.
   Nhờ đó THÊM/SỬA điểm trên sheet là Dash cập nhật trong vài phút, không cần build lại geo.json.

   ⚠️ LỊCH SỬ: trước dùng MyMap (Google My Maps, KML) — link công khai /maps/d/kml bị Google
   chặn 403 từ IP Cloudflare (xác nhận 2026-08-20). ĐÃ THỬ sửa bằng OAuth + Drive API (xin thêm
   scope drive.readonly, bật Drive API cho project) nhưng Google từ chối lấy nội dung My Map qua
   CẢ files.export ("chỉ hỗ trợ file Docs Editors") LẪN files.get?alt=media ("chỉ hỗ trợ file nhị
   phân") — giới hạn cứng của Google, không phải thiếu cấu hình. -> CHUYỂN hẳn sang sheet này,
   đọc qua OAuth Sheets (hạ tầng đã có, đang chạy ổn định cho TLLD/Lịch Tải), không dùng MyMap nữa.
   ============================================================ */
const SHEET_ID = "1lqkSifW2ROTnlYMqhBNcKgHgDd5z-ktcn60cCawqyRs";
const GID = "0";

const TOKEN_KEY = "oauth:google_access_token";
const REFRESH_KEY = "oauth:google_refresh_token";
async function getAccessToken(env: any): Promise<string | null> {
  const cachedRaw = await env.QA_KV?.get(TOKEN_KEY);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    if (cached.exp > Date.now()) return cached.token;
  }
  const refreshToken = await env.QA_KV?.get(REFRESH_KEY);
  if (!refreshToken || !env.GOOGLE_OAUTH_CLIENT_ID) return null;
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data: any = await res.json();
  if (!res.ok || !data.access_token) return null;
  await env.QA_KV.put(TOKEN_KEY, JSON.stringify({ token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 - 60000 }));
  return data.access_token;
}

// PHẢI khớp normalizeName() ở src/lib/normalize.ts & scripts/build-geo.mjs.
function stripAccents(s: string): string {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
function normalizeName(s: string): string {
  let x = stripAccents(s);
  x = x.replace(/^\s*\d{3,}\s*[-_().\s]+/, " ");
  x = x.replace(/[^a-z0-9]+/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

function findCol(header: string[], keys: string[]): number {
  const norm = (s: string) => (s || "").toLowerCase().trim();
  const h = header.map(norm);
  for (const k of keys) {
    const idx = h.indexOf(norm(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** values.get trả sẵn 2D array (không cần tự parse CSV/quote như link công khai).
 *  Trả thêm "places" (id + tên NGUYÊN VĂN, chưa chuẩn hoá) — Sếp yêu cầu 2026-08-21: nhiều BC có
 *  trên sheet toạ độ toàn quốc này nhưng CHƯA từng chạy tuyến nào trong Lịch Tải nên không có trong
 *  gợi ý tên (usePlaceNames/usePlaceIds chỉ gom từ Lịch Tải) -> bổ sung để gõ tìm ra luôn. */
function buildGeoFromValues(values: string[][]): { geo: Record<string, [number, number]>; places: { id: string; name: string }[] } {
  const geo: Record<string, [number, number]> = {};
  const places: { id: string; name: string }[] = [];
  if (values.length < 2) return { geo, places };
  const H = values[0];
  const nameCol = findCol(H, ["warehouse_name"]);
  const idCol = findCol(H, ["warehouse_id"]);
  const latCol = findCol(H, ["latitude"]);
  const lngCol = findCol(H, ["longitude"]);
  if (nameCol < 0 || latCol < 0 || lngCol < 0) return { geo, places };
  for (const r of values.slice(1)) {
    const name = (r[nameCol] || "").trim();
    const lat = parseFloat(r[latCol]);
    const lng = parseFloat(r[lngCol]);
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const key = normalizeName(name);
    if (!key) continue;
    geo[key] = [Number(lat.toFixed(6)), Number(lng.toFixed(6))]; // dòng sau đè dòng trước nếu trùng tên
    places.push({ id: idCol >= 0 ? (r[idCol] || "").trim() : "", name });
  }
  return { geo, places };
}

const H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" };

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  try {
    if (env.QA_KV) { const c = await env.QA_KV.get("geo:live"); if (c) return new Response(c, { headers: H }); }

    const token = await getAccessToken(env);
    if (!token) return new Response(JSON.stringify({ ok: false, geo: {}, error: "CHƯA_KẾT_NỐI" }), { headers: H });
    const authHeader = { authorization: "Bearer " + token };

    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, { headers: authHeader });
    if (!metaRes.ok) return new Response(JSON.stringify({ ok: false, geo: {}, error: "Lỗi đọc metadata: HTTP " + metaRes.status }), { headers: H });
    const meta: any = await metaRes.json();
    const sh = (meta.sheets || []).find((s: any) => String(s.properties?.sheetId) === GID);
    if (!sh) return new Response(JSON.stringify({ ok: false, geo: {}, error: "Không tìm thấy gid=" + GID }), { headers: H });
    const title = sh.properties.title;

    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(title)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: authHeader });
    if (!valRes.ok) return new Response(JSON.stringify({ ok: false, geo: {}, error: "Lỗi đọc dữ liệu: HTTP " + valRes.status }), { headers: H });
    const data: any = await valRes.json();
    const { geo, places } = buildGeoFromValues((data.values || []).map((row: any[]) => row.map((v) => String(v ?? ""))));

    const body = JSON.stringify({ ok: true, count: Object.keys(geo).length, at: Date.now(), geo, places });
    if (env.QA_KV && Object.keys(geo).length) await env.QA_KV.put("geo:live", body, { expirationTtl: 300 });
    return new Response(body, { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, geo: {}, error: String(e) }), { headers: H });
  }
};
