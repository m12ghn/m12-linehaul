import { useEffect, useMemo, useState } from "react";
import {
  loadSanLuong,
  bucketize,
  distinct,
  buildDigest,
  type SlData,
  type Gran,
  type Metric,
} from "../lib/sanluong";
import { DailyAnalysis } from "./DailyAnalysis";
import { exportSanLuong } from "../lib/exportExcel";
import { isWeekendISO } from "../lib/normalize";

const LOAI_COLOR: Record<string, string> = {
  Normal: "#1668c7",
  Freight: "#f15a24",
  Bulky: "#1faa59",
};

// Bộ màu 3D cho cột: mặt trước / mặt trên (sáng) / mặt bên (tối).
type Face = { front: string; top: string; side: string };
const C3D: Record<"up" | "down" | "first" | "flat", Face> = {
  up: { front: "#1faa59", top: "#54c98a", side: "#157d42" },
  down: { front: "#e23b3b", top: "#ef6e6e", side: "#b02a2a" },
  first: { front: "#1668c7", top: "#4f93da", side: "#0f4d96" },
  flat: { front: "#9aa7b4", top: "#bcc6cf", side: "#76828f" },
};

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * mag;
}

const GRAN_LABEL: Record<Gran, string> = { day: "Ngày", week: "Tuần", month: "Tháng" };

// Nhớ dữ liệu đã tải trong phiên -> mở lại tab là hiện ngay, không phải chờ tải.
const SL_CACHE = new Map<string, SlData>();

