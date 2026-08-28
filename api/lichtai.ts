/* ============================================================
   LỊCH TẢI — ĐỌC & GHI trên Supabase.  ĐÂY LÀ ENDPOINT "ĐẢO CHIỀU".
   Thay hoàn toàn functions/api/lichtai-edit.ts (ghi ngược vào Google Sheet).

   GET  /api/lichtai?region=noi-thanh-hcm
        -> { ok, region, routes:[{ id, route, load, category, ncc, bks, stops:[...] }], at }

   POST /api/lichtai   (JSON, cần đăng nhập; ghi cần quyền lich-tai:edit)
     { action:"route.create", region, route:{ code, category, load, ncc, bks, stops? } }
     { action:"route.update", id, patch:{ code?, category?, load?, ncc?, bks?, note? }, rev? }
     { action:"route.delete", id }
     { action:"stop.create",  routeId, stop:{ kho, loaiHinh, toi, roi, seq? } }
     { action:"stop.update",  id, patch:{ kho?, loaiHinh?, toi?, roi? }, rev? }
     { action:"stop.delete",  id }
     { action:"stop.reorder", routeId, ids:[stopId, ...] }

   KHÁC BIỆT LỚN so với bản Sheet cũ — và đây là lý do nên đổi:
     - Sửa theo KHOÁ CHÍNH (uuid), không phải dò "dấu vân tay nội dung" từng dòng.
       Không còn cảnh lệch dòng khi ai đó chèn/xoá dòng trên Sheet.
     - Chống ghi đè lẫn nhau bằng `rev` (updated_at của bản ghi client đang xem).
     - Thêm/xoá tuyến và điểm dừng — việc mà bản Sheet cũ KHÔNG làm được
       (chỉ sửa 6 cột có sẵn).
     - Mọi thay đổi tự vào audit_log kèm email người sửa (trigger m12_audit).
   ============================================================ */
import { select, insert, update, remove, json, SupabaseError } from "./_lib/supabase";
import { guard } from "./_lib/session";

const MODULE = "lich-tai";

// ---------- kiểm tra dữ liệu vào (giữ đúng luật của bản cũ) ----------
const TIME_RE = /^\d{1,2}:\d{2}$/;
const LOAI_HINH = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

/** Làm sạch biển số — GIỮ NGUYÊN cleanBks() của src/lib/sheet.ts. */
function cleanBks(s: string): string {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}

