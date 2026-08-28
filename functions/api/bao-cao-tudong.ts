/* ============================================================
   Đọc sheet "Lịch tải M12" (nhật ký chuyến THỰC TẾ dùng cho báo cáo tự động Telegram — KHÁC sheet
   Lịch Tải KẾ HOẠCH chính của Dash) — dùng LẠI đúng OAuth người dùng đã kết nối cho geo.ts (KV
   "oauth:google_refresh_token" + GOOGLE_OAUTH_CLIENT_ID/SECRET), KHÔNG dùng service account
   (_gsheets.ts) vì service account đó CHƯA được chia sẻ vào sheet này (thử 2026-08-27 báo lỗi
   "not_configured" — secret GSHEETS_SA_B64 chưa được set, đường OAuth người dùng chắc chắn đã có
   sẵn quyền vì đây là tài khoản Google của chính Sếp, chủ sheet).
   Worker Cloudflare Cron "m12-canh-bao" gọi endpoint này để lấy dữ liệu thay vì gọi thẳng Google
   Sheets (sheet không public), tránh phải cấp OAuth riêng cho worker đó.
   Trả JSON { ok, rows } — rows = toàn bộ lưới ô (kể cả dòng tiêu đề), FORMATTED_VALUE.
   ============================================================ */

const SHEET_ID = "1qencarSmiH1-BukeHTTG1MFsbJLBIBDn6drGIhZP-nU";
const GID = "2119716240";

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

const H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" };

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  try {
    const token = await getAccessToken(env);
    if (!token) return new Response(JSON.stringify({ ok: false, rows: [], error: "CHƯA_KẾT_NỐI" }), { headers: H });
    const authHeader = { authorization: "Bearer " + token };

    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, { headers: authHeader });
    if (!metaRes.ok) return new Response(JSON.stringify({ ok: false, rows: [], error: "Lỗi đọc metadata: HTTP " + metaRes.status }), { headers: H });
    const meta: any = await metaRes.json();
    const sh = (meta.sheets || []).find((s: any) => String(s.properties?.sheetId) === GID);
    if (!sh) return new Response(JSON.stringify({ ok: false, rows: [], error: "Không tìm thấy gid=" + GID }), { headers: H });
    const title = sh.properties.title;

    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(title)}?valueRenderOption=FORMATTED_VALUE`, { headers: authHeader });
    if (!valRes.ok) return new Response(JSON.stringify({ ok: false, rows: [], error: "Lỗi đọc dữ liệu: HTTP " + valRes.status }), { headers: H });
    const data: any = await valRes.json();
    return new Response(JSON.stringify({ ok: true, rows: data.values || [] }), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, rows: [], error: String(e instanceof Error ? e.message : e) }), { headers: H });
  }
};
