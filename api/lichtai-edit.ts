/* ============================================================
   Vercel Edge Function — Sửa Lịch Tải NGAY TRÊN DASH.
   Port từ functions/api/lichtai-edit.ts (Cloudflare, ghi ngược Google
   Sheet bằng "dấu vân tay nội dung" trên grid) sang UPDATE THẲNG bảng
   routes/route_stops trong Supabase — xem supabase/PHA3-PLAN.md.

   Vì routes/route_stops đã có KHOÁ THẬT (id) từ Pha 0, không cần dò
   "dấu vân tay nội dung" trên toàn bộ grid như bản Cloudflare — chỉ
   cần tìm route theo (region_key, route_name) rồi UPDATE cột tương ứng
   (route_stops lọc thêm theo match{} để nhắm đúng (các) điểm dừng).
   Giữ NGUYÊN request/response shape với bản Cloudflare để frontend
   (src/lib/lichTaiEdit.ts) không cần đổi khi trỏ sang Vercel.

   CHỈ ADMIN được sửa (x-admin-token — CHƯA có kiểm tra phiên đăng nhập,
   xem api/_admin.ts + PHA3-PLAN.md mục cutover auth).
   ============================================================ */
export const config = { runtime: "edge" };

import { db, json, kvGet, kvSet } from "./_kv";
import { isAdminReq } from "./_admin";

// PHẢI khớp SHEETS trong src/config.ts — thêm vùng mới ở đó thì thêm cả ở đây.
const GID_TO_REGION: Record<string, string> = {
  "0": "noi-thanh-hcm",
  "961518640": "noi-vung-hcm",
  "84848529": "lien-vung-mn",
  "541305122": "mbh-song-than",
  "1937583700": "mbh-tan-tao",
  "722712650": "mbh-tan-thuan-q7",
};

type Scope = "stop" | "route";
type FieldKey = "loaiHinh" | "toi" | "roi" | "load" | "ncc" | "bks";
// Cột thật trong Postgres cho từng field — route: bảng routes, stop: bảng route_stops.
const FIELD_COLS: Record<FieldKey, { table: "routes" | "route_stops"; column: string; scope: Scope }> = {
  loaiHinh: { table: "route_stops", column: "loai_hinh", scope: "stop" },
  toi: { table: "route_stops", column: "gio_toi", scope: "stop" },
  roi: { table: "route_stops", column: "gio_roi", scope: "stop" },
  load: { table: "routes", column: "load_text", scope: "route" },
  ncc: { table: "routes", column: "ncc", scope: "route" },
  bks: { table: "routes", column: "bks", scope: "route" },
};
const LOAI_HINH_VALUES = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];