/** Chuẩn hoá giờ: "7:5" -> "07:05", "" giữ rỗng. Trả null nếu sai định dạng. */
function normTime(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return "";
  if (!TIME_RE.test(s)) return null;
  const [h, m] = s.split(":");
  const hh = Number(h), mm = Number(m);
  if (hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

class BadInput extends Error {
  /** `code` cho phép trả mã lỗi riêng (vd route_unnamed) thay vì invalid_value chung. */
  constructor(public field: string, public code = "invalid_value") { super(code); }
}

/** Ánh xạ tên trường từ client (camelCase) sang cột DB + kiểm tra giá trị. */
function routePatch(p: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if ("code" in p) {
    const v = String(p.code || "").trim();
    // Mã tuyến rỗng có mã lỗi RIÊNG -> người dùng thấy đúng câu "Tuyến chưa có tên",
    // không bị gộp vào lỗi "giá trị không hợp lệ" chung chung.
    if (!v) throw new BadInput("code", "route_unnamed");
    if (v.length > 80) throw new BadInput("code");
    out.code = v;
  }
  if ("category" in p) out.category = String(p.category || "").trim().slice(0, 80);
  if ("load" in p) {
    const v = String(p.load ?? "").trim();
    if (v !== "" && !/^\d{1,6}$/.test(v) && !/^van$/i.test(v)) throw new BadInput("load");
    out.load = v;
  }
  if ("ncc" in p) {
    const v = String(p.ncc || "").trim();
    if (v.length > 60) throw new BadInput("ncc");
    out.ncc = v;
  }
  if ("bks" in p) {
    const v = String(p.bks || "").trim();
    if (v.length > 20) throw new BadInput("bks");
    out.bks = cleanBks(v);
  }
  if ("driver" in p) out.driver = String(p.driver || "").trim().slice(0, 80);
  if ("driverPhone" in p) out.driver_phone = String(p.driverPhone || "").trim().slice(0, 30);
  if ("note" in p) out.note = String(p.note || "").slice(0, 500);
  if ("sort" in p) out.sort = Number(p.sort) || 0;
  if ("active" in p) out.active = !!p.active;
  return out;
}

function stopPatch(p: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if ("kho" in p) {
    const v = String(p.kho || "").trim();
    if (!v || v.length > 120) throw new BadInput("kho");
    out.kho = v;
  }
  if ("loaiHinh" in p) {
    const v = String(p.loaiHinh || "").trim();
    if (v) {
      const hit = LOAI_HINH.find((c) => norm(c) === norm(v));
      if (!hit) throw new BadInput("loaiHinh");
      out.loai_hinh = hit;
    } else out.loai_hinh = "";
  }
  for (const f of ["toi", "roi"] as const) {
    if (f in p) {
      const v = normTime(String(p[f] ?? ""));
      if (v === null) throw new BadInput(f);
      out[f] = v;
    }
  }
  if ("seq" in p) out.seq = Number(p.seq) || 0;
  if ("note" in p) out.note = String(p.note || "").slice(0, 300);
  return out;
}

/** Khoá lạc quan: bản ghi đã bị người khác sửa kể từ lúc client đọc? */
async function assertRev(table: string, id: string, rev?: string): Promise<void> {
  if (!rev) return;                                   // client không gửi -> bỏ qua kiểm tra
  const rows = await select<{ updated_at: string }>(table, {
    select: "updated_at", filter: { id: "eq." + id },
  });
  if (!rows.length) throw new Conflict("row_not_found", 404);
  if (new Date(rows[0].updated_at).getTime() !== new Date(rev).getTime()) {
    throw new Conflict("conflict", 409, rows[0].updated_at);
  }
}
class Conflict extends Error {
  constructor(public code: string, public status = 409, public current?: string) { super(code); }
}

// ---------- ĐỌC ----------
interface DbStop {
  id: string; seq: number; kho: string; loai_hinh: string | null;
  toi: string | null; roi: string | null; ext_id: string | null; updated_at: string;
}
interface DbRoute {
  id: string; code: string; category: string | null; load: string | null;
  ncc: string | null; bks: string | null; driver: string | null; driver_phone: string | null;
  sort: number; note: string | null; updated_at: string; stops: DbStop[];
}

async function readRegion(region: string): Promise<Response> {
  const rows = await select<DbRoute>("routes", {
    select: "id,code,category,load,ncc,bks,driver,driver_phone,sort,note,updated_at," +
            "stops(id,seq,kho,loai_hinh,toi,roi,ext_id,updated_at)",
    filter: { region_key: "eq." + region, active: "is.true" },
    order: "sort.asc,code.asc",
  });

  // Hình dạng trả về khớp HỆT type Route trong src/types.ts -> frontend cũ không phải đổi.
  const routes = rows.map((r) => ({
    id: r.id,
    route: r.code,
    load: r.load || "",
    category: r.category || "",
    ncc: r.ncc || "",
    bks: r.bks || "",
    driver: r.driver || "",
    driverPhone: r.driver_phone || "",
    note: r.note || "",
    rev: r.updated_at,
    stops: (r.stops || [])
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        id: s.id,
        kho: s.kho,
        loaiHinh: s.loai_hinh || "",
        toi: s.toi || "",
        roi: s.roi || "",
        extId: s.ext_id || "",
        seq: s.seq,
        rev: s.updated_at,
      })),
  }));

  const categories = [...new Set(routes.map((r) => r.category).filter(Boolean))].sort();
  return json({ ok: true, region, routes, categories, at: Date.now() });
}

