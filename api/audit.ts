/* ============================================================
   LỊCH SỬ SỬA (audit) — ĐỌC, cho nút "(i)" trên Lịch Tải (thêm 03/09/2026).

   Hạ tầng ghi đã có sẵn từ trước (0002_app.sql): trigger m12.m12_audit() trên
   bảng routes/stops tự ghi MỌI insert/update/delete vào audit_log kèm actor +
   thời điểm — endpoint này CHỈ đọc lại, không cần đổi schema/migration gì.

   GET /api/audit?table=routes&row_id=<uuid>
   GET /api/audit?table=stops&row_id=<uuid>
     -> { ok, created: {at, actor}|null, lastUpdate: {at, actor}|null }
     created     = dòng audit_log action='insert' CŨ NHẤT của row_id đó (lúc tạo).
     lastUpdate  = dòng audit_log action='update' MỚI NHẤT (null nếu chưa từng sửa
                   sau khi tạo).

   Tải THEO YÊU CẦU (1 route/stop mỗi lần bấm "(i)"), không tải sẵn hàng loạt —
   cùng cách làm với fetchDiemDungChuyen() ở src/lib/tlld.ts (khối lượng audit_log
   toàn vùng có thể rất lớn, không cần thiết phải tải hết).
   ============================================================ */
import { select, json, SupabaseError } from "./_lib/supabase";
import { guard } from "./_lib/session";

const MODULE = "lich-tai";
// Chỉ 2 bảng đang có nút "(i)" trên Lịch Tải — allowlist để chặn dò bảng khác qua query string.
const ALLOWED_TABLES = new Set(["routes", "stops"]);

interface AuditRow {
  at: string;
  actor: string | null;
}

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const g = await guard(req, MODULE, "view");
    if ("deny" in g) return g.deny;

    const url = new URL(req.url);
    const table = url.searchParams.get("table") || "";
    const rowId = url.searchParams.get("row_id") || "";
    if (!ALLOWED_TABLES.has(table) || !rowId) return json({ error: "bad_request" }, 400);

    const [createdRows, updatedRows] = await Promise.all([
      select<AuditRow>("audit_log", {
        select: "at,actor",
        filter: { table_name: "eq." + table, row_id: "eq." + rowId, action: "eq.insert" },
        order: "at.asc",
        limit: 1,
      }),
      select<AuditRow>("audit_log", {
        select: "at,actor",
        filter: { table_name: "eq." + table, row_id: "eq." + rowId, action: "eq.update" },
        order: "at.desc",
        limit: 1,
      }),
    ]);

    return json({
      ok: true,
      created: createdRows[0] ? { at: createdRows[0].at, actor: createdRows[0].actor } : null,
      lastUpdate: updatedRows[0] ? { at: updatedRows[0].at, actor: updatedRows[0].actor } : null,
    });
  } catch (e: any) {
    if (e instanceof SupabaseError) return json({ error: "db_error", detail: e.body.slice(0, 200) }, 502);
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