export function SanLuongDash({ sheetName, title, tlld }: { sheetName: string; title: string; tlld?: string }) {
  const [data, setData] = useState<SlData>({ rows: [], lastSync: 0 });
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>("vol");
  const [gran, setGran] = useState<Gran>("week");
  const [warehouse, setWarehouse] = useState("");
  const [op, setOp] = useState("Xuất Kiện");
  // Bản tóm tắt toàn bộ số liệu để phân tích & làm ngữ cảnh chat.
  const digest = useMemo(() => (data.rows.length ? buildDigest(data, title, tlld) : ""), [data, title, tlld]);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const cached = SL_CACHE.get(sheetName);
    if (cached) {
      // Có sẵn -> hiện ngay, không chờ tải (làm mới ngầm bên dưới).
      setData(cached);
      setLoading(false);
    } else {
      setData({ rows: [], lastSync: 0 });
      setLoading(true);
    }
    loadSanLuong(sheetName, ctrl.signal)
      .then((d) => {
        if (!alive) return;
        if (d.rows.length) SL_CACHE.set(sheetName, d);
        if (d.rows.length || !cached) setData(d);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; ctrl.abort(); };
  }, [sheetName]);

  const warehouses = useMemo(() => distinct(data.rows, (r) => r.warehouse), [data.rows]);
  const ops = useMemo(() => distinct(data.rows, (r) => r.op), [data.rows]);
  const loais = useMemo(() => distinct(data.rows, (r) => r.loaiHang), [data.rows]);

  // Nếu phép mặc định không có trong data -> chọn phép đầu tiên.
  useEffect(() => {
    if (ops.length && !ops.includes(op)) setOp(ops[0]);
  }, [ops]); // eslint-disable-line

  const allBuckets = useMemo(
    () => bucketize(data.rows, metric, gran, warehouse, op),
    [data.rows, metric, gran, warehouse, op]
  );
  // Chỉ hiện kỳ gần nhất (tính luôn kỳ hiện tại): 7 ngày · 4 tuần · 4 tháng.
  const limit = gran === "day" ? 7 : 4;
  const buckets = allBuckets.slice(-limit);

  const unit = metric === "vol" ? "kiện" : "kg";
  const total = buckets.reduce((a, b) => a + b.total, 0);
  const avg = buckets.length ? total / buckets.length : 0;
  const last = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  const delta = last && prev && prev.total ? (last.total - prev.total) / prev.total : null;
  const maxB = buckets.reduce((m, b) => (b.total > (m?.total ?? -1) ? b : m), buckets[0]);
  const minB = buckets.reduce((m, b) => (b.total < (m?.total ?? Infinity) ? b : m), buckets[0]);

  // cơ cấu loại hàng trên toàn dải đang xem
  const loaiTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of buckets) for (const k in b.byLoai) m[k] = (m[k] || 0) + b.byLoai[k];
    return m;
  }, [buckets]);
  const loaiSum = Object.values(loaiTotals).reduce((a, b) => a + b, 0) || 1;

  // ----- kích thước biểu đồ -----
  const W = 900, H = 320, padL = 52, padR = 48, padT = 18, padB = 56;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const yMax = niceMax(Math.max(1, ...buckets.map((b) => b.total)));
  const n = buckets.length || 1;
  const slot = chartW / n;
  const barW = Math.min(88, Math.max(6, slot * 0.56));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const showVal = buckets.length <= 16;
  const yOf = (v: number) => padT + chartH - (v / yMax) * chartH;
  // Đổi key -> remount SVG -> cột mọc lại từ đáy mỗi khi đổi lựa chọn.
  const chartKey = `${sheetName}|${gran}|${metric}|${warehouse}|${op}`;

  return (
    <div>
      <div className="section-card sl-dash-head">
        <div className="sl-dash-title">
          <h2>📊 {title}</h2>
          <span className="sl-sync">
            {loading ? "Đang tải dữ liệu…" : data.rows.length
              ? `${fmt(data.rows.length)} dòng · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN")}`
              : "Chưa có dữ liệu"}
          </span>
        </div>

        <div className="sl-controls">
          <div className="sl-seg">
            <button className={metric === "vol" ? "on" : ""} onClick={() => setMetric("vol")}>Sản lượng (kiện)</button>
            <button className={metric === "kg" ? "on" : ""} onClick={() => setMetric("kg")}>Khối lượng (kg)</button>
          </div>
          <div className="sl-seg">
            {(["day", "week", "month"] as Gran[]).map((g) => (
              <button key={g} className={gran === g ? "on" : ""} onClick={() => setGran(g)}>{GRAN_LABEL[g]}</button>
            ))}
          </div>
          {warehouses.length > 1 && (
            <select className="pl-in sl-select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">Tất cả kho ({warehouses.length})</option>
              {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          )}
          <select className="pl-in sl-select" value={op} onChange={(e) => setOp(e.target.value)}>
            <option value="">Tất cả phép</option>
            {ops.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="sl-dash-grid">
        {/* TRÁI: biểu đồ cột (mọc lên từ đáy khi mở) */}
        <div className="sl-dash-main">
          <div className="section-card">
            <div className="sl-chart-h" style={{ justifyContent: "space-between" }}>
              <span>
                Biểu đồ {metric === "vol" ? "sản lượng" : "khối lượng"} · {buckets.length} {GRAN_LABEL[gran].toLowerCase()} gần nhất
                <span className="sl-legend">
                  <i style={{ background: "var(--green)" }} /> tăng
                  <i style={{ background: "var(--red)" }} /> giảm
                </span>
              </span>
              {buckets.length > 0 && (
                <button className="xlsx-btn" onClick={() => exportSanLuong(buckets, loais, { title: `${title}_${op || "tatca"}`, unit, gran: GRAN_LABEL[gran] })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  Excel
                </button>
              )}
            </div>
            {loading ? (
              <div className="sl-empty">Đang tải…</div>
            ) : buckets.length === 0 ? (
              <div className="sl-empty">Không có dữ liệu cho lựa chọn này.</div>
            ) : (
              <div className="sl-chart-scroll">
                <svg key={chartKey} className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
                  {/* lưới + nhãn trục Y */}
                  {ticks.map((t, i) => (
                    <g key={i}>
                      <line x1={padL} y1={yOf(t)} x2={W - padR} y2={yOf(t)} stroke="#eef1f5" />
                      <text x={padL - 8} y={yOf(t) + 4} textAnchor="end" className="sl-axis">{short(t)}</text>
                    </g>
                  ))}
                  {buckets.map((b, i) => {
                    const x = padL + i * slot + (slot - barW) / 2;
                    const y = yOf(b.total);
                    const h = Math.max(0, padT + chartH - y);
                    const p = i > 0 ? buckets[i - 1].total : null;
                    const state = p == null ? "first" : b.total > p ? "up" : b.total < p ? "down" : "flat";
                    const c = C3D[state];
                    const pctChg = p != null && p ? (((b.total - p) / p) * 100) : null;
                    const d = Math.max(5, Math.min(12, barW * 0.22)); // độ sâu 3D
                    const x2 = x + barW;
                    const we = gran === "day" && isWeekendISO(b.key); // T7/CN -> nhãn đỏ đậm
                    return (
                      <g key={b.key}>
                        {we && <rect x={padL + i * slot} y={padT} width={slot} height={chartH} rx={4} fill="rgba(22,104,199,0.15)" />}
                        <g className="sl-bar3d fx-rise" style={{ animationDelay: i * 0.09 + "s" }}>
                          {/* mặt bên (phải, tối) */}
                          <polygon points={`${x2},${y} ${x2 + d},${y - d} ${x2 + d},${y - d + h} ${x2},${y + h}`} fill={c.side} />
                          {/* mặt trên (sáng) */}
                          <polygon points={`${x},${y} ${x + d},${y - d} ${x2 + d},${y - d} ${x2},${y}`} fill={c.top} />
                          {/* mặt trước */}
                          <rect x={x} y={y} width={barW} height={h} fill={c.front} />
                          <title>{`${b.label}: ${fmt(b.total)} ${unit}${pctChg != null ? ` (${pctChg >= 0 ? "+" : ""}${pctChg.toFixed(1)}%)` : ""}`}</title>
                        </g>
                        {showVal && h > 0 && (
                          <text className="sl-barval" style={{ animationDelay: i * 0.09 + 0.45 + "s" }} x={x + barW / 2 + d / 2} y={y - d - 7} textAnchor="middle">{short(b.total)}</text>
                        )}
                        {pctChg != null && h > 0 && (
                          <text className="sl-bardelta" style={{ animationDelay: i * 0.09 + 0.45 + "s", fill: c.front }} x={x2 + d + 4} y={y - d + 13} textAnchor="start">
                            {pctChg >= 0 ? "▲" : "▼"}{Math.abs(pctChg).toFixed(0)}%
                          </text>
                        )}
                        <text x={x + barW / 2} y={H - padB + 18} textAnchor="middle" className="sl-xlb" style={we ? { fill: "#1356a8", fontWeight: 800 } : undefined}>{b.label}</text>
                      </g>
                    );
                  })}
                  <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="#cdd6e0" />
                </svg>
              </div>
            )}
          </div>

          {/* Cơ cấu loại hàng */}
          {buckets.length > 0 && (
            <div className="section-card" style={{ marginTop: 12 }}>
              <div className="sl-chart-h">Cơ cấu theo loại hàng ({GRAN_LABEL[gran].toLowerCase()} đang xem)</div>
              <div className="sl-loaibar">
                {loais.filter((l) => loaiTotals[l]).map((l) => {
                  const v = loaiTotals[l] || 0;
                  return (
                    <div className="sl-loaibar-seg" key={l} style={{ width: (v / loaiSum) * 100 + "%", background: LOAI_COLOR[l] || "#888" }}
                      title={`${l}: ${fmt(v)} ${unit} (${((v / loaiSum) * 100).toFixed(1)}%)`} />
                  );
                })}
              </div>
              <div className="sl-loaileg">
                {loais.filter((l) => loaiTotals[l]).map((l) => (
                  <span key={l}><i style={{ background: LOAI_COLOR[l] || "#888" }} />{l}: <b>{fmt(loaiTotals[l] || 0)}</b> {unit} ({((loaiTotals[l] / loaiSum) * 100).toFixed(0)}%)</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* PHẢI: tổng quan chỉ số */}
        <div className="sl-dash-side">
          <div className="sl-side-h">Tổng quan · {buckets.length} {GRAN_LABEL[gran].toLowerCase()}</div>
          <div className="sl-kpi">
            <span className="k-lb">Tổng cộng</span>
            <span className="k-v">{fmt(total)}</span><span className="k-u">{unit}</span>
          </div>
          <div className="sl-kpi">
            <span className="k-lb">TB mỗi {GRAN_LABEL[gran].toLowerCase()}</span>
            <span className="k-v">{fmt(avg)}</span><span className="k-u">{unit}</span>
          </div>
          <div className="sl-kpi sl-kpi-hl">
            <span className="k-lb">{GRAN_LABEL[gran]} mới nhất {last ? `(${last.label})` : ""}</span>
            <span className="k-v">{last ? fmt(last.total) : "—"}</span>
            {delta != null && (
              <span className={"k-delta " + (delta >= 0 ? "up" : "down")}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}% so với {GRAN_LABEL[gran].toLowerCase()} trước
              </span>
            )}
          </div>
          <div className="sl-kpi">
            <span className="k-lb">Cao / Thấp nhất</span>
            <span className="k-v sm">{maxB ? short(maxB.total) : "—"} <span className="k-sep">/</span> {minB ? short(minB.total) : "—"}</span>
            <span className="k-u">{maxB?.label} · {minB?.label}</span>
          </div>
        </div>
      </div>

      {/* Phân tích tự động hằng ngày + chat hỏi đáp số liệu */}
      <DailyAnalysis
        id={"sl-" + sheetName.replace(/\s+/g, "-")}
        digest={digest}
        title="🤖 Phân tích & cảnh báo từ Trợ lý"
        sub={`Trợ lý tự đọc toàn bộ số liệu ${title} (ngày · tuần · tháng, loại hàng, kho) + TLLD lúc 09:00 mỗi ngày → nhận định xu hướng, dự đoán lịch tải, cảnh báo kho.`}
      />
    </div>
  );
}
