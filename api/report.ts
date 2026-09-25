/* ============================================================
   Vercel Edge Function — Lưu/đọc BÁO CÁO đã chốt (vd Kế hoạch Plan Event).
   Port từ functions/api/report.ts (Cloudflare, KV "report:<key>") sang
   cầu nối kv_store — xem api/_kv.ts + supabase/PHA3-PLAN.md.
   - get: ai cũng đọc được (báo cáo public cho cả nhóm).
   - save: CHỈ admin (x-admin-token) — chỉ Sếp được soạn/cập nhật.
   POST { key, action:"get" } -> { text, at, by }
   POST { key, action:"save", text, user } -> { ok, at }
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";
import { isAdminReq } from "./_admin";

interface ReportRec { text: string; at: number; by: string }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const b: Record<string, unknown> = await req.json().catch(() => ({}));
  const key = String(b?.key || "").slice(0, 80).replace(/[^\w.\-:]/g, "");
  const action = String(b?.action || "get");
  if (!key) return json({ ok: false, error: "thiếu key" }, 400);
  const KK = "report:" + key;

  if (action === "get") {
    const d = await kvGet<ReportRec>(KK);
    return json({ ok: true, text: d?.text || "", at: d?.at || 0, by: d?.by || "" });
  }
  if (action === "save") {
    if (!isAdminReq(req)) return json({ ok: false, error: "unauthorized" }, 401);
    const by = String(b?.user || req.headers.get("x-user-email") || "");
    const rec: ReportRec = { text: String(b?.text || "").slice(0, 20000), at: Date.now(), by };
    await kvSet(KK, rec);
    return json({ ok: true, at: rec.at });
  }
  return json({ ok: false, error: "action lạ" }, 400);
}
