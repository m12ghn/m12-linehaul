/* ============================================================
   BẢO TRÌ BẢO DƯỠNG (BTBD) — 07/09/2026: thay cho trang trống (03/09/2026).
   Gộp module BTBD (trước là app tách biệt riêng, xem src/lib/btbd.ts đầu
   file đó để biết đầy đủ bối cảnh) thẳng vào dashboard M12, đọc Google Sheet
   trực tiếp — không có backend/DB riêng.

   MVP đợt 1 (Sếp chốt qua AskUserQuestion, xem src/lib/btbd.ts): 5 tab con —
   Tổng quan, Danh sách xe, Hạn giấy tờ, Lịch bảo dưỡng, Nhật ký sửa chữa.
   Đăng nhập DÙNG CHUNG với dashboard M12 (Sếp chốt) — trang này đã nằm sau
   EmailGate ở App.tsx như mọi trang khác, không cần thêm gate riêng.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import {
  loadBtbd,
  computeStats,
  computeAlerts,
  computeDocuments,
  computeSchedule,
  type BtbdData,
  type DocStatus,
  type ScheduleStatus,
} from "../lib/btbd";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";
import { normSearch } from "../lib/normalize";

type Sub = "tong-quan" | "xe" | "giay-to" | "lich-bd" | "nhat-ky";
const SUBS: { key: Sub; label: string }[] = [
  { key: "tong-quan", label: "📊 Tổng quan" },
  { key: "xe", label: "🚚 Danh sách xe" },
  { key: "giay-to", label: "📄 Hạn giấy tờ" },
  { key: "lich-bd", label: "🔧 Lịch bảo dưỡng" },
  { key: "nhat-ky", label: "📝 Nhật ký sửa chữa" },
];

let cache: BtbdData | null = null;

const fmtInt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));
const fmtVnd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN") + " đ");

const DOC_STATUS_LABEL: Record<DocStatus, string> = { expired: "Đã hết hạn", soon: "Sắp hết hạn", ok: "Còn hạn" };
const DOC_STATUS_CLASS: Record<DocStatus, string> = { expired: "warn", soon: "due", ok: "" };
const SCH_STATUS_LABEL: Record<ScheduleStatus, string> = { overdue: "Quá hạn ODO", due: "Đến kỳ BD", upcoming: "Sắp tới kỳ", ok: "Ổn định" };
const SCH_STATUS_CLASS: Record<ScheduleStatus, string> = { overdue: "warn", due: "due", upcoming: "soon", ok: "" };

export function Btbd() {
  const [data, setData] = useState<BtbdData | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>("tong-quan");

  useEffect(() => {
    let alive = true;
    const run = (force = false) => {
      setRefreshing(true);
      loadBtbd(undefined, force)
        .then((d) => {
          if (!alive) return;
          cache = d;
          setData(d);
          setErr(null);
        })
        .catch((e) => { if (alive) setErr(String(e?.message || e)); })
        .finally(() => { if (alive) { setLoading(false); setRefreshing(false); } });
    };
    run();
    const stop = startPoll(() => run(), REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  return (
    <div className="page">
      <div className="section-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <div>
            <h2 style={{ margin: 0 }}>🔧 Bảo Trì Bảo Dưỡng</h2>
            <p className="lead" style={{ margin: "4px 0 0" }}>
              Đọc trực tiếp từ Google Sheet đội xe — dữ liệu tự làm mới mỗi {Math.round(REFRESH_MS / 1000)}s.
              {refreshing && !loading && <span style={{ marginLeft: 8, color: "var(--muted)" }}>⏳ đang làm mới…</span>}
            </p>
          </div>
          <button className="re-btn" onClick={() => loadBtbd(undefined, true).then((d) => { cache = d; setData(d); })} disabled={refreshing}>
            🔄 Làm mới
          </button>
        </div>
      </div>

      <div className="sub-tabs" style={{ marginTop: 14 }}>
        {SUBS.map((t) => (
          <button key={t.key} className={sub === t.key ? "active" : ""} onClick={() => setSub(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="state"><div className="spinner" /><div className="big">Đang tải dữ liệu BTBD…</div></div>
      ) : err && !data ? (
        <div className="state">
          <div className="big">Không tải được dữ liệu</div>
          <div><code>{err}</code></div>
        </div>
      ) : !data ? null : sub === "tong-quan" ? (
        <TongQuan data={data} />
      ) : sub === "xe" ? (
        <DanhSachXe data={data} />
      ) : sub === "giay-to" ? (
        <HanGiayTo data={data} />
      ) : sub === "lich-bd" ? (
        <LichBaoDuong data={data} />
      ) : (
        <NhatKySuaChua data={data} />
      )}
    </div>
  );
}

function TongQuan({ data }: { data: BtbdData }) {
  const stats = useMemo(() => computeStats(data), [data]);
  const alerts = useMemo(() => computeAlerts(data, 10), [data]);
  return (
    <>
      <div className="kpi-row" style={{ marginTop: 16 }}>
        <div className="kpi"><div className="lbl">Tổng số xe</div><div className="val">{fmtInt(stats.totalVehicles)}</div><div className="note">{fmtInt(stats.activeVehicles)} đang hoạt động</div></div>
        <div className="kpi ink"><div className="lbl">Lượt BD/SC</div><div className="val">{fmtInt(stats.totalRecords)}</div><div className="note">Tổng chi phí {fmtVnd(stats.totalCost)}</div></div>
        <div className="kpi green"><div className="lbl">Tỷ lệ đúng định mức</div><div className="val">{stats.complianceRate}%</div><div className="note">Theo các lượt đã kiểm tra</div></div>
        <div className="kpi"><div className="lbl">Xe đến kỳ BD</div><div className="val orange">{fmtInt(stats.dueForMaintenance)}</div><div className="note">{fmtInt(stats.expiringDocuments)} xe sắp/đã hết hạn giấy tờ</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }} className="btbd-2col">
        <div className="section-card">
          <h2 style={{ fontSize: 15 }}>🔧 Xe gần đến kỳ bảo dưỡng nhất</h2>
          {alerts.maintenanceDue.length === 0 ? <p className="lead">Không có dữ liệu.</p> : (
            <div className="tc-wrap scroll-frame" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="tc-grid">
                <thead><tr><th>Biển số</th><th>Đơn vị</th><th>ODO hiện tại</th><th>Còn lại (km)</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {alerts.maintenanceDue.map((r) => (
                    <tr key={r.plateNumber}>
                      <td><b>{r.plateNumber}</b></td>
                      <td>{r.managerUnit || "—"}</td>
                      <td>{fmtInt(r.currentOdo)}</td>
                      <td>{fmtInt(r.remainingOdo)}</td>
                      <td><span className={"btbd-pill" + ((r.remainingOdo ?? 0) < 0 ? " warn" : "")}>{r.alertStatus || "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="section-card">
          <h2 style={{ fontSize: 15 }}>📄 Giấy tờ sắp/đã hết hạn</h2>
          {alerts.documentExpiring.length === 0 ? <p className="lead">Không có dữ liệu.</p> : (
            <div className="tc-wrap scroll-frame" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="tc-grid">
                <thead><tr><th>Biển số</th><th>Loại giấy tờ</th><th>Hạn</th><th>Còn (ngày)</th></tr></thead>
                <tbody>
                  {alerts.documentExpiring.map((r, i) => (
                    <tr key={r.plateNumber + r.docType + i}>
                      <td><b>{r.plateNumber}</b></td>
                      <td>{r.docType}</td>
                      <td>{r.expiryRaw}</td>
                      <td><span className={"btbd-pill" + ((r.daysRemaining ?? 0) < 0 ? " warn" : "")}>{r.daysRemaining != null ? r.daysRemaining : "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {(stats.costByArea.length > 0 || stats.costByGarage.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }} className="btbd-2col">
          <div className="section-card">
            <h2 style={{ fontSize: 15 }}>Chi phí theo khu vực</h2>
            <table className="tc-grid">
              <thead><tr><th>Khu vực</th><th>Số lượt</th><th>Tổng chi phí</th></tr></thead>
              <tbody>{stats.costByArea.map((r) => (<tr key={r.label}><td>{r.label}</td><td>{fmtInt(r.count)}</td><td>{fmtVnd(r.totalCost)}</td></tr>))}</tbody>
            </table>
          </div>
          <div className="section-card">
            <h2 style={{ fontSize: 15 }}>Chi phí theo gara</h2>
            <table className="tc-grid">
              <thead><tr><th>Gara</th><th>Số lượt</th><th>Tổng chi phí</th></tr></thead>
              <tbody>{stats.costByGarage.map((r) => (<tr key={r.label}><td>{r.label}</td><td>{fmtInt(r.count)}</td><td>{fmtVnd(r.totalCost)}</td></tr>))}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function DanhSachXe({ data }: { data: BtbdData }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const statuses = useMemo(() => [...new Set(data.vehicles.map((v) => v.status).filter(Boolean))].sort(), [data]);
  const nq = normSearch(q);
  const rows = useMemo(
    () => data.vehicles.filter((v) => (!status || v.status === status) && (!nq || normSearch(v.plateNumber).includes(nq))),
    [data, nq, status]
  );
  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search-box" style={{ maxWidth: 320 }}>
          <input placeholder="Tìm biển số…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="re-btn" style={{ cursor: "pointer" }}>
          <option value="">Tất cả trạng thái</option>
          {statuses.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <span className="lead" style={{ alignSelf: "center" }}>{rows.length} / {data.vehicles.length} xe</span>
      </div>
      <div className="tc-wrap scroll-frame" style={{ maxHeight: 640, overflow: "auto" }}>
        <table className="tc-grid">
          <thead><tr><th>Biển số</th><th>Trạng thái</th><th>Tải trọng</th><th>Hãng/Model</th><th>Đơn vị quản lý</th><th>Đội xe</th><th>Năm SX</th><th>ODO</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.plateNumber}>
                <td><b>{v.plateNumber}</b></td>
                <td>{v.status || "—"}</td>
                <td>{v.loadCapacity || "—"}</td>
                <td>{[v.brand, v.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                <td>{v.managerUnit || "—"}</td>
                <td>{v.fleetTeam || "—"}</td>
                <td>{v.manufactureYear ?? "—"}</td>
                <td>{fmtInt(v.odo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HanGiayTo({ data }: { data: BtbdData }) {
  const rows = useMemo(() => computeDocuments(data.vehicles), [data]);
  const [q, setQ] = useState("");
  const [onlyAlert, setOnlyAlert] = useState(false);
  const nq = normSearch(q);
  const filtered = useMemo(
    () => rows.filter((r) => (!nq || normSearch(r.plateNumber).includes(nq)) && (!onlyAlert || r.docStatus !== "ok")),
    [rows, nq, onlyAlert]
  );
  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search-box" style={{ maxWidth: 320 }}>
          <input placeholder="Tìm biển số…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={"re-btn" + (onlyAlert ? " active" : "")} onClick={() => setOnlyAlert((v) => !v)}>
          {onlyAlert ? "✓ " : ""}Chỉ hiện sắp/đã hết hạn
        </button>
        <span className="lead" style={{ alignSelf: "center" }}>{filtered.length} / {rows.length} dòng</span>
      </div>
      <div className="tc-wrap scroll-frame" style={{ maxHeight: 640, overflow: "auto" }}>
        <table className="tc-grid">
          <thead><tr><th>Biển số</th><th>Đơn vị</th><th>Loại giấy tờ</th><th>Hạn</th><th>Còn (ngày)</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.plateNumber + r.docType + i}>
                <td><b>{r.plateNumber}</b></td>
                <td>{r.managerUnit || "—"}</td>
                <td>{r.docType}</td>
                <td>{r.expiryRaw}</td>
                <td>{r.daysRemaining ?? "—"}</td>
                <td><span className={"btbd-pill" + (DOC_STATUS_CLASS[r.docStatus] ? " " + DOC_STATUS_CLASS[r.docStatus] : "")}>{DOC_STATUS_LABEL[r.docStatus]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LichBaoDuong({ data }: { data: BtbdData }) {
  const rows = useMemo(() => computeSchedule(data.statuses), [data]);
  const [q, setQ] = useState("");
  const nq = normSearch(q);
  const filtered = useMemo(() => rows.filter((r) => !nq || normSearch(r.plateNumber).includes(nq)), [rows, nq]);
  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search-box" style={{ maxWidth: 320 }}>
          <input placeholder="Tìm biển số…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="lead" style={{ alignSelf: "center" }}>{filtered.length} / {rows.length} xe</span>
      </div>
      <div className="tc-wrap scroll-frame" style={{ maxHeight: 640, overflow: "auto" }}>
        <table className="tc-grid">
          <thead><tr><th>Biển số</th><th>Đơn vị</th><th>ODO hiện tại</th><th>ODO kỳ tới</th><th>Còn lại (km)</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.plateNumber}>
                <td><b>{r.plateNumber}</b></td>
                <td>{r.managerUnit || "—"}</td>
                <td>{fmtInt(r.currentOdo)}</td>
                <td>{fmtInt(r.nextMaintenanceOdo)}</td>
                <td>{fmtInt(r.remainingOdo)}</td>
                <td><span className={"btbd-pill" + (SCH_STATUS_CLASS[r.scheduleStatus] ? " " + SCH_STATUS_CLASS[r.scheduleStatus] : "")}>{SCH_STATUS_LABEL[r.scheduleStatus]}</span></td>
                <td>{r.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Nhật ký có thể lên tới chục nghìn dòng (repo cũ ghi nhận ~14.500 dòng) — bắt buộc lọc trước khi
// hiện để tránh render cả bảng khổng lồ trong trình duyệt (KHÔNG cắt bớt dữ liệu đã tải, chỉ giới
// hạn số dòng HIỂN THỊ khi chưa lọc gì).
const NHAT_KY_DEFAULT_LIMIT = 300;

function NhatKySuaChua({ data }: { data: BtbdData }) {
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [week, setWeek] = useState("");
  const areas = useMemo(() => [...new Set(data.records.map((r) => r.area).filter(Boolean))].sort(), [data]);
  const weeks = useMemo(() => [...new Set(data.records.map((r) => r.week).filter(Boolean))].sort(), [data]);
  const nq = normSearch(q);
  const filtered = useMemo(
    () =>
      data.records
        .filter((r) => (!nq || normSearch(r.plateNumber).includes(nq)) && (!area || r.area === area) && (!week || r.week === week))
        // Chưa tự tin parse được entryDate thành Date thật (xem cảnh báo đầu btbd.ts) nên KHÔNG sort
        // theo ngày — giữ nguyên thứ tự Sheet rồi đảo ngược (dòng mới nhất thường nằm cuối Sheet).
        .slice()
        .reverse(),
    [data, nq, area, week]
  );
  const hasFilter = !!(q || area || week);
  const shown = hasFilter ? filtered : filtered.slice(0, NHAT_KY_DEFAULT_LIMIT);

  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search-box" style={{ maxWidth: 260 }}>
          <input placeholder="Tìm biển số…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={area} onChange={(e) => setArea(e.target.value)} className="re-btn" style={{ cursor: "pointer" }}>
          <option value="">Tất cả khu vực</option>
          {areas.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
        <select value={week} onChange={(e) => setWeek(e.target.value)} className="re-btn" style={{ cursor: "pointer" }}>
          <option value="">Tất cả tuần</option>
          {weeks.map((w) => (<option key={w} value={w}>{w}</option>))}
        </select>
        <span className="lead" style={{ alignSelf: "center" }}>
          {hasFilter ? `${shown.length} / ${filtered.length} dòng khớp` : `Đang hiện ${shown.length} dòng mới nhất / ${filtered.length} tổng — lọc để xem hết`}
        </span>
      </div>
      <div className="tc-wrap scroll-frame" style={{ maxHeight: 640, overflow: "auto" }}>
        <table className="tc-grid">
          <thead>
            <tr>
              <th>Biển số</th><th>Ngày vào</th><th>Loại việc</th><th>Hạng mục</th><th>Chi tiết</th>
              <th>Gara</th><th>Ngày ra</th><th>Chi phí</th><th>Khu vực</th><th>Tuần</th><th>Kiểm tra định mức</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.plateNumber + r.entryDate + i}>
                <td><b>{r.plateNumber}</b></td>
                <td>{r.entryDate || "—"}</td>
                <td>{r.workType || "—"}</td>
                <td>{r.maintenanceCategory || "—"}</td>
                <td>{r.detail || "—"}</td>
                <td>{r.garage || "—"}</td>
                <td>{r.exitDate || "—"}</td>
                <td>{fmtVnd(r.cost)}</td>
                <td>{r.area || "—"}</td>
                <td>{r.week || "—"}</td>
                <td>{r.complianceCheck || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
