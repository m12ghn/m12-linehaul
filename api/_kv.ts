/* ============================================================
   Helper dùng chung cho các Vercel Edge Function port từ functions/api/*
   (Cloudflare KV) — cầu nối kv_store trong Supabase, xem supabase/PHA3-PLAN.md.
   File tiền tố "_" -> Vercel KHÔNG coi là route (giống quy ước "_" của
   Cloudflare Pages Functions trong functions/api/_admin.ts, _session.ts).
   ============================================================ */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// process do Vercel Edge Runtime cấp lúc chạy; khai báo tối thiểu để khỏi cần @types/node
// (cùng cách vite.config.ts đang làm — dự án này không cài @types/node).
declare const process: { env: Record<string, string | undefined> };

let client: SupabaseClient | null | undefined;

/** service_role key — CHỈ dùng phía server (Edge Function), KHÔNG BAO GIỜ lộ ra client. */
export function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Đọc 1 "key" trong bảng kv_store — thay env.QA_KV.get(key) + JSON.parse. */
export async function kvGet<T>(key: string): Promise<T | null> {
  const supa = db();
  if (!supa) return null;
  const { data } = await supa.from("kv_store").select("value").eq("key", key).maybeSingle();
  return data ? ((data as { value: T }).value ?? null) : null;
}

/** Ghi 1 "key" trong bảng kv_store — thay env.QA_KV.put(key, JSON.stringify(v)). */
export async function kvSet(key: string, value: unknown): Promise<void> {
  const supa = db();
  if (!supa) return;
  await supa.from("kv_store").upsert({ key, value, updated_at: new Date().toISOString() });
}