// ---------- GHI ----------
async function handleWrite(body: any, actorEmail: string): Promise<Response> {
  const action = String(body?.action || "");

  switch (action) {
    case "route.create": {
      const region = String(body.region || "").trim();
      if (!region) return json({ error: "bad_request" }, 400);
      const patch = routePatch(body.route || {});
      if (!patch.code) return json({ error: "route_unnamed" }, 400);
      const [row] = await insert<{ id: string }>("routes",
        { ...patch, region_key: region, created_by: actorEmail, updated_by: actorEmail }, actorEmail);
      // Điểm dừng gửi kèm lúc tạo (nếu có).
      const stops = Array.isArray(body.route?.stops) ? body.route.stops : [];
      if (stops.length) {
        await insert("stops", stops.map((s: any, i: number) =>
          ({ ...stopPatch(s), route_id: row.id, seq: i + 1 })), actorEmail);
      }
      return json({ ok: true, id: row.id });
    }

    case "route.update": {
      const id = String(body.id || "");
      if (!id) return json({ error: "bad_request" }, 400);
      await assertRev("routes", id, body.rev);
      const patch = routePatch(body.patch || {});
      if (!Object.keys(patch).length) return json({ ok: true, updated: 0 });
      const rows = await update<{ id: string; updated_at: string }>("routes",
        { id: "eq." + id }, { ...patch, updated_by: actorEmail }, actorEmail);
      if (!rows.length) return json({ error: "row_not_found" }, 404);
      return json({ ok: true, updated: rows.length, rev: rows[0].updated_at });
    }

    case "route.delete": {
      const id = String(body.id || "");
      if (!id) return json({ error: "bad_request" }, 400);
      // Xoá MỀM mặc định: giữ lịch sử, tuyến biến khỏi dashboard nhưng vẫn tra cứu được.
      // hard=true mới xoá hẳn (stops tự xoá theo nhờ ON DELETE CASCADE).
      if (body.hard) await remove("routes", { id: "eq." + id }, actorEmail);
      else await update("routes", { id: "eq." + id }, { active: false, updated_by: actorEmail }, actorEmail);
      return json({ ok: true });
    }

    case "stop.create": {
      const routeId = String(body.routeId || "");
      if (!routeId) return json({ error: "bad_request" }, 400);
      const patch = stopPatch(body.stop || {});
      if (!patch.kho) return json({ error: "invalid_value", field: "kho" }, 400);
      if (patch.seq == null) {
        const cur = await select<{ seq: number }>("stops", {
          select: "seq", filter: { route_id: "eq." + routeId }, order: "seq.desc", limit: 1,
        });
        patch.seq = (cur[0]?.seq ?? 0) + 1;
      }
      const [row] = await insert<{ id: string }>("stops", { ...patch, route_id: routeId }, actorEmail);
      return json({ ok: true, id: row.id });
    }

    case "stop.update": {
      const id = String(body.id || "");
      if (!id) return json({ error: "bad_request" }, 400);
      await assertRev("stops", id, body.rev);
      const patch = stopPatch(body.patch || {});
      if (!Object.keys(patch).length) return json({ ok: true, updated: 0 });
      const rows = await update<{ updated_at: string }>("stops", { id: "eq." + id }, patch, actorEmail);
      if (!rows.length) return json({ error: "row_not_found" }, 404);
      return json({ ok: true, updated: rows.length, rev: rows[0].updated_at });
    }

    case "stop.delete": {
      const id = String(body.id || "");
      if (!id) return json({ error: "bad_request" }, 400);
      await remove("stops", { id: "eq." + id }, actorEmail);
      return json({ ok: true });
    }

    case "stop.reorder": {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return json({ error: "bad_request" }, 400);
      // Cập nhật tuần tự: số lượng điểm dừng 1 tuyến rất nhỏ (<20), không cần tối ưu.
      for (let i = 0; i < ids.length; i++) {
        await update("stops", { id: "eq." + String(ids[i]) }, { seq: i + 1 }, actorEmail);
      }
      return json({ ok: true, updated: ids.length });
    }

    default:
      return json({ error: "bad_request" }, 400);
  }
}

// ---------- điểm vào ----------
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const g = await guard(req, MODULE, "view");
      if ("deny" in g) return g.deny;
      const region = new URL(req.url).searchParams.get("region") || "";
      if (!region) return json({ error: "bad_request" }, 400);
      return await readRegion(region);
    }

    if (req.method === "POST") {
      const g = await guard(req, MODULE, "edit");
      if ("deny" in g) return g.deny;
      const body = await req.json().catch(() => ({}));
      return await handleWrite(body, g.actor.email);
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e: any) {
    if (e instanceof BadInput) return json({ error: e.code, field: e.field }, 400);
    if (e instanceof Conflict) return json({ error: e.code, current: e.current }, e.status);
    if (e instanceof SupabaseError) {
      // 23505 = trùng khoá duy nhất -> tuyến trùng mã trong cùng vùng.
      if (e.body.includes("23505")) return json({ error: "duplicate_route" }, 409);
      return json({ error: "db_error", detail: e.body.slice(0, 200) }, 502);
    }
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
