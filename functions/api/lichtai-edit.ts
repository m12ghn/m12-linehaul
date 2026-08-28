/* ============================================================
   Sửa Lịch Tải NGAY TRÊN DASH -> ghi ngược vào Google Sheet gốc.
   POST /api/lichtai-edit
     { action:"selftest" }                                          -> { ok, configured, tabs? }
     { action:"save", gid, route, scope, field, value, oldValue,
       match?: {kho,loaiHinh,toi,roi,id}, force? }                  -> { ok, updated, cells, value }

   KHÔNG dùng số dòng Sheet — client không hề biết/gửi số dòng. Server tự dò lại (các) dòng khớp
   bằng "dấu vân tay nội dung" (route + match) tại chính thời điểm ghi, nên không sợ bị lệch dòng
   nếu ai đó chèn/xoá dòng trên Sheet giữa lúc Sếp mở trang và lúc bấm lưu.

   CHỈ ADMIN được sửa (đã chốt với Sếp — an toàn nhất cho lần đầu ghi thật vào sheet vận hành thật).

   findCol() dưới đây là BẢN SAO của src/lib/csv.ts — phải giữ đồng bộ 2 bên (giống cách
   functions/api/geo.ts đã nhân bản normalizeName từ src/lib/normalize.ts).
   ============================================================ */
import { isAdminReq } from "./_admin";
import { readGrid, writeCells, sheetTitle, invalidateTitleCache, a1, selftest as gsheetsSelftest } from "./_gsheets";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// PHẢI khớp SHEET_ID/SHEETS trong src/config.ts — thêm tab mới ở đó thì thêm cả ở đây.
const SHEET_ID = "1M_yoD-7FPwmE_TjgoPklgysfiBA2Vhy7n3JZ3peC8ZI";
const ALLOWED_GIDS = new Set(["0", "961518640", "84848529", "541305122", "1937583700", "722712650"]);

// ---- findCol: bản sao src/lib/csv.ts, giữ đồng bộ ----
function findCol(header: string[], keys: string[]): number {
  const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
  const h = header.map(norm);
  for (const kw of keys) {
    const k = norm(kw);
    let idx = h.findIndex((x) => x === k);
    if (idx >= 0) return idx;
    idx = h.findIndex((x) => x.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

type Scope = "stop" | "route";
type FieldKey = "loaiHinh" | "toi" | "roi" | "load" | "ncc" | "bks";
const FIELDS: Record<FieldKey, { keys: string[]; scope: Scope }> = {
  loaiHinh: { keys: ["loai hinh"], scope: "stop" },
  toi: { keys: ["toi diem", "gio toi", "gio den"], scope: "stop" },
  roi: { keys: ["roi diem", "gio roi", "gio di"], scope: "stop" },
  load: { keys: ["tai trong", "trong tai"], scope: "route" },
  ncc: { keys: ["ncc"], scope: "route" },
  bks: { keys: ["bks", "bien so"], scope: "route" },
};
const LOAI_HINH_VALUES = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];

const g = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? (row[idx] || "").trim() : "");

/** Dò dòng header trong 10 dòng đầu — dòng đầu tiên khớp được >=3 cột đã biết. */
function findHeaderRow(grid: string[][]): number {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const H = grid[i] || [];
    let hit = 0;
    for (const f of Object.values(FIELDS)) if (findCol(H, f.keys) >= 0) hit++;
    if (findCol(H, ["ten tuyen", "ma tuyen"]) >= 0) hit++;
    if (hit >= 3) return i;
  }
  return 0; // mặc định dòng đầu, giống fallback ở sheet.ts
}

/** Làm sạch biển số — GIỐNG HỆT cleanBks() trong src/lib/sheet.ts, để so sánh oldValue đúng chuỗi hiển thị. */
function cleanBksDisplay(s: string): string {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}
/** Chuyển giá trị hiển thị -> dạng lưu gốc trong Sheet (luôn có đúng 1 tiền tố "_" chống tự định dạng). */
function toSheetBks(displayValue: string): string {
  return "_" + displayValue.replace(/^_+/, "").trim();
}

/** Chặn ký tự mở đầu công thức Sheets (=+-@) — chống command/formula injection khi ghi USER_ENTERED. */
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
}

