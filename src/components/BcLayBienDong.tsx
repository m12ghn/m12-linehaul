import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  loadBcLay,
  computeProfiles,
  monthsOf,
  buildMonthMeta,
  clusterByMonth,
  bcByMonth,
  countByLoc,
  dowLabel,
  type BcLayData,
  type BcProfile,
  type DayPoint,
  type MonthMeta,
} from "../lib/bcLayBienDong";

/* Palette 20 màu phân biệt (tab20 của matplotlib) — không thêm dependency. */
const PALETTE = [
  "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd",
  "#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf",
  "#aec7e8","#ffbb78","#98df8a","#ff9896","#c5b0d5",
  "#c49c94","#f7b6d2","#c7c7c7","#dbdb8d","#9edae5",
];

type Metric = "vol" | "kg";
type Scope = "all" | "weekday";

const fmt = (n: number) => (n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("vi-VN"));
const fmtDdMm = (day: number, monthKey: string) => `${String(day).padStart(2,"0")}/${monthKey.slice(5)}`;

/* Cache trong session để chuyển tab đi/về không phải chờ tải lại. */
const CACHE: { data: BcLayData | null } = { data: null };

export function BcLayBienDong() {
  const [data, setData] = useState<BcLayData>(CACHE.data || { rows: [], lastSync: 0 });
  const [loading, setLoading] = useState(!CACHE.data);
  const [err, setErr] = useState("");
  const [metric, setMetric] = useState<Metric>("vol");
  const [scope, setScope] = useState<Scope>("all");
  const [focusWid, setFocusWid] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ html: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    loadBcLay(ctrl.signal)
      .then((d) => {
        if (!alive) return;
        if (d.rows.length) CACHE.data = d;
        setData(d);
        setLoading(false);
        if (!d.rows.length) setErr("Chưa tải được dữ liệu BC Lấy — thử lại sau ít phút.");
      })
      .catch((e) => {
        if (!alive) return;
        setLoading(false);
        setErr("Lỗi tải dữ liệu: " + (e instanceof Error ? e.message : String(e)));
      });
    return () => { alive = false; ctrl.abort(); };
  }, []);

  const rows = data.rows;
  const months = useMemo(() => monthsOf(rows), [rows]);
  const monthsMeta = useMemo(() => months.map(buildMonthMeta), [months]);
  const profiles = useMemo(() => computeProfiles(rows), [rows]);
  const top20 = useMemo(() => profiles.slice(0, 20), [profiles]);
  const locCount = useMemo(() => countByLoc(rows), [rows]);

  const clusterData = useMemo(
    () => monthsMeta.map((m) => ({ meta: m, points: clusterByMonth(rows, m.key) })),
    [monthsMeta, rows]
  );

  /* Top 20: mỗi BC × mỗi tháng — chuẩn hoá 0-100% max riêng của BC đó, để so PATTERN
     biến động (không so quy mô tuyệt đối vì BC to sẽ "che" line BC nhỏ).
     byMonth key = monthKey (VD "2026-04") để chart con lấy trực tiếp không cần index. */
  const top20Data = useMemo(() => {
    return top20.map((p, i) => {
      const byMonth: Record<string, DayPoint[]> = {};
      for (const m of monthsMeta) byMonth[m.key] = bcByMonth(rows, p.wid, m.key);
      return { profile: p, color: PALETTE[i], byMonth };
    });
  }, [top20, monthsMeta, rows]);

  if (loading) {
    return (
      <div className="section-card">
        <div className="sl-empty">Đang tải dữ liệu biến động BC Lấy…</div>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="section-card">
        <div className="sl-empty">{err || "Chưa có dữ liệu."}</div>
      </div>
    );
  }

  const dateFrom = rows.reduce((a, r) => (r.dt < a ? r.dt : a), rows[0].dt);
  const dateTo = rows.reduce((a, r) => (r.dt > a ? r.dt : a), rows[0].dt);

  return (
    <div className="bd-wrap" onMouseLeave={() => setTooltip(null)}>
      {/* HEADER */}
      <div className="section-card sl-dash-head">
        <div className="sl-dash-title">
          <h2>📈 Biến động sản lượng LẤY hàng theo BC</h2>
          <span className="sl-sync">
            {fmt(rows.length)} dòng · {dateFrom} → {dateTo} · cập nhật {new Date(data.lastSync).toLocaleTimeString("vi-VN")}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Đã lọc <b>{Object.values(locCount).reduce((a,b)=>a+b,0)} BC</b> thuộc{" "}
          <b>HCM ({locCount["HCM"]}) + Thủ Đức ({locCount["Thủ Đức"]}) + Thuận An ({locCount["Thuận An"]}) + Dĩ An ({locCount["Dĩ An"]})</b>.
          Top 20 BC biến động cao lọc từ <b>{profiles.length} BC lõi</b> (n≥40 ngày T2-T6 &amp; median ≥50 đơn/ngày).
        </div>
        <div className="sl-controls">
          <div className="sl-seg">
            <button className={metric === "vol" ? "on" : ""} onClick={() => setMetric("vol")}>Số đơn</button>
            <button className={metric === "kg" ? "on" : ""} onClick={() => setMetric("kg")}>Khối lượng (kg)</button>
          </div>
          <div className="sl-seg">
            <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Tất cả ngày</button>
            <button className={scope === "weekday" ? "on" : ""} onClick={() => setScope("weekday")}>Chỉ T2-T6 (ngày thường)</button>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          <b>Cách đọc:</b> Nền <span style={swatchStyle("var(--bd-sat)")} /> = T7 · <span style={swatchStyle("var(--bd-sun)")} /> = CN · <span style={swatchStyle("var(--bd-event)")} /> = ngày event.
          Line zigzag trong vùng TRẮNG (T2-T6) mới là <b>biến động thật</b>. Bấm <b>Chỉ T2-T6</b> để ẩn hết chu kỳ/event.
        </div>
      </div>

      {/* 1. Toàn cụm */}
      <h3 className="bd-sec-h">1. Toàn cụm 4 khu ({Object.values(locCount).reduce((a,b)=>a+b,0)} BC) <span className="bd-sec-sub">— tổng sản lượng theo ngày</span></h3>
      <div className="bd-grid">
        {clusterData.map(({ meta, points }) => (
          <ClusterChart
            key={meta.key}
            meta={meta}
            points={points}
            metric={metric}
            scope={scope}
            onHover={setTooltip}
          />
        ))}
      </div>

      {/* 2. Top 20 */}
      <h3 className="bd-sec-h">2. Top 20 BC biến động cao <span className="bd-sec-sub">— chuẩn hoá 0-100% max riêng mỗi BC để so PATTERN</span></h3>
      <div className="bd-legend">
        {top20.map((p, i) => {
          const active = focusWid === p.wid;
          return (
            <div
              key={p.wid}
              className={"bd-chip" + (active ? " on" : "")}
              onClick={() => setFocusWid(active ? null : p.wid)}
              title={p.wname}
            >
              <span className="bd-chip-sw" style={{ background: PALETTE[i] }} />
              <span className="bd-chip-nm"><b className="bd-chip-loc">[{p.loc}]</b> {shortBcName(p.wname)}</span>
              <span className="bd-chip-cv">CV đơn {(p.sV.cv*100).toFixed(0)}% · kg {(p.sK.cv*100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
      <div className="bd-grid">
        {monthsMeta.map((meta) => (
          <Top20Chart
            key={meta.key}
            meta={meta}
            top20Data={top20Data}
            metric={metric}
            scope={scope}
            focusWid={focusWid}
            onHover={setTooltip}
          />
        ))}
      </div>

      {tooltip && (
        <div
          className="bd-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
          dangerouslySetInnerHTML={{ __html: tooltip.html }}
        />
      )}

      {/* CSS scoped cho component này */}
      <style>{CSS_SCOPED}</style>
    </div>
  );
}

/* ============================================================
   Cluster chart — 1 tháng, 1 line tổng cụm.
   ============================================================ */
function ClusterChart({
  meta, points, metric, scope, onHover,
}: {
  meta: MonthMeta;
  points: DayPoint[];
  metric: Metric;
  scope: Scope;
  onHover: (t: { html: string; x: number; y: number } | null) => void;
}) {
  const filtered = scope === "all" ? points : points.filter((p) => p.bucket === "WEEKDAY");
  const days = scope === "all" ? Array.from({ length: meta.dim }, (_, i) => i + 1) : filtered.map((p) => p.day);
  const W = 640, H = 240, padL = 56, padR = 14, padT = 12, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const vals = filtered.map((p) => p[metric]);
  const maxV = Math.max(1, ...vals) * 1.1;
  const xFor = (day: number) => {
    if (scope === "all") return padL + ((day - 1) / Math.max(1, meta.dim - 1)) * innerW;
    const idx = days.indexOf(day);
    return padL + (idx / Math.max(1, days.length - 1)) * innerW;
  };
  const yFor = (v: number) => padT + (1 - v / maxV) * innerH;
  const halfSlot = scope === "all" ? innerW / Math.max(1, meta.dim - 1) / 2 : 0;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxV);
  const stepX = Math.max(1, Math.floor(days.length / 12));
  const path = filtered
    .map((p, i) => (i === 0 ? "M" : "L") + xFor(p.day) + "," + yFor(p[metric]))
    .join(" ");

  return (
    <div className="section-card bd-card">
      <div className="bd-card-h">Tháng {meta.label} · {metric === "vol" ? "Số đơn" : "Khối lượng (kg)"}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bd-chart">
        {/* Vùng nền T7/CN/EVENT (chỉ khi scope=all) */}
        {scope === "all" && meta.satDays.map((d) => (
          <rect key={"s"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-sat)" />
        ))}
        {scope === "all" && meta.sunDays.map((d) => (
          <rect key={"u"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-sun)" />
        ))}
        {scope === "all" && meta.evDays.map((d) => (
          <rect key={"e"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-event)" />
        ))}
        {/* Lưới Y */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={yFor(t)} x2={padL + innerW} y2={yFor(t)} stroke="var(--line)" />
            <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" className="bd-axis">{shortN(t)}</text>
          </g>
        ))}
        {/* Trục X */}
        {days.map((d, i) => {
          if (!(i % stepX === 0 || i === days.length - 1)) return null;
          return (
            <text key={d} x={xFor(d)} y={padT + innerH + 14} textAnchor="middle" className="bd-axis">{d}</text>
          );
        })}
        {/* Line + dot */}
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} />
        {filtered.map((p) => (
          <circle
            key={p.dt}
            cx={xFor(p.day)}
            cy={yFor(p[metric])}
            r={3}
            fill="var(--ink)"
            style={{ cursor: "crosshair" }}
            onMouseEnter={(e) => {
              const html = `<div><b>${dowLabel(p.dow)} ${fmtDdMm(p.day, meta.key)}</b> ${bucketBadge(p.bucket)}</div>
                <div>Số đơn: <b>${fmt(p.vol)}</b></div>
                <div>Khối lượng: <b>${fmt(p.kg)} kg</b></div>`;
              onHover({ html, x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </svg>
    </div>
  );
}

/* ============================================================
   Top20 chart — 1 tháng, 20 lines chuẩn hoá 0-100% max riêng mỗi BC.
   ============================================================ */
function Top20Chart({
  meta, top20Data, metric, scope, focusWid, onHover,
}: {
  meta: MonthMeta;
  top20Data: { profile: BcProfile; color: string; byMonth: Record<string, DayPoint[]> }[];
  metric: Metric;
  scope: Scope;
  focusWid: string | null;
  onHover: (t: { html: string; x: number; y: number } | null) => void;
}) {
  const normalized = top20Data.map((bc) => {
    const pts = bc.byMonth[meta.key] || [];
    const filtered = scope === "all" ? pts : pts.filter((p) => p.bucket === "WEEKDAY");
    const maxOwn = Math.max(1, ...filtered.map((p) => p[metric] || 0));
    return { bc, filtered, maxOwn };
  });

  const days = scope === "all" ? Array.from({ length: meta.dim }, (_, i) => i + 1) : (normalized[0]?.filtered.map((p) => p.day) || []);
  const W = 640, H = 260, padL = 44, padR = 14, padT = 12, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xFor = (day: number) => {
    if (scope === "all") return padL + ((day - 1) / Math.max(1, meta.dim - 1)) * innerW;
    const idx = days.indexOf(day);
    return padL + (idx / Math.max(1, days.length - 1)) * innerW;
  };
  const yFor = (norm: number) => padT + (1 - norm) * innerH;
  const halfSlot = scope === "all" ? innerW / Math.max(1, meta.dim - 1) / 2 : 0;

  const stepX = Math.max(1, Math.floor(days.length / 12));

  return (
    <div className="section-card bd-card">
      <div className="bd-card-h">Tháng {meta.label} · % max riêng mỗi BC ({metric === "vol" ? "đơn" : "kg"})</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="bd-chart"
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const scaleX = W / rect.width;
          const mx = (e.clientX - rect.left) * scaleX;
          // Tìm ngày gần cursor nhất
          let bestDay = days[0], bestDist = Infinity;
          for (const d of days) {
            const dist = Math.abs(xFor(d) - mx);
            if (dist < bestDist) { bestDist = dist; bestDay = d; }
          }
          // Lấy top 5 BC cao nhất hôm đó theo raw metric
          const rows = normalized
            .map(({ bc, filtered }) => {
              const p = filtered.find((x) => x.day === bestDay);
              return p ? { bc, v: p[metric], bucket: p.bucket, dow: p.dow } : null;
            })
            .filter(Boolean) as { bc: typeof normalized[0]["bc"]; v: number; bucket: string; dow: number }[];
          rows.sort((a, b) => b.v - a.v);
          if (!rows.length) { onHover(null); return; }
          const first = rows[0];
          const top5 = rows.slice(0, 5);
          const html = `<div><b>${dowLabel(first.dow)} ${fmtDdMm(bestDay, meta.key)}</b> ${bucketBadge(first.bucket as Parameters<typeof bucketBadge>[0])}</div>
            <div style="color:#94a3b8">Top 5 BC cao nhất (${metric === "vol" ? "đơn" : "kg"}):</div>
            ${top5.map(r => `<div>· <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.bc.color};margin-right:4px"></span>${shortBcName(r.bc.profile.wname).slice(0,30)}: <b>${fmt(r.v)}</b></div>`).join("")}`;
          onHover({ html, x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => onHover(null)}
      >
        {/* Nền T7/CN/EVENT */}
        {scope === "all" && meta.satDays.map((d) => (
          <rect key={"s"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-sat)" />
        ))}
        {scope === "all" && meta.sunDays.map((d) => (
          <rect key={"u"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-sun)" />
        ))}
        {scope === "all" && meta.evDays.map((d) => (
          <rect key={"e"+d} x={xFor(d) - halfSlot} y={padT} width={halfSlot * 2} height={innerH} fill="var(--bd-event)" />
        ))}
        {/* Lưới Y (0/50/100%) */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} y1={yFor(f)} x2={padL + innerW} y2={yFor(f)} stroke="var(--line)" />
            <text x={padL - 6} y={yFor(f) + 3} textAnchor="end" className="bd-axis">{Math.round(f * 100)}%</text>
          </g>
        ))}
        {/* Trục X */}
        {days.map((d, i) => {
          if (!(i % stepX === 0 || i === days.length - 1)) return null;
          return (
            <text key={d} x={xFor(d)} y={padT + innerH + 14} textAnchor="middle" className="bd-axis">{d}</text>
          );
        })}
        {/* Line cho mỗi BC */}
        {normalized.map(({ bc, filtered, maxOwn }) => {
          if (!filtered.length) return null;
          const dim = focusWid && focusWid !== bc.profile.wid;
          const highlight = focusWid === bc.profile.wid;
          const d = filtered
            .map((p, i) => (i === 0 ? "M" : "L") + xFor(p.day) + "," + yFor((p[metric] || 0) / maxOwn))
            .join(" ");
          return (
            <path
              key={bc.profile.wid}
              d={d}
              fill="none"
              stroke={bc.color}
              strokeWidth={highlight ? 2.5 : 1.5}
              opacity={highlight ? 1 : dim ? 0.08 : 0.4}
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ---- Helpers ---- */

function shortBcName(name: string): string {
  return name
    .replace(/^Bưu Cục /, "BC ")
    .replace(/^Bưu cục /, "BC ")
    .replace(/-HCM$/, "")
    .slice(0, 55);
}

function shortN(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

function bucketBadge(b: "WEEKDAY" | "SAT" | "SUN" | "EVENT"): string {
  if (b === "EVENT") return `<b style="color:#f5a623">EVENT</b>`;
  if (b === "SUN") return `<b style="color:#6b7280">CN</b>`;
  if (b === "SAT") return `<b style="color:#9aa7b4">T7</b>`;
  return "";
}

function swatchStyle(bg: string): CSSProperties {
  return {
    display: "inline-block",
    width: 14,
    height: 10,
    borderRadius: 2,
    background: bg,
    border: "1px solid var(--line)",
    verticalAlign: "middle",
    margin: "0 2px",
  };
}

/* ---- CSS scoped ---- */
const CSS_SCOPED = `
.bd-wrap { position: relative; --bd-sat: rgba(148, 163, 184, 0.20); --bd-sun: rgba(100, 116, 139, 0.32); --bd-event: rgba(245, 166, 35, 0.20); }
.bd-sec-h { font-size: 16px; font-weight: 800; color: var(--ink); margin: 18px 0 8px; }
.bd-sec-sub { font-weight: 500; color: var(--muted); font-size: 13px; }
.bd-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 1000px) { .bd-grid { grid-template-columns: 1fr 1fr; } }
.bd-card { padding: 12px 14px; }
.bd-card-h { font-weight: 700; font-size: 13.5px; color: var(--ink-2); margin-bottom: 4px; }
.bd-chart { width: 100%; height: auto; display: block; }
.bd-chart text { font-variant-numeric: tabular-nums; }
.bd-axis { fill: var(--muted); font-size: 10px; }
.bd-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 8px; margin: 4px 0 12px; font-size: 12px; }
.bd-chip { display: flex; align-items: center; gap: 6px; background: var(--white); border: 1px solid var(--line-2); border-radius: 6px; padding: 4px 8px; cursor: pointer; transition: background .1s; }
.bd-chip:hover { background: var(--bg); }
.bd-chip.on { border-color: var(--ink); background: var(--bg); }
.bd-chip-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.bd-chip-nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bd-chip-loc { color: var(--muted); font-weight: 600; }
.bd-chip-cv { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.bd-tooltip { position: fixed; pointer-events: none; background: rgba(30, 42, 55, 0.96); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.55; z-index: 1000; max-width: 280px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-variant-numeric: tabular-nums; }
`;