/** Làm sạch biển số — GIỐNG HỆT cleanBks() trong src/lib/sheet.ts, để so sánh oldValue đúng chuỗi hiển thị. */
function cleanBksDisplay(s: string): string {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}
/** Chặn ký tự mở đầu công thức (=+-@) — phòng xa dù Postgres không "thực thi" công thức như Sheets. */
function guardFormulaInjection(s: string): string {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function validateField(field: FieldKey, rawValue: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = (rawValue || "").trim();
  if (field === "loaiHinh") {
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
    const hit = LOAI_HINH_VALUES.find((c) => norm(c) === norm(v));
    return hit ? { ok: true, value: hit } : { ok: false, error: "invalid_value" };
  }
  if (field === "toi" || field === "roi") {
    if (v === "" || /^\d{1,2}:\d{2}$/.test(v)) return { ok: true, value: v };
    return { ok: false, error: "invalid_value" };
  }
  if (field === "load") {
    if (/^\d{1,6}$/.test(v) || /^van$/i.test(v)) return { ok: true, value: v };
    return { ok: false, error: "invalid_value" };
  }
  if (field === "ncc") {
    if (v.length > 60) return { ok: false, error: "invalid_value" };
    return { ok: true, value: guardFormulaInjection(v) };
  }
  if (field === "bks") {
    if (v.length > 20) return { ok: false, error: "invalid_value" };
    return { ok: true, value: cleanBksDisplay(v) };
  }
  return { ok: false, error: "field_not_allowed" };
}

interface SaveBody {
  action: "save";
  gid: string;
  route: string;
  scope: Scope;
  field: FieldKey;
  value: string;
  oldValue: string;
  match?: { kho: string; loaiHinh: string; toi: string; roi: string; id: string };
  force?: boolean;
  _email?: string;
}

const LOG_KEY = "ltedit:log:list";
const LOG_MAX = 500;
interface LogEntry { at: number; email: string; gid: string; route: string; scope: Scope; field: FieldKey; from: string; to: string }
async function appendLog(entry: LogEntry): Promise<void> {
  const list = (await kvGet<LogEntry[]>(LOG_KEY)) || [];
  list.push(entry);
  await kvSet(LOG_KEY, list.slice(-LOG_MAX));
}

async function handleSave(body: SaveBody): Promise<Response> {
  const { gid, route, scope, field } = body;
  const region = GID_TO_REGION[gid];
  if (!region) return json({ error: "gid_not_allowed" }, 400);
  if (!route || !route.trim()) return json({ error: "route_unnamed" }, 400);
  const colDef = FIELD_COLS[field];
  if (!colDef) return json({ error: "field_not_allowed" }, 400);
  if (colDef.scope !== scope) return json({ error: "bad_request" }, 400);
  if (scope === "stop" && !body.match) return json({ error: "bad_request" }, 400);

  const valid = validateField(field, body.value);
  if (!valid.ok) return json({ error: valid.error }, 400);

  const supa = db();
  if (!supa) return json({ error: "not_configured" }, 500);

  const { data: routeRow, error: rErr } = await supa
    .from("routes")
    .select("id, load_text, ncc, bks")
    .eq("region_key", region)
    .eq("route_name", route)
    .maybeSingle();
  if (rErr) return json({ error: "db_error", detail: rErr.message }, 502);
  if (!routeRow) return json({ error: "row_not_found" }, 404);

  const oldValue = (body.oldValue || "").trim();

  // ----- scope "route": cột nằm ngay trên bảng routes -----
  if (scope === "route") {
    const rawCur = String((routeRow as Record<string, unknown>)[colDef.column] || "");
    const cur = field === "bks" ? cleanBksDisplay(rawCur) : rawCur;
    if (!body.force && cur !== oldValue) return json({ error: "conflict", current: cur }, 409);
    if (cur === valid.value) return json({ ok: true, updated: 0, cells: [], value: valid.value });

    const { error: uErr } = await supa.from("routes").update({ [colDef.column]: valid.value, updated_at: new Date().toISOString() }).eq("id", routeRow.id);
    if (uErr) return json({ error: "db_error", detail: uErr.message }, 502);

    await appendLog({ at: Date.now(), email: body._email || "", gid, route, scope, field, from: cur, to: valid.value });
    return json({ ok: true, updated: 1, cells: [`routes.${colDef.column}#${routeRow.id}`], value: valid.value });
  }

  // ----- scope "stop": lọc route_stops theo route_id + match{} (thay "dấu vân tay" trên grid) -----
  const m = body.match!;
  const { data: stopRows, error: sErr } = await supa
    .from("route_stops")
    .select("id, loai_hinh, gio_toi, gio_roi")
    .eq("route_id", routeRow.id)
    .eq("warehouse_name", m.kho || "")
    .eq("loai_hinh", m.loaiHinh || "")
    .eq("gio_toi", m.toi || "")
    .eq("gio_roi", m.roi || "")
    .eq("sheet_row_id", m.id || "");
  if (sErr) return json({ error: "db_error", detail: sErr.message }, 502);
  if (!stopRows || stopRows.length === 0) return json({ error: "row_not_found" }, 404);

  const curValues = stopRows.map((r) => String((r as Record<string, unknown>)[colDef.column] || ""));
  const distinct = [...new Set(curValues)];
  if (!body.force) {
    if (distinct.length > 1) return json({ error: "inconsistent", values: distinct }, 409);
    if (distinct[0] !== oldValue) return json({ error: "conflict", current: distinct[0] }, 409);
  }
  if (distinct.length === 1 && distinct[0] === valid.value) return json({ ok: true, updated: 0, cells: [], value: valid.value });

  const ids = stopRows.map((r) => r.id as number);
  const { error: uErr } = await supa.from("route_stops").update({ [colDef.column]: valid.value }).in("id", ids);
  if (uErr) return json({ error: "db_error", detail: uErr.message }, 502);

  await appendLog({ at: Date.now(), email: body._email || "", gid, route, scope, field, from: distinct[0] ?? "", to: valid.value });
  return json({ ok: true, updated: ids.length, cells: ids.map((id) => `route_stops.${colDef.column}#${id}`), value: valid.value });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body: Record<string, unknown> = await req.json().catch(() => ({}));

  if (body?.action === "selftest") {
    if (!isAdminReq(req)) return json({ error: "unauthorized" }, 401);
    return json({ ok: true, configured: !!db() });
  }

  if (body?.action !== "save") return json({ error: "bad_request" }, 400);
  if (!isAdminReq(req)) return json({ error: "unauthorized" }, 401);

  return handleSave(body as unknown as SaveBody);
}
