/* ============================================================
   ĐỌC GOOGLE SHEETS QUA API CHÍNH THỨC (OAuth, KHÔNG dùng link "mẹo"
   gviz/export nữa) — server-side, IP Cloudflare, dùng token của chính
   thovdt@ghn.vn (xác thực 1 lần qua oauth-callback.ts, refresh_token
   lưu trong KV). Đây là hướng CHẮC CHẮN không bị Google chặn 401/404
   như 2 cách "mẹo" đã thử trước (gviz/export/pub đều bị Google chặn
   request không phải từ trình duyệt thật, dù sheet công khai/xuất bản
   web cỡ nào — xác nhận qua test thực tế 2026-08-14).

   Query: ?id=<spreadsheetId>&gid=<tabGid>  HOẶC  ?id=<spreadsheetId>&sheet=<tenTab>
   ============================================================ */

const TOKEN_KEY = "oauth:google_access_token";
const REFRESH_KEY = "oauth:google_refresh_token";

async function getAccessToken(env: any): Promise<string> {
  const cachedRaw = await env.QA_KV.get(TOKEN_KEY);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    if (cached.exp > Date.now()) return cached.token;
  }

  const refreshToken = await env.QA_KV.get(REFRESH_KEY);
  if (!refreshToken) throw new Error("CHƯA_KẾT_NỐI: chưa có refresh_token, cần đăng nhập qua /api/oauth-callback trước");

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
  if (!res.ok || !data.access_token) throw new Error("Làm mới token lỗi: " + JSON.stringify(data));

  await env.QA_KV.put(TOKEN_KEY, JSON.stringify({ token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 - 60000 }));
  return data.access_token;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

/* ĐÃ THỬ tự nén gzip (CompressionStream) ở đây 2026-08-18 để giảm băng thông cho tab TLLD lớn —
   NHƯNG Cloudflare Pages TỰ ĐỘNG nén lại response ở lớp edge phía trên (kể cả khi mình đã tự đặt
   content-encoding: gzip), gây NÉN CHỒNG 2 LỚP -> trình duyệt chỉ giải nén 1 lớp -> ra chuỗi rác
   (mojibake) thay vì CSV thật. ĐÃ ROLLBACK phần tự nén tay.
   NGUYÊN NHÂN THẬT (kiểm chứng bằng endpoint test riêng 2026-08-20): Cloudflare Pages TỰ ĐỘNG nén
   gzip response — NHƯNG chỉ với content-type nó công nhận là nén được (vd text/plain), KHÔNG áp
   dụng cho "text/csv" (đã test trực tiếp: cùng payload, text/plain -> tự nén 10MB còn ~30KB;
   text/csv -> gửi nguyên, không nén). Đổi content-type sang text/plain (client vẫn chỉ gọi
   res.text() nên không đổi hành vi) để Cloudflare tự nén hộ — an toàn hơn hẳn tự nén tay. */
