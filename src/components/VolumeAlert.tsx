/* ============================================================
   CẢNH BÁO SẢN LƯỢNG (realtime theo ngày): hàng ngày N (hôm nay) so với
   N-1 (hôm qua) và xu hướng N+1, N+2 — trợ lý phát cảnh báo + kiến nghị.
   Data: FC HCM20 + FC ST (ưu tiên thực tế, thiếu thì dùng forecast).
   Tự bám NGÀY HIỆN TẠI (cập nhật khi qua ngày mới) + làm mới dữ liệu định kỳ.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { loadFC, type FCRow } from "../lib/fc";
import { startPoll } from "../lib/poll";

const fmt = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
const dm = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const thuOf = (iso: string) => THU[new Date(iso + "T00:00:00").getDay()];

interface DayVol { iso: string; vol: number | null; wt: number | null; isAct: boolean }

export function VolumeAlert() {
  const [hcm, setHcm] = useState<FCRow[]>([]);
  const [st, setSt] = useState<FCRow[]>([]);
  const [today, setToday] = useState(() => isoOf(new Date()));

  // Tải FC + làm mới định kỳ; đồng thời bám ngày hiện tại (qua ngày mới -> đổi mốc N).
  useEffect(() => {
    let alive = true;
    const load = () => {
      loadFC("FC HCM20").then((d) => { if (alive) setHcm(d.rows); });
      loadFC("FC ST").then((d) => { if (alive) setSt(d.rows); });
    };
    load();
    const stop = startPoll(() => { if (!alive) return; setToday(isoOf(new Date())); load(); }, 5 * 60 * 1000);
    return () => { alive = false; stop(); };
  }, []);

  const model = useMemo(() => {
    const mh = new Map(hcm.map((r) => [r.date, r]));
    const ms = new Map(st.map((r) => [r.date, r]));
    const totalOf = (iso: string): DayVol => {
      const h = mh.get(iso), s = ms.get(iso);
      const hv = h ? (h.actVol ?? h.fcVol) : null;
      const sv = s ? (s.actVol ?? s.fcVol) : null;
      const hw = h ? (h.actW ?? h.fcW) : null;
      const sw = s ? (s.actW ?? s.fcW) : null;
      if (hv == null && sv == null && hw == null && sw == null) return { iso, vol: null, wt: null, isAct: false };
      return {
        iso,
        vol: hv == null && sv == null ? null : (hv ?? 0) + (sv ?? 0),
        wt: hw == null && sw == null ? null : (hw ?? 0) + (sw ?? 0),
        isAct: h?.actVol != null || s?.actVol != null,
      };
    };
    // Kho nào kéo thay đổi mạnh nhất giữa 2 ngày (cho kiến nghị). Chênh <15% giữa 2 kho ->
    // không đủ rõ để chỉ đích danh 1 kho, tránh khẳng định quá chắc khi cả 2 cùng nhúc nhích.
    const driver = (a: string, b: string): string => {
      const dh = ((mh.get(b)?.actVol ?? mh.get(b)?.fcVol ?? 0) - (mh.get(a)?.actVol ?? mh.get(a)?.fcVol ?? 0));
      const ds = ((ms.get(b)?.actVol ?? ms.get(b)?.fcVol ?? 0) - (ms.get(a)?.actVol ?? ms.get(a)?.fcVol ?? 0));
      const mx = Math.max(Math.abs(dh), Math.abs(ds));
      if (mx === 0 || Math.abs(Math.abs(dh) - Math.abs(ds)) / mx < 0.15) return "cả 2 kho";
      return Math.abs(dh) >= Math.abs(ds) ? "HCM20" : "Sóng Thần";
    };
    const N1 = totalOf(addDays(today, -1));
    const N = totalOf(today);
    const P1 = totalOf(addDays(today, 1));
    const P2 = totalOf(addDays(today, 2));
    // CÙNG THỨ tuần trước (N-7 cho hôm nay; N-6/N-5 cho ngày mai/ngày kia vì cũng lùi đúng 7 ngày
    // theo lịch của NGÀY ĐÓ) — dùng làm CĂN CỨ CHÍNH phát hiện bất thường, tránh nhầm chu kỳ tuần
    // (vd Thứ Hai luôn "tăng mạnh" so Chủ Nhật một cách đều đặn, không phải bất thường thật).
    const N_w = totalOf(addDays(today, -7));
    const P1_w = totalOf(addDays(today, -6));
    const P2_w = totalOf(addDays(today, -5));
    const chg = (cur: number | null, base: number | null) => (cur != null && base ? (cur / base - 1) : null);
    return {
      days: [N1, N, P1, P2],
      cN1: chg(N.vol, N1.vol),      // đơn: hôm nay vs hôm qua (bối cảnh, KHÔNG dùng để cảnh báo)
      cP1: chg(P1.vol, N.vol),      // đơn: ngày mai vs hôm nay (bối cảnh)
      cP2: chg(P2.vol, N.vol),      // đơn: ngày kia vs hôm nay (bối cảnh)
      wN1: chg(N.wt, N1.wt),        // kg: hôm nay vs hôm qua
      wP1: chg(P1.wt, N.wt),        // kg: ngày mai vs hôm nay
      wP2: chg(P2.wt, N.wt),        // kg: ngày kia vs hôm nay
      // So CÙNG THỨ tuần trước — CĂN CỨ chính để quyết định mức cảnh báo.
      cN_wow: chg(N.vol, N_w.vol),
      cP1_wow: chg(P1.vol, P1_w.vol),
      cP2_wow: chg(P2.vol, P2_w.vol),
      driverNext: driver(today, addDays(today, 1)),
      hasData: N.vol != null || P1.vol != null || N1.vol != null || N.wt != null,
    };
  }, [hcm, st, today]);

  // Sinh CẢNH BÁO + KIẾN NGHỊ (rule-based, đúng trọng tâm). Ngưỡng cảnh báo dựa trên so sánh
  // CÙNG THỨ tuần trước (wow); số so ngày liền kề chỉ nêu thêm làm bối cảnh, không quyết định mức.
  const alerts = useMemo(() => {
    const out: { lv: "hot" | "warn" | "ok" | "info"; txt: string; act: string }[] = [];
    const pc = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);
    const { cP1, cP2, cN_wow, cP1_wow, cP2_wow, wP1, driverNext } = model;
    const wTxt = wP1 != null ? ` · khối lượng ${pc(wP1)}` : "";
    const drTxt = driverNext === "cả 2 kho" ? " (cả 2 kho cùng tăng)" : ` (kho ${driverNext} kéo chính)`;
    // Ngày mai (N+1) — quan trọng nhất để hành động hôm nay. Dùng cP1_wow (so cùng thứ tuần
    // trước) làm căn cứ; nếu chưa có dữ liệu tuần trước thì rơi về so ngày liền kề (có ghi rõ).
    const p1Sig = cP1_wow ?? cP1;
    const p1Fallback = cP1_wow == null && cP1 != null;
    const p1Base = p1Fallback ? "so hôm nay (chưa có dữ liệu cùng thứ tuần trước)" : "so cùng thứ tuần trước";
    if (p1Sig != null) {
      if (p1Sig >= 0.15) out.push({ lv: "hot", txt: `🚨 NGÀY MAI hàng dự kiến TĂNG MẠNH ${pc(p1Sig)} ${p1Base}${wTxt}${drTxt}.`, act: `Chốt THÊM XE/NCC ngay hôm nay; book cố định theo cot, ưu tiên xe 5.000kg${driverNext !== "cả 2 kho" ? ` cho ${driverNext}` : ""}; giữ xe nhà GHN dự phòng.` });
      else if (p1Sig >= 0.05) out.push({ lv: "warn", txt: `⚠️ Ngày mai hàng nhỉnh hơn ${pc(p1Sig)} ${p1Base}${wTxt}.`, act: `Rà số xe ngày mai, chừa ~10–15% buffer phát sinh; nhắc NCC giữ chỗ.` });
      else if (p1Sig <= -0.15) out.push({ lv: "info", txt: `📉 Ngày mai hàng GIẢM ${pc(p1Sig)} ${p1Base}${wTxt}.`, act: `Có thể giảm xe thuê ngoài, dồn chuyến cho đầy tải, tiết kiệm chi phí.` });
      else out.push({ lv: "ok", txt: `✅ Ngày mai hàng ổn định (${pc(p1Sig)} ${p1Base}${wTxt}).`, act: `Giữ kế hoạch xe hiện tại, theo dõi forecast cập nhật.` });
    }
    // Ngày kia (N+2) — chuẩn bị sớm. Cũng so cùng thứ tuần trước, fallback ngày liền kề nếu thiếu.
    const p2Sig = cP2_wow ?? cP2;
    if (p2Sig != null && p2Sig >= 0.15) out.push({ lv: "warn", txt: `📈 Ngày kia (N+2) tiếp tục TĂNG ${pc(p2Sig)} so ${cP2_wow != null ? "cùng thứ tuần trước" : "hôm nay (chưa có dữ liệu cùng thứ tuần trước)"}.`, act: `Lên kế hoạch xe 2 ngày tới sớm, tránh book gấp giá cao.` });
    // Hôm nay vs cùng thứ tuần trước — bối cảnh thật (không lẫn chu kỳ tuần).
    if (cN_wow != null && Math.abs(cN_wow) >= 0.1) out.push({ lv: "info", txt: `ℹ️ Hôm nay hàng ${cN_wow >= 0 ? "tăng" : "giảm"} ${pc(cN_wow)} so cùng thứ tuần trước.`, act: cN_wow >= 0 ? `Theo dõi đáp ứng xe hôm nay, sẵn sàng tăng cường nếu vượt.` : `Tận dụng xe rảnh để dồn chuyến/bảo dưỡng nhẹ.` });
    return out;
  }, [model]);

  if (!model.hasData) {
    return (
      <div className="section-card">
        <div className="ov-sec-h">🔔 Cảnh báo sản lượng</div>
        <div className="sl-empty" style={{ padding: "18px 0" }}>Chưa có số liệu sản lượng quanh hôm nay ({dm(today)}). Cập nhật forecast trên Sheet là hiện ngay.</div>
      </div>
    );
  }

  const chgColor = (v: number | null) => (v == null ? "var(--muted)" : v >= 0.15 ? "var(--red)" : v >= 0.05 ? "var(--orange)" : v <= -0.15 ? "var(--blue)" : "var(--green)");
  const LABELS = ["Hôm qua", "Hôm nay", "Ngày mai", "Ngày kia"];

  return (
    <div className="section-card">
      <div className="ov-sec-h">🔔 Cảnh báo sản lượng</div>

      {/* Dải 4 ngày: N-1, N (hôm nay), N+1, N+2 — Sản lượng (đơn) + Khối lượng (kg) */}
      <div className="va-days">
        {model.days.map((d, i) => {
          const chgVs = i === 0 ? null : i === 1 ? model.cN1 : i === 2 ? model.cP1 : model.cP2;
          const chgW = i === 0 ? null : i === 1 ? model.wN1 : i === 2 ? model.wP1 : model.wP2;
          const arrow = (v: number) => (v >= 0 ? "▲" : "▼") + " " + Math.abs(Math.round(v * 100)) + "%";
          return (
            <div key={d.iso} className={"va-day" + (i === 1 ? " now" : "")}>
              <div className="va-lb">{LABELS[i]} · {thuOf(d.iso)} {dm(d.iso)}</div>
              <div className="va-vol">{fmt(d.vol)} <span className="va-u">đơn</span>
                {chgVs != null && <span className="va-chg" style={{ color: chgColor(chgVs) }}>{arrow(chgVs)}</span>}
              </div>
              <div className="va-wt">⚖️ {fmt(d.wt)} <span className="va-u">kg</span>
                {chgW != null && <span className="va-chg" style={{ color: chgColor(chgW) }}>{arrow(chgW)}</span>}
              </div>
              <div className="va-tag">{d.vol == null && d.wt == null ? "—" : d.isAct ? "thực tế" : "dự báo"}</div>
              {i === 1 && <div className="va-nowtag">● HÔM NAY</div>}
            </div>
          );
        })}
      </div>

      {/* Cảnh báo + kiến nghị từ trợ lý */}
      <div className="va-alerts">
        {alerts.map((a, i) => (
          <div key={i} className={"va-alert va-" + a.lv}>
            <div className="va-alert-t">{a.txt}</div>
            <div className="va-alert-a">🤖 <b>Nên làm:</b> {a.act}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
