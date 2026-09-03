/* ============================================================
   Kết nối Supabase từ Vercel Edge/Node Function.
   CỐ Ý KHÔNG dùng gói @supabase/supabase-js: chỉ cần vài lời gọi REST đơn giản,
   fetch thẳng vào PostgREST -> bundle nhẹ, chạy được cả Edge runtime, không thêm
   phụ thuộc (giữ đúng tinh thần dự án cũ: functions/api/_gsheets.ts cũng fetch tay).

   Biến môi trường (Vercel → Settings → Environment Variables):
     SUPABASE_URL               https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY  khoá service_role (BÍ MẬT — chỉ dùng server-side)
     SUPABASE_SCHEMA            schema chứa dữ liệu M12 (mặc định "m12")

   ⚠ DÙNG CHUNG PROJECT SUPABASE: toàn bộ bảng nằm trong schema riêng `m12`,
   không phải `public`. PostgREST chọn schema qua header:
       Accept-Profile   cho GET/HEAD
       Content-Profile  cho POST/PATCH/PUT/DELETE
   Thiếu 2 header này thì mọi request rơi về `public` và trả 404 (hoặc tệ hơn:
   đụng nhầm bảng trùng tên của hệ thống khác). Xử lý tập trung ở headers() bên dưới.
   Nhớ thêm `m12` vào Settings → API → Exposed schemas trên Supabase Studio.
   ============================================================ */

const URL_ = () => must("SUPABASE_URL");
const KEY_ = () => must("SUPABASE_SERVICE_ROLE_KEY");
const SCHEMA = () => (globalThis as any).process?.env?.SUPABASE_SCHEMA || "m12";

function must(name: string): string {
  const v = (globalThis as any).process?.env?.[name];
  if (!v) throw new Error("missing_env:" + name);
  return String(v);
}

export interface QueryOpts {
  /** Cột trả về, cú pháp PostgREST: "id,code,stops(*)" */
  select?: string;
  /** Bộ lọc thô: { region_key: "eq.noi-thanh-hcm", ngay: "gte.2026-08-01" } */
  filter?: Record<string, string>;
  order?: string;
  limit?: number;
  /** Email người thao tác -> vào audit_log qua biến phiên m12.actor. */
  actor?: string;
}

function headers(method: string, actor?: string, extra: Record<string, string> = {}): Record<string, string> {
  const schema = SCHEMA();
  const reading = method === "GET" || method === "HEAD";
  const h: Record<string, string> = {
    apikey: KEY_(),
    authorization: "Bearer " + KEY_(),
    "content-type": "application/json",
    // Chọn schema. GET dùng Accept-Profile, các lệnh ghi dùng Content-Profile —
    // PostgREST phân biệt 2 header này, gửi nhầm là không có tác dụng.
    ...(reading ? { "accept-profile": schema } : { "content-profile": schema }),
    ...extra,
  };
  // PostgREST chuyển các claim trong header này thành GUC -> trigger m12_audit() đọc được
  // current_setting('m12.actor'). Không có thì audit_log vẫn ghi nhưng actor = null.
  if (actor) h["x-actor"] = actor;
  return h;
}

async function call(path: string, init: RequestInit, actor?: string): Promise<any> {
  const method = (init.method || "GET").toUpperCase();
  const r = await fetch(URL_() + "/rest/v1/" + path, {
    ...init,
    headers: { ...headers(method, actor), ...(init.headers as any) },
  });
  const txt = await r.text();
  if (!r.ok) throw new SupabaseError(r.status, txt);
  return txt ? JSON.parse(txt) : null;
}

export class SupabaseError extends Error {
  constructor(public status: number, public body: string) {
    super("supabase_" + status + ":" + body.slice(0, 300));
  }
}

function qs(o: QueryOpts): string {
  const p = new URLSearchParams();
  if (o.select) p.set("select", o.select);
  for (const [k, v] of Object.entries(o.filter || {})) p.append(k, v);
  if (o.order) p.set("order", o.order);
  if (o.limit) p.set("limit", String(o.limit));
  const s = p.toString();
  return s ? "?" + s : "";
}

