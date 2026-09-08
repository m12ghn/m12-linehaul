/* ============================================================
   XUẤT NGƯỢC RA GOOGLE SHEET (bấm tay trên dashboard).
   POST /api/export-sheet { region, sheetId?, tab? }   -> cần quyền lich-tai:export
   Logic dựng bảng & ghi Sheet nằm ở api/_lib/exportSheet.ts (dùng chung với cron).
   ============================================================ */
import { json } from "./_lib/supabase";
import { guard } from "./_lib/session";
import { exportRegion } from "./_lib/exportSheet";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const g = await guard(req, "lich-tai", "export");
  if ("deny" in g) return g.deny;

  try {
    const b: any = await req.json().catch(() => ({}));
    const region = String(b?.region || "");
    if (!region) return json({ error: "bad_request" }, 400);

    const env = (globalThis as any).process?.env || {};
    const sheetId = String(b?.sheetId || env.EXPORT_SHEET_ID || "");
    if (!sheetId) return json({ error: "no_sheet_id" }, 400);

    const tab = String(b?.tab || region);
    const rows = await exportRegion(region, sheetId, tab, g.actor.email);
    return json({ ok: true, rows, tab });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "not_configured") return json({ error: "not_configured" }, 500);
    if (msg.startsWith("clear_failed") || msg.startsWith("write_failed") || msg.startsWith("token_")) {
      return json({ error: "google_error", detail: msg.slice(0, 200) }, 502);
    }
    return json({ error: "server_error", detail: msg }, 500);
  }
}
