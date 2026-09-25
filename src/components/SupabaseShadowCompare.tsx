import { useState } from "react";
import { compareRegion, type CompareReport } from "../lib/compareSheetSupabase";
import { supabaseConfigured } from "../lib/supabaseClient";

/**
 * Panel debug PHA 1 — CHỈ HIỆN khi: build có cờ VITE_SUPABASE_SHADOW_COMPARE=1
 * VÀ user đang xem là admin. Dùng để đối chiếu dữ liệu Sheet vs Supabase trước
 * khi cutover (xem supabase/README.md) — KHÔNG ảnh hưởng luồng đọc dữ liệu
 * bình thường của Dash, chỉ đọc thêm từ Supabase khi bấm nút "So sánh ngay".
 */
export function SupabaseShadowCompare({ gid, regionKey, isAdmin }: { gid: string; regionKey: string; isAdmin?: boolean }) {
  const enabled = import.meta.env.VITE_SUPABASE_SHADOW_COMPARE === "1";
  const [report, setReport] = useState<CompareReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!enabled || !isAdmin) return null;

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      setReport(await compareRegion(gid, regionKey));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section-card" style={{ marginTop: 10, fontSize: 13 }}>
      <b>🧪 Pha 1 — Đối chiếu Sheet vs Supabase ({regionKey})</b>{" "}
      <button className="pl-calc" style={{ marginLeft: 8 }} onClick={run} disabled={loading || !supabaseConfigured}>
        {loading ? "Đang so sánh…" : "So sánh ngay"}
      </button>
      {!supabaseConfigured && (
        <div style={{ color: "#b45309", marginTop: 6 }}>Chưa cấu hình VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY trong .env.</div>
      )}
      {err && <div style={{ color: "crimson", marginTop: 6 }}>Lỗi: {err}</div>}
      {report && (
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          <div>
            Sheet: <b>{report.sheetRouteCount}</b> tuyến · Supabase: <b>{report.dbRouteCount}</b> tuyến
          </div>
          {report.sheetOnlyRoutes.length > 0 && (
            <div>⚠ Chỉ có ở Sheet ({report.sheetOnlyRoutes.length}): {report.sheetOnlyRoutes.slice(0, 10).join(", ")}</div>
          )}
          {report.dbOnlyRoutes.length > 0 && (
            <div>⚠ Chỉ có ở Supabase ({report.dbOnlyRoutes.length}): {report.dbOnlyRoutes.slice(0, 10).join(", ")}</div>
          )}
          {report.diffs.length > 0 ? (
            <div>
              ⚠ {report.diffs.length} lệch giá trị — vd:{" "}
              {report.diffs.slice(0, 5).map((d) => `${d.routeName}.${d.field}(${d.sheetValue}≠${d.dbValue})`).join("; ")}
            </div>
          ) : (
            <div style={{ color: "green" }}>✓ Không lệch trường nào ở các tuyến khớp tên.</div>
          )}
        </div>
      )}
    </div>
  );
}
