/* ============================================================
   Ghi dữ liệu vào Google Sheets từ Cloudflare Function — dùng service account,
   KHÔNG cần gói googleapis (Workers runtime không có nodejs_compat).
   - Ký JWT RS256 bằng Web Crypto (cùng kiểu crypto.subtle như _session.ts, khác
     thuật toán: RSASSA-PKCS1-v1_5 thay vì HMAC), đổi lấy access token OAuth2
     theo luồng service-account JWT-bearer, cache trong QA_KV.
   - Đọc/ghi qua REST API sheets.googleapis.com bằng fetch thẳng.
   Bí mật: env.GSHEETS_SA_B64 = base64(JSON key service account) — set 1 lần:
     npx wrangler pages secret put GSHEETS_SA_B64 --project-name=m12-lich-tai
   (Đã share Sheet Lịch Tải cho email service account đó, quyền Editor.)
   File tiền tố "_" -> KHÔNG phải route, chỉ để import.
   ============================================================ */

const enc = new TextEncoder();

function b64urlFromBytes(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromStr(s: string): string {
  return b64urlFromBytes(enc.encode(s));
}

/** Cắt PEM "-----BEGIN/END PRIVATE KEY-----" + xuống dòng -> bytes DER (pkcs8). */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface ServiceAccount { client_email: string; private_key: string }

function readServiceAccount(env: any): ServiceAccount | null {
  try {
    const b64 = String(env?.GSHEETS_SA_B64 || "");
    const raw = b64 ? atob(b64) : String(env?.GSHEETS_SA_JSON || "");
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.client_email || !d?.private_key) return null;
    return { client_email: d.client_email, private_key: d.private_key };
  } catch {
    return null;
  }
}

async function signRs256(input: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return b64urlFromBytes(new Uint8Array(sig));
}

/** Timeout wrapper — cùng kiểu fetchWithTimeout đã dùng trong assistant.ts. */
async function fetchWithTimeout(url: string, opts: any = {}, ms = 9000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_KV_KEY = "gsheets:token";
const TOKEN_SKEW_MS = 120_000; // đổi token mới trước khi hết hạn 2 phút

async function mintAccessToken(sa: ServiceAccount): Promise<{ token: string; exp: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = b64urlFromStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlFromStr(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp,
  }));
  const signingInput = header + "." + claims;
  const jwt = signingInput + "." + await signRs256(signingInput, sa.private_key);

  const body = "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt);
  const r = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("token_exchange_failed:" + r.status + ":" + (await r.text().catch(() => "")));
  const d: any = await r.json();
  if (!d?.access_token) throw new Error("token_exchange_no_token");
  return { token: d.access_token, exp: Date.now() + Number(d.expires_in || 3600) * 1000 };
}

/** Access token còn hạn — cache KV, tự mint lại khi hết/gần hết hạn. */
export async function getAccessToken(env: any): Promise<string> {
  const sa = readServiceAccount(env);
  if (!sa) throw new Error("not_configured");
  if (env?.QA_KV) {
    try {
      const raw = await env.QA_KV.get(TOKEN_KV_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.token && d?.exp && d.exp - Date.now() > TOKEN_SKEW_MS) return d.token;
      }
    } catch { /* rơi xuống mint mới */ }
  }
  const { token, exp } = await mintAccessToken(sa);
  if (env?.QA_KV) {
    try {
      await env.QA_KV.put(TOKEN_KV_KEY, JSON.stringify({ token, exp }), { expirationTtl: 3000 });
    } catch { /* không sao, lần sau mint lại */ }
  }
  return token;
}

function tabsKey(spreadsheetId: string): string {
  return "gsheets:tabs:" + spreadsheetId;
}

/** Tên tab theo gid — Sheets API values.get/update cần TÊN, không nhận gid trực tiếp. Cache 24h. */
export async function sheetTitle(env: any, spreadsheetId: string, gid: string): Promise<string> {
  if (env?.QA_KV) {
    try {
      const raw = await env.QA_KV.get(tabsKey(spreadsheetId));
      if (raw) {
        const map = JSON.parse(raw);
        if (map?.[gid]) return map[gid];
      }
    } catch { /* rơi xuống tải mới */ }
  }
  const map = await fetchTabMap(env, spreadsheetId);
  const title = map[gid];
  if (!title) throw new Error("gid_not_found:" + gid);
  return title;
}

async function fetchTabMap(env: any, spreadsheetId: string): Promise<Record<string, string>> {
  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const r = await fetchWithTimeout(url, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("gsheets_meta_failed:" + r.status);
  const d: any = await r.json();
  const map: Record<string, string> = {};
  for (const s of d?.sheets || []) map[String(s?.properties?.sheetId ?? "")] = String(s?.properties?.title ?? "");
  if (env?.QA_KV) {
    try { await env.QA_KV.put(tabsKey(spreadsheetId), JSON.stringify(map), { expirationTtl: 86400 }); } catch { /* bỏ qua */ }
  }
  return map;
}

/** Xoá cache tên tab (gọi khi values.get/update báo lỗi "Unable to parse range" — tab bị đổi tên). */
export async function invalidateTitleCache(env: any, spreadsheetId: string): Promise<void> {
  if (env?.QA_KV) { try { await env.QA_KV.delete(tabsKey(spreadsheetId)); } catch { /* bỏ qua */ } }
}

/** A1 notation cho 1 ô, row/col đều 1-based (row1=1 là dòng đầu tiên, col1=1 là cột A). */
export function a1(title: string, row1: number, col1: number): string {
  let c = col1, letters = "";
  while (c > 0) { const rem = (c - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; c = Math.floor((c - 1) / 26); }
  const safeTitle = title.replace(/'/g, "''");
  return `'${safeTitle}'!${letters}${row1}`;
}

/** Đọc toàn bộ grid 1 tab, dạng FORMATTED_VALUE — khớp hệt chuỗi CSV đang hiển thị trên dash. */
export async function readGrid(env: any, spreadsheetId: string, title: string): Promise<string[][]> {
  const token = await getAccessToken(env);
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;
  const r = await fetchWithTimeout(url, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("gsheets_read_failed:" + r.status);
  const d: any = await r.json();
  return Array.isArray(d?.values) ? d.values : [];
}

/** Ghi nhiều ô 1 lần qua batchUpdate, valueInputOption=USER_ENTERED (giống gõ tay vào ô). */
export async function writeCells(env: any, spreadsheetId: string, cells: { a1: string; value: string }[]): Promise<void> {
  if (!cells.length) return;
  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: cells.map((c) => ({ range: c.a1, values: [[c.value]] })),
    }),
  }, 12000);
  if (!r.ok) throw new Error("gsheets_write_failed:" + r.status + ":" + (await r.text().catch(() => "")));
}

/** Kiểm tra nhanh: đã cấu hình secret + đọc được tên tab đầu tiên chưa (dùng cho action "selftest"). */
export async function selftest(env: any, spreadsheetId: string): Promise<{ configured: boolean; tabs?: Record<string, string>; error?: string }> {
  const sa = readServiceAccount(env);
  if (!sa) return { configured: false, error: "not_configured" };
  try {
    const map = await fetchTabMap(env, spreadsheetId);
    return { configured: true, tabs: map };
  } catch (e: any) {
    return { configured: true, error: String(e?.message || e) };
  }
}