async function handleSave(body: SaveBody, env: any): Promise<Response> {
  const { gid, route, scope, field } = body;
  if (!gid || !ALLOWED_GIDS.has(gid)) return json({ error: "gid_not_allowed" }, 400);
  if (!route || !route.trim()) return json({ error: "route_unnamed" }, 400);
  if (!FIELDS[field]) return json({ error: "field_not_allowed" }, 400);
  if (FIELDS[field].scope !== scope) return json({ error: "bad_request" }, 400);
  if (scope === "stop" && !body.match) return json({ error: "bad_request" }, 400);

  const valid = validateField(field, body.value);
  if (!valid.ok) return json({ error: valid.error }, 400);

  let title: string;
  try {
    title = await sheetTitle(env, SHEET_ID, gid);
  } catch (e: any) {
    return json({ error: "google_error", gstatus: String(e?.message || e) }, 502);
  }

  let grid: string[][];
  try {
    grid = await readGrid(env, SHEET_ID, title);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Unable to parse range")) await invalidateTitleCache(env, SHEET_ID);
    return json({ error: "google_error", gstatus: msg }, 502);
  }

  const h = findHeaderRow(grid);
  const H = grid[h] || [];
  const cols = {
    // KHÔNG dùng "tuyen" trơ trọi: tab "Nội Thành HCM" có cột "Loại tuyến" khớp nhầm trước khi
    // rơi về fallback cột 0 (xem ghi chú đầy đủ ở src/lib/sheet.ts, phát hiện 2026-08-04) — PHẢI
    // đồng bộ với sheet.ts vì client gửi route.route (đã tính từ sheet.ts) để server tìm dòng khớp.
    route: (() => { const c = findCol(H, ["ten tuyen", "ma tuyen"]); return c >= 0 ? c : 0; })(),
    kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
    loaiHinh: findCol(H, FIELDS.loaiHinh.keys),
    toi: findCol(H, FIELDS.toi.keys),
    roi: findCol(H, FIELDS.roi.keys),
    id: findCol(H, ["id"]),
    field: findCol(H, FIELDS[field].keys),
  };
  if (cols.field < 0) return json({ error: "field_not_allowed" }, 400);

  // Tìm mọi dòng khớp route (+ match nếu scope=stop; nếu scope=route thì lấy mọi dòng của tuyến).
  const targets: number[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    if (g(row, cols.route) !== route) continue;
    if (scope === "stop") {
      const m = body.match!;
      if (g(row, cols.kho) !== (m.kho || "")) continue;
      if (g(row, cols.loaiHinh) !== (m.loaiHinh || "")) continue;
      if (g(row, cols.toi) !== (m.toi || "")) continue;
      if (g(row, cols.roi) !== (m.roi || "")) continue;
      if (g(row, cols.id) !== (m.id || "")) continue;
      targets.push(i);
    } else {
      // scope route: chỉ nhắm dòng đang có giá trị (khớp "first non-empty" mà sheet.ts đọc lên hiển thị).
      const cur = field === "bks" ? cleanBksDisplay(g(row, cols.field)) : g(row, cols.field);
      if (cur !== "") targets.push(i);
    }
  }
  if (scope === "route" && targets.length === 0) {
    // Toàn bộ đang rỗng -> ghi dòng đầu tiên của tuyến.
    for (let i = h + 1; i < grid.length; i++) {
      if (g(grid[i] || [], cols.route) === route) { targets.push(i); break; }
    }
  }
  if (targets.length === 0) return json({ error: "row_not_found" }, 404);

  const curValues = targets.map((i) => {
    const raw = g(grid[i], cols.field);
    return field === "bks" ? cleanBksDisplay(raw) : raw;
  });
  const distinct = [...new Set(curValues)];
  const oldValue = (body.oldValue || "").trim();

  if (!body.force) {
    if (distinct.length > 1) return json({ error: "inconsistent", values: distinct }, 409);
    if (distinct[0] !== oldValue) return json({ error: "conflict", current: distinct[0] }, 409);
  }
  if (distinct.length === 1 && distinct[0] === valid.value) return json({ ok: true, updated: 0, cells: [], value: valid.value });

  const writeValue = field === "bks" ? toSheetBks(valid.value) : valid.value;
  const cells = targets.map((i) => ({ a1: a1(title, i + 1, cols.field + 1), value: writeValue }));

  try {
    await writeCells(env, SHEET_ID, cells);
  } catch (e: any) {
    return json({ error: "google_error", gstatus: String(e?.message || e) }, 502);
  }

  // Nhật ký thao tác — sheet vận hành thật, cần trả lời được "ai vừa đổi giờ này".
  if (env?.QA_KV) {
    try {
      const email = (body as any)._email || "";
      const key = "ltedit:log:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
      await env.QA_KV.put(key, JSON.stringify({
        at: Date.now(), email, gid, route, scope, field,
        from: distinct[0] ?? "", to: valid.value,
      }), { expirationTtl: 60 * 60 * 24 * 90 }); // giữ 90 ngày
    } catch { /* không chặn phản hồi nếu ghi log lỗi */ }
  }

  return json({ ok: true, updated: cells.length, cells: cells.map((c) => c.a1), value: valid.value });
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));

  if (body?.action === "selftest") {
    if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);
    const r = await gsheetsSelftest(env, SHEET_ID);
    return json({ ok: true, ...r });
  }

  if (body?.action !== "save") return json({ error: "bad_request" }, 400);
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);

  try {
    return await handleSave(body as SaveBody, env);
  } catch (e: any) {
    return json({ error: "google_error", gstatus: String(e?.message || e) }, 502);
  }
};
