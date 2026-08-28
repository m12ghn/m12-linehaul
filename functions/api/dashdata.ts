/* ============================================================
   Quản lý "DỮ LIỆU NẠP THÊM" cho từng mục dashboard (lưu vĩnh viễn ở KV).
   Người dùng dán link/đoạn dữ liệu trong chat -> đọc & lưu lại để các lần
   phân tích sau đều dùng được.
   POST { id, action }:
     - get               -> { items:[{at,source,chars}] }
     - addUrl { url }     -> tải link (Google Sheet/HTML), lưu text
     - add    { source,text } -> lưu đoạn text nhập tay
     - remove { index }   -> xoá 1 nguồn
     - clear              -> xoá hết
   ============================================================ */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Tải nội dung 1 link thành text. Google Sheet -> CSV; web khác -> bóc HTML. */
async function fetchUrlText(url: string): Promise<string> {
  let target = url;
  const gs = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (gs) {
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || "0";
    target = `https://docs.google.com/spreadsheets/d/${gs[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }
  const res = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (compatible; M12Dash/1.0)" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  let text = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (/html/i.test(ct) || /^\s*<(?:!doctype|html)/i.test(text)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
  return text.slice(0, 20000);
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const id = String(body?.id || "").slice(0, 80);
  const action = String(body?.action || "get");
  if (!id) return json({ ok: false, error: "Thiếu id" }, 400);

  const KEY = "extra:" + id;
  const load = async (): Promise<{ items: { at: number; source: string; text: string }[] }> => {
    try {
      const raw = env.QA_KV ? await env.QA_KV.get(KEY) : null;
      return raw ? JSON.parse(raw) : { items: [] };
    } catch {
      return { items: [] };
    }
  };
  const save = async (d: any) => { try { if (env.QA_KV) await env.QA_KV.put(KEY, JSON.stringify(d)); } catch { /* bỏ qua */ } };
  const view = (d: any) => d.items.map((x: any) => ({ at: x.at, source: x.source, chars: (x.text || "").length }));

  // ----- KHO CHUNG (extra:_shared): mọi mục chat cùng đọc -> dữ liệu không rời rạc -----
  const SHARED = "extra:_shared";
  const loadShared = async (): Promise<{ items: { at: number; source: string; text: string }[] }> => {
    try { const raw = env.QA_KV ? await env.QA_KV.get(SHARED) : null; return raw ? JSON.parse(raw) : { items: [] }; }
    catch { return { items: [] }; }
  };
  const saveShared = async (d: any) => { try { if (env.QA_KV) await env.QA_KV.put(SHARED, JSON.stringify(d)); } catch { /* bỏ qua */ } };
  const sharedPush = async (item: { at: number; source: string; text: string }) => {
    const s = await loadShared();
    s.items = s.items.filter((x) => x.source !== item.source); // khử trùng theo nguồn
    s.items.push(item);
    while (s.items.length > 12) s.items.shift();
    let total = s.items.reduce((a: number, x: any) => a + (x.text || "").length, 0);
    while (total > 90000 && s.items.length > 1) total -= (s.items.shift()?.text.length || 0);
    await saveShared(s);
  };
  const sharedDrop = async (sources: string[]) => {
    if (!sources.length) return;
    const s = await loadShared();
    const set = new Set(sources);
    s.items = s.items.filter((x) => !set.has(x.source));
    await saveShared(s);
  };

  if (action === "get") {
    return json({ ok: true, items: view(await load()) });
  }
  if (action === "clear") {
    const d = await load();
    await sharedDrop(d.items.map((x) => x.source)); // gỡ khỏi kho chung luôn
    await save({ items: [] });
    return json({ ok: true, items: [] });
  }
  if (action === "remove") {
    const d = await load();
    const i = Number(body?.index);
    if (i >= 0 && i < d.items.length) { const [gone] = d.items.splice(i, 1); if (gone) await sharedDrop([gone.source]); }
    await save(d);
    return json({ ok: true, items: view(d) });
  }
  if (action === "addUrl") {
    const url = String(body?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return json({ ok: false, error: "Link không hợp lệ (phải bắt đầu http/https)." });
    let text = "";
    try {
      text = await fetchUrlText(url);
    } catch (e: any) {
      return json({ ok: false, error: "Không tải được link: " + (e?.message || e) });
    }
    if (!text || /requires you to sign in|Unauthorized|need access|sign in to continue/i.test(text.slice(0, 400))) {
      return json({ ok: false, error: "Link riêng tư hoặc trống — hãy chia sẻ 'Bất kỳ ai có liên kết' rồi gửi lại." });
    }
    const d = await load();
    const item = { at: Date.now(), source: url, text };
    d.items.push(item);
    while (d.items.length > 6) d.items.shift();
    let total = d.items.reduce((a: number, x: any) => a + x.text.length, 0);
    while (total > 60000 && d.items.length > 1) total -= (d.items.shift()?.text.length || 0);
    await save(d);
    await sharedPush(item); // -> kho chung cho mọi mục chat
    return json({ ok: true, chars: text.length, count: d.items.length, items: view(d) });
  }
  if (action === "add") {
    const text = String(body?.text || "").slice(0, 20000);
    const source = String(body?.source || "(nhập tay)").slice(0, 200);
    if (!text.trim()) return json({ ok: false, error: "Thiếu nội dung." });
    const d = await load();
    const item = { at: Date.now(), source, text };
    d.items.push(item);
    while (d.items.length > 6) d.items.shift();
    await save(d);
    await sharedPush(item); // -> kho chung cho mọi mục chat
    return json({ ok: true, count: d.items.length, items: view(d) });
  }
  return json({ ok: false, error: "Action không hợp lệ" }, 400);
};
