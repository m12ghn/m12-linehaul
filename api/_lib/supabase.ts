/* ============================================================
   Kết nối Supabase từ Vercel Edge/Node Function.
   CỐ Ý KHÔNG dùng gói @supabase/supabase-js: chỉ cần vài lời gọi REST đơn giản,
   fetch thẳng vào PostgREST -> bundle nhẹ, chạy được cả Edge runtime, không thêm
   phụ thuộc (giữ đúng tinh thần dự án cũ: functions/api/_gsheets.ts cũng fetch tay).

   Biến môi trường (Vercel → Settings → Environment Variables):
     SUPABASE_URL               https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY  khoá service_role (BÍ MẬT — chỉ dùng server-side)
   ============================================================ */

const URL_ = () => must("SUPABASE_URL");
const KEY_ = () => must("SUPABASE_SERVICE_ROLE_KEY");

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

function headers(actor?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    apikey: KEY_(),
    authorization: "Bearer " + KEY_(),
    "content-type": "application/json",
    ...extra,
  };
  // PostgREST chuyển các claim trong header này thành GUC -> trigger m12_audit() đọc được
  // current_setting('m12.actor'). Không có thì audit_log vẫn ghi nhưng actor = null.
  if (actor) h["x-actor"] = actor;
  return h;
}

async function call(path: string, init: RequestInit, actor?: string): Promise<any> {
  const r = await fetch(URL_() + "/rest/v1/" + path, {
    ...init,
    headers: { ...headers(actor), ...(init.headers as any) },
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

/** Gọi function SQL (rpc). Dùng cho bump_visits() và các thao tác nhiều bước. */
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