export function select<T = any>(table: string, o: QueryOpts = {}): Promise<T[]> {
  return call(table + qs(o), { method: "GET" }, o.actor);
}

/** Trang mỗi lượt phân trang của selectAll(). PostgREST/Supabase mặc định cắt ở
 *  1000 dòng/lời gọi dù không xin limit — selectAll() phải tự phân trang qua
 *  header Range, không thì bảng/view nhiều hơn 1000 dòng sẽ mất dữ liệu âm thầm
 *  (không báo lỗi, chỉ trả về đúng 1000 dòng đầu). */
const TRANG_SELECT_ALL = 1000;

/** Như select(), nhưng tự phân trang cho tới hết — dùng khi số dòng có thể vượt
 *  ngưỡng mặc định của PostgREST (bảng/view lớn, đọc theo khoảng ngày dài).
 *  o.limit bị bỏ qua nếu có (phân trang tự lo hết, không giới hạn tổng). */
export async function selectAll<T = any>(table: string, o: QueryOpts = {}): Promise<T[]> {
  const out: T[] = [];
  const base = table + qs({ ...o, limit: undefined });
  for (let from = 0; ; from += TRANG_SELECT_ALL) {
    const to = from + TRANG_SELECT_ALL - 1;
    const r = await fetch(URL_() + "/rest/v1/" + base, {
      headers: {
        ...headers("GET", o.actor),
        Range: `${from}-${to}`,
        "Range-Unit": "items",
      },
    });
    const txt = await r.text();
    // 200 = trọn trang cuối cùng vừa đủ hết dữ liệu; 206 = còn trang sau. Dùng
    // content-range để biết CHẮC đã hết hay chưa, không đoán qua độ dài trang.
    if (!r.ok && r.status !== 206) throw new SupabaseError(r.status, txt);
    const trang: T[] = txt ? JSON.parse(txt) : [];
    out.push(...trang);
    const cr = r.headers.get("content-range"); // dạng "0-999/2647" hoặc "0-999/*"
    const tong = cr?.split("/")[1];
    const daDuTong = tong && tong !== "*" ? out.length >= Number(tong) : trang.length < TRANG_SELECT_ALL;
    if (daDuTong || trang.length === 0) break;
  }
  return out;
}

export async function one<T = any>(table: string, o: QueryOpts = {}): Promise<T | null> {
  const rows = await select<T>(table, { ...o, limit: 1 });
  return rows[0] ?? null;
}

export function insert<T = any>(table: string, rows: any | any[], actor?: string): Promise<T[]> {
  return call(table, {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "return=representation" },
  }, actor);
}

export function upsert<T = any>(table: string, rows: any | any[], onConflict: string, actor?: string): Promise<T[]> {
  return call(table + "?on_conflict=" + encodeURIComponent(onConflict), {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
  }, actor);
}

export function update<T = any>(table: string, filter: Record<string, string>, patch: any, actor?: string): Promise<T[]> {
  return call(table + qs({ filter }), {
    method: "PATCH",
    body: JSON.stringify(patch),
    headers: { prefer: "return=representation" },
  }, actor);
}

export function remove(table: string, filter: Record<string, string>, actor?: string): Promise<any> {
  return call(table + qs({ filter }), { method: "DELETE" }, actor);
}

/** Gọi function SQL (rpc). Dùng cho bump_visits() và các thao tác nhiều bước.
 *  Hàm cũng nằm trong schema m12 -> Content-Profile do headers() gắn sẵn. */
export function rpc<T = any>(fn: string, args: any = {}, actor?: string): Promise<T> {
  return call("rpc/" + fn, { method: "POST", body: JSON.stringify(args) }, actor);
}

/** Phản hồi JSON chuẩn — giữ đúng kiểu Response mà code cũ đang dùng. */
export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
