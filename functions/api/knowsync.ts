/* ============================================================
   ĐỒNG BỘ KIẾN THỨC HẰNG NGÀY — đọc 1 workbook Google Sheet (Sếp cung cấp)
   1 LẦN/NGÀY, lưu vào CSDL Dash (KV: extra:_shared) để trợ lý LUÔN biết.
   - Gọi qua client khi mở Dash (fire-and-forget) -> tự làm mới ~1 lần/ngày.
   - Nếu chưa tới hạn (đã sync <20h) -> trả trạng thái cache, KHÔNG gọi lại Sheet.
   - Sheet PHẢI công khai (Anyone with link → Viewer); nếu private -> báo lỗi, giữ dữ liệu cũ.
   ============================================================ */
const SHEET_ID = "1mvu295K_b3AtVkAyNSZKrYHAU-xlp-UyhwZ8CXQUKks";
const GIDS = ["0"]; // các tab cần đọc (bổ sung khi có thêm)
const NAME = "Kiến thức bổ sung M12";
const SOURCE_TAG = "📅 Daily";                // nhãn nguồn cố định -> ghi đè bản ngày cũ
const SYNC_KEY = "sync:knowledge";            // mốc thời gian sync gần nhất
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;  // ~1 lần/ngày
// Giữ NHỎ: kho này nạp vào MỌI câu hỏi trợ lý -> to quá sẽ ngốn token/neuron & mau "hết lượt".
const MAX_TAB = 5000, MAX_TOTAL = 8000;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function fetchTab(gid: string): Promise<string> {
  const bases = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
  ];
  for (const b of bases) {
    try {
      const r = await fetch(b + "&_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) continue;
      const t = await r.text();
      if (/^\s*<!doctype html|requires you to sign in|Unauthorized|not_in_iframe/i.test(t.slice(0, 300))) continue; // private
      if (t.trim().length > 3) return t;
    } catch { /* nguồn kế */ }
  }
  throw new Error("PRIVATE_OR_EMPTY");
}

async function doSync(env: any): Promise<{ ok: boolean; chars: number; tabs: number; error?: string }> {
  const parts: string[] = [];
  let okTabs = 0, lastErr = "";
  for (const gid of GIDS) {
    try {
      const csv = await fetchTab(gid);
      parts.push(`### Tab gid=${gid}\n` + csv.slice(0, MAX_TAB));
      okTabs++;
    } catch (e: any) { lastErr = String(e?.message || e); }
  }
  if (!okTabs) return { ok: false, chars: 0, tabs: 0, error: lastErr || "Không đọc được sheet (có thể đang để riêng tư)." };
  const text = parts.join("\n\n").slice(0, MAX_TOTAL);
  // Ghi vào kho CHUNG extra:_shared -> trợ lý mọi mục đều đọc. Ghi đè bản Daily cũ.
  if (env.QA_KV) {
    const raw = await env.QA_KV.get("extra:_shared");
    const d = raw ? JSON.parse(raw) : { items: [] };
    d.items = (d.items || []).filter((x: any) => !String(x?.source || "").startsWith(SOURCE_TAG));
    d.items.push({ at: Date.now(), source: `${SOURCE_TAG}: ${NAME}`, text: `[KIẾN THỨC BỔ SUNG — cập nhật hằng ngày, DÙNG như số liệu thật]\n${text}` });
    await env.QA_KV.put("extra:_shared", JSON.stringify(d));
    await env.QA_KV.put(SYNC_KEY, String(Date.now()));
  }
  return { ok: true, chars: text.length, tabs: okTabs };
}

async function handle(request: Request, env: any): Promise<Response> {
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!env.QA_KV) return json({ ok: false, error: "no_kv" }, 200);
  let last = 0;
  try { last = Number((await env.QA_KV.get(SYNC_KEY)) || 0); } catch { /* bỏ qua */ }
  const age = Date.now() - last;
  if (!force && last && age < MIN_INTERVAL_MS) {
    return json({ ok: true, cached: true, lastSync: last, nextInHours: Math.round((MIN_INTERVAL_MS - age) / 3.6e6) });
  }
  const res = await doSync(env);
  return json({ ...res, lastSync: res.ok ? Date.now() : last });
}

export const onRequestGet = async ({ request, env }: any): Promise<Response> => handle(request, env);
export const onRequestPost = async ({ request, env }: any): Promise<Response> => handle(request, env);