function csvResponse(csv: string, _request: Request): Response {
  return new Response(csv, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/* Tra "gid -> tên tab" là 1 round-trip Google riêng, chạy TRƯỚC MỌI request theo gid ->
   cộng thêm ~300-800ms độ trễ mỗi lần tải, dù cấu trúc tab (tên) HIẾM KHI đổi (không như
   DỮ LIỆU trong tab, đổi liên tục). Cache map này trong KV 1 giờ để bỏ qua round-trip đó ở
   hầu hết request — chỉ dữ liệu (values) mới luôn gọi Google mới (no-store), không ảnh
   hưởng tính "realtime" của data. */
/* Cache CSV (dữ liệu THẬT, không chỉ metadata) 30s ở edge/KV — dùng chung cho MỌI người/tab
   cùng đọc 1 gid trong cửa sổ đó thay vì mỗi lượt tự gọi Google riêng. KHÔNG làm data "cũ hơn
   cảm nhận": dự án đã tự nhận 40-60s là "đủ realtime" (SHEET_TTL 40s ở sheet.ts, REFRESH_MS 60s
   auto-poll) — 30s ở đây cộng dồn tối đa cũng chỉ nhích nhẹ trong ngưỡng đã chấp nhận sẵn, đổi
   lại cắt hẳn ~2s gọi Google Sheets API (đo thực tế trên tab "BC xin tăng cường" ~800KB/~5000
   dòng) cho MỌI lượt tải trúng cache — đây là phần chậm CHÍNH của lượt tải, không phải metadata. */
const VALUE_TTL_MS = 30 * 1000;
// Tab to nhất (TLLD HCM01/HCM20) tới ~14-17MB — ghi/đọc KV cỡ đó vẫn tốn CPU serialize +
// KV cũng chỉ "eventually consistent" (có thể trễ tới ~60s lan toàn cầu, ĐÃ kiểm chứng thực tế:
// gọi lại ngay sau khi ghi vẫn miss cache) -> cache KHÔNG giúp được các tab khổng lồ này, chỉ tổ
// tốn CPU. Giới hạn cache cho payload NHỎ hơn ngưỡng này, nơi đã đo thấy có tác dụng thật (tab
// ~800KB "xin tăng cường": lần trúng cache ~1s so với ~3.5s gọi Google trực tiếp).
const CACHE_SIZE_LIMIT = 3 * 1024 * 1024; // 3MB
async function getCachedCsv(env: any, key: string): Promise<string | null> {
  const raw = await env.QA_KV.get(key);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d.exp > Date.now() ? d.csv : null;
  } catch { return null; }
}
/** KHÔNG await ở call-site (dùng waitUntil) — ghi KV không được làm chậm response trả về Dash. */
async function putCachedCsv(env: any, key: string, csv: string): Promise<void> {
  if (csv.length > CACHE_SIZE_LIMIT) return; // payload lớn: bỏ qua, xem lý do ở comment trên
  try {
    await env.QA_KV.put(key, JSON.stringify({ csv, exp: Date.now() + VALUE_TTL_MS }), { expirationTtl: 120 });
  } catch { /* cache lỗi -> bỏ qua, không ảnh hưởng response đã trả */ }
}

const META_TTL_MS = 60 * 60 * 1000;
interface SheetMeta { title: string; rowCount: number }
async function getSheetMetas(env: any, id: string, authHeader: Record<string, string>): Promise<Record<string, SheetMeta>> {
  const cacheKey = "sheetmeta2:" + id;
  const cachedRaw = await env.QA_KV.get(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    if (cached.exp > Date.now()) return cached.metas;
  }
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`, { headers: authHeader });
  if (!metaRes.ok) throw new Error("Lỗi đọc metadata: HTTP " + metaRes.status + " " + (await metaRes.text()));
  const meta: any = await metaRes.json();
  const metas: Record<string, SheetMeta> = {};
  for (const s of meta.sheets || []) {
    metas[String(s.properties?.sheetId)] = { title: s.properties?.title, rowCount: s.properties?.gridProperties?.rowCount || 0 };
  }
  await env.QA_KV.put(cacheKey, JSON.stringify({ metas, exp: Date.now() + META_TTL_MS }));
  return metas;
}

/* Tab to (TLLD HCM01/HCM20, hàng chục nghìn dòng) mất 9-13s gọi Google Sheets API 1 lần nguyên
   khối (đo thực tế qua Performance API trên trình duyệt thật 2026-08-20). Đo thử: TÁCH range đó
   thành N phần gọi SONG SONG rồi ghép lại theo đúng thứ tự — vẫn đúng 100% dữ liệu (đã kiểm tra
   khớp số dòng), nhưng nhanh hơn thật ~40-45% (n=8: HCM01 từ ~2.6-3s còn ~1.4-1.9s, HCM20 từ
   ~1.8s còn ~1s).
   ⚠️ BÀI HỌC (2026-08-20): ban đầu bật tách theo NGƯỠNG SỐ DÒNG KHAI BÁO (gridProperties.rowCount)
   bất kỳ sheet nào >8000 dòng — SAI với sheet nối Google Form (vd "Bc xin TC"): Form pre-allocate
   sẵn hàng chục nghìn dòng trống dự phòng (rowCount báo 52.623) trong khi dữ liệu THẬT chỉ ~5.000
   dòng đầu. Tách theo rowCount kiểu đó chia phần lớn thành các đoạn TRỐNG (gọi Google vô ích, dữ
   liệu thật dồn hết vào 1 đoạn) -> không nhanh hơn, có khi còn chậm hơn vì thêm round-trip thừa.
   -> CHỈ tách cho gid đã tự tay đo & xác nhận rowCount khớp đúng dữ liệu thật (không phải sheet
   Form), liệt kê thẳng trong SPLIT_GIDS — không suy đoán theo ngưỡng số dòng chung chung nữa. */
const SPLIT_GIDS = new Set(["1276580053", "1306265684"]); // TLLD HCM01, TLLD HCM20 (đã đo: rowCount khớp đúng số dòng thật)
const SPLIT_PARTS = 8;
async function fetchValues(id: string, gid: string, title: string, rowCount: number, authHeader: Record<string, string>): Promise<unknown[][]> {
  if (!SPLIT_GIDS.has(gid) || !rowCount) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(title)}?valueRenderOption=FORMATTED_VALUE`, { headers: authHeader });
    if (!res.ok) throw new Error("Lỗi đọc dữ liệu: HTTP " + res.status + " " + (await res.text()));
    const data: any = await res.json();
    return data.values || [];
  }
  const chunkSize = Math.ceil(rowCount / SPLIT_PARTS);
  const parts = await Promise.all(
    Array.from({ length: SPLIT_PARTS }, (_, i) => {
      const from = i * chunkSize + 1;
      const to = Math.min(rowCount, (i + 1) * chunkSize);
      const rng = `${encodeURIComponent(title)}!A${from}:ZZ${to}`;
      return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${rng}?valueRenderOption=FORMATTED_VALUE`, { headers: authHeader })
        .then(async (r) => { if (!r.ok) throw new Error("Lỗi đọc dữ liệu (phần " + i + "): HTTP " + r.status + " " + (await r.text())); return r.json(); });
    })
  );
  return parts.flatMap((p: any) => p.values || []);
}

export const onRequestGet = async ({ request, env, waitUntil }: any): Promise<Response> => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const gid = url.searchParams.get("gid");
  const sheetName = url.searchParams.get("sheet");
  const listTabs = url.searchParams.get("list");

  try {
    const token = await getAccessToken(env);
    const authHeader = { authorization: "Bearer " + token };

    if (listTabs) {
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`, { headers: authHeader });
      const meta: any = await metaRes.json();
      return new Response(JSON.stringify(meta, null, 2), { headers: { "content-type": "application/json" } });
    }

    if (!id || (!gid && !sheetName)) return new Response("Thiếu id/gid hoặc id/sheet", { status: 400 });

    const cacheKey = "sheetcsv:" + id + ":" + (gid || sheetName);
    const cached = await getCachedCsv(env, cacheKey);
    if (cached != null) return csvResponse(cached, request);

    let title = sheetName;
    let rowCount = 0;
    if (!title) {
      const metas = await getSheetMetas(env, id, authHeader);
      const m = metas[String(gid)];
      if (!m) return new Response("Không tìm thấy gid=" + gid + " trong workbook", { status: 404 });
      title = m.title;
      rowCount = m.rowCount;
    }

    const values = await fetchValues(id, String(gid || ""), title as string, rowCount, authHeader);
    const csv = toCsv(values);
    // Ghi cache CHẠY NGẦM (waitUntil) — không đợi ghi KV xong mới trả kết quả cho Dash,
    // tránh 1 lần ghi KV chậm/lỗi làm CHÍNH lượt tải này bị chậm theo hoặc bị lỗi lây.
    const cacheWrite = putCachedCsv(env, cacheKey, csv);
    if (typeof waitUntil === "function") waitUntil(cacheWrite); else cacheWrite.catch(() => {});

    return csvResponse(csv, request);
  } catch (e) {
    return new Response("Proxy lỗi: " + String(e), { status: 502 });
  }
};
