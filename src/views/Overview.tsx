import { useEffect, useMemo, useState } from "react";
import { useTlld } from "../lib/useTlld";
import { useExcludedSet, isExcluded } from "../lib/tlldExclude";
import { TOP_MENUS } from "../config";
import { navTo } from "../lib/nav";
import type { TopMenu } from "../types";
import { VolumeAlert } from "../components/VolumeAlert";
import { HoiNhanh } from "../components/HoiNhanh";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const fillColor = (v: number | null) =>
  v == null ? "var(--muted)" : v >= 0.85 ? "var(--green)" : v >= 0.6 ? "var(--orange)" : "var(--red)";
function ddmm(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
const DOW_VN = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];
const ddCol = (dd: number | null) => (dd == null ? "var(--muted)" : dd <= -5 ? "var(--red)" : dd >= 5 ? "var(--green)" : "var(--muted)");
/** Cộng ngày cho chuỗi ISO (yyyy-mm-dd) -> ISO mới. */
function addISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
const dmOf = (iso: string) => { const p = iso.split("-"); return `${+p[2]}/${+p[1]}`; }; // "7/7"
const dowOf = (iso: string) => (new Date(iso + "T00:00:00").getDay() + 6) % 7; // 0=T2 … 6=CN

/** 1 dòng so sánh: "kỳ trước → kỳ này" + mức tăng/giảm (% so kỳ trước). Dễ đọc cho giám đốc. */
function CmpLine({ ic, label, cur, prev, note }: { ic?: string; label: string; cur: number | null; prev: number | null; note?: string }) {
  const dd = cur != null && prev != null && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  return (
    <div className="ovf-cmp">
      <span className="ovf-cmp-l">{ic ? ic + " " : ""}{label}{note ? <span className="ovf-cmp-note"> ({note})</span> : null}</span>
      <span className="ovf-cmp-r">
        <span className="ovf-cmp-prev">{prev != null ? pct(prev) : "—"}</span>
        <span className="ovf-arrow">→</span>
        <b style={{ color: fillColor(cur) }}>{cur != null ? pct(cur) : "—"}</b>
        {dd != null && <span className="ovf-d" style={{ color: ddCol(dd) }}>{dd >= 0 ? "▲" : "▼"}{Math.abs(dd)}%</span>}
      </span>
    </div>
  );
}

// 7 lối tắt = 7 NHÓM chức năng, không phải 7 trạng thái. Trước đây 3 thẻ mượn
// màu success/warning/danger làm màu trang trí, nhìn như "Plan Event đang lỗi".
// Nay lấy theo dải chart, thẻ thứ 7 về xám "Khác" — brand không cho bịa màu mới.
const QUICK: { key: TopMenu; icon: string; desc: string; color: string }[] = [
  { key: "lich-tai", icon: "🚚", desc: "Lịch tải & lộ trình từng tuyến theo vùng", color: "var(--chart-1)" },
  { key: "tlld-tuyen", icon: "📈", desc: "Tỷ lệ lấp đầy xe từng tuyến + nhận định AI", color: "var(--chart-2)" },
  { key: "tang-cuong", icon: "🌆", desc: "TC Lấy/Giao · Phát sinh · TT-AM · NCC vùng HCM", color: "var(--chart-3)" },
  { key: "cong-xuat", icon: "🚪", desc: "Phân bổ cổng xuất theo ca", color: "var(--chart-4)" },
  { key: "san-luong", icon: "📦", desc: "Sản lượng kho theo ngày/tuần/tháng + AI", color: "var(--chart-5)" },
  { key: "plan-event", icon: "✈️", desc: "Kế hoạch tải cao điểm + dự trù xe phát sinh", color: "var(--chart-6)" },
  { key: "sap-lich-tai", icon: "🤖", desc: "Trợ lý sắp & ghép lịch tải thông minh", color: "var(--chart-other)" },
];

/**
 * Tổng Quan Cụm M12 — màn điều hành: sức khoẻ TLLD toàn cụm, cảnh báo nổi bật,
 * và lối tắt sang từng mục. Mở phát thấy ngay tình hình.
 */
// Câu chào tiếp thêm động lực — đổi NGẪU NHIÊN mỗi lần tải trang.
// Trộn động lực nghiêm túc + vài câu "có duyên" cho đỡ khô (xưng em, gọi Sếp).
const GREET_NOTES = [
  // — Động lực / điều hành —
  "Chuẩn bị tốt là một nửa thành công — em đã cập nhật số liệu mới nhất cho Sếp.",
  "Số liệu đã sẵn sàng, chúc Sếp những quyết định sắc bén hôm nay.",
  "Quản trị bằng dữ liệu, quyết định bằng bản lĩnh — chúc Sếp một ngày vững vàng.",
  "Tiến chậm cũng không sao, miễn là không dừng lại — M12 luôn tiến đều cùng Sếp.",
  "Đúng giờ, đủ tải, an toàn — chúc Sếp một ngày vận hành thật mượt.",
  "Một khởi đầu tích cực có thể thay đổi cả ngày — chúc Sếp ngày làm việc hiệu quả.",
  "Việc khó đã có số liệu lo, Sếp cứ tự tin dẫn dắt.",
  "Hôm nay là cơ hội mới để tối ưu từng tuyến, từng chuyến.",
  "Xuất sắc là một thói quen — chúc Sếp giữ phong độ điều hành hôm nay.",
  "Bình tĩnh nhìn số, tự tin ra quyết định — chúc Sếp một ngày suôn sẻ.",
  "Mỗi chuyến xe đầy tải, đúng giờ là một thành công nhỏ. Chúc Sếp ngày trọn vẹn.",
  "Cần phân tích sâu hay gợi ý ghép tải, Sếp cứ gọi em nhé.",
  "Dữ liệu không biết nói dối, nên Sếp cứ yên tâm tin vào con số hôm nay.",
  "Tối ưu 1% mỗi ngày, một năm là tốt hơn 37 lần — mình bắt đầu từ hôm nay nhé Sếp.",
  "Sóng to thì tay lái phải vững — cao điểm tới đâu, mình tính tới đó.",
  "Kế hoạch tốt giúp ngủ ngon; em lo phần số, Sếp lo phần quyết.",
  "Không có tuyến nào quá khó, chỉ có tuyến chưa được ghép khéo thôi ạ.",
  // — Có duyên / vui nhẹ —
  "Cà phê chưa kịp nguội mà số liệu đã nóng hổi chờ Sếp rồi đây ạ. ☕",
  "Xe đầy tải, lòng đầy năng lượng — chúc Sếp một ngày không kẹt xe (cả nghĩa đen lẫn nghĩa bóng). 🚚",
  "Em đã dậy sớm gom số cho Sếp rồi, giờ tới lượt Sếp toả sáng nha. ✨",
  "Hôm nay tuyến nào lười đầy tải, để em 'nhắc nhẹ' giúp Sếp. 😉",
  "Deadline có thể gấp, nhưng số liệu của mình thì luôn 'chuẩn cơm mẹ nấu'. 🍚",
  "Bưu cục xin xe ầm ầm? Bình tĩnh, có em làm 'tổng đài' lo liệu cho Sếp. 📞",
  "Chúc Sếp một ngày KPI xanh mướt như rau sạch. 🥬",
  "Mình không hứa hết kẹt xe, nhưng hứa mọi con số đều rõ ràng cho Sếp. 🙂",
  "Lấp đầy 85–95% là vừa đẹp — non quá phí xe, đầy quá nhức đầu, mình cứ 'vừa đủ yêu' thôi ạ.",
  "Sếp cứ ra trận, hậu cần số liệu để em giữ. 🛡️",
];

/** Lời chào ấm áp của Trợ lý theo buổi trong ngày (không gọi AI -> hiện ngay, miễn phí). */
function useGreeting(lowCount: number) {
  // Chọn 1 câu động lực ngẫu nhiên; bấm ↻ để đổi câu khác (không trùng câu cũ).
  const [noteIdx, setNoteIdx] = useState(() => Math.floor(Math.random() * GREET_NOTES.length));
  const shuffleNote = () => setNoteIdx((i) => {
    if (GREET_NOTES.length < 2) return i;
    let j = i; while (j === i) j = Math.floor(Math.random() * GREET_NOTES.length);
    return j;
  });
  const g = useMemo(() => {
    const now = new Date();
    const h = now.getHours();
    const buoi =
      h < 11 ? { hi: "Chào buổi sáng", ic: "🌅" }
      : h < 13 ? { hi: "Chào buổi trưa", ic: "☀️" }
      : h < 18 ? { hi: "Chào buổi chiều", ic: "🌤️" }
      : h < 22 ? { hi: "Chào buổi tối", ic: "🌙" }
      : { hi: "Khuya rồi đó", ic: "🌌" };
    const dateStr = now.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    const note = GREET_NOTES[noteIdx];
    const alert = lowCount > 0
      ? `Nhắc nhẹ: hiện <b>${lowCount}</b> tuyến lấp đầy dưới 60% — Sếp ghé mục <b>TLLD</b> để cân nhắc ghép tải khi rảnh nhé ạ.`
      : "";
    return { ...buoi, dateStr, note, alert };
  }, [lowCount, noteIdx]);
  return { ...g, shuffleNote };
}

export function Overview({ onNav, user }: { onNav: (m: TopMenu) => void; user?: { name: string; ghn: boolean } }) {
  const { index } = useTlld();
  const exclSet = useExcludedSet(); // mã tuyến LOẠI TRỪ (Nội Vùng HCM); CK1/CK2 loại theo tiền tố

  // Danh sách tuyến TÍNH VÀO báo cáo tổng quan (đã bỏ Nội Vùng + CK1 + CK2).
  const okEntries = useMemo(
    () => (index ? [...index.byCode.entries()].filter(([code]) => !isExcluded(code, exclSet)) : []),
    [index, exclSet],
  );

  const liveStat = useMemo(() => {
    if (!index) return null;
    const all = okEntries.map(([code, t]) => ({ code, n1: t.n1, avg7: t.avg7 }));
    const rows = all
      .map((x) => ({ ...x, v: (x.n1 ?? x.avg7) as number | null }))
      .filter((x) => x.v != null) as { code: string; n1: number | null; avg7: number | null; v: number }[];
    const total = rows.length;
    const n = total || 1;
    const avgN1 = rows.reduce((a, r) => a + r.v, 0) / n;
    const high = rows.filter((r) => r.v >= 0.85);
    const mid = rows.filter((r) => r.v >= 0.6 && r.v < 0.85);
    const low = rows.filter((r) => r.v < 0.6).sort((a, b) => a.v - b.v);
    const over = rows.filter((r) => r.v > 1).sort((a, b) => b.v - a.v);

    // Chỉ số sức khoẻ cụm 0–100 (thưởng tuyến lấp đầy tốt, phạt lãng phí & vượt tải).
    const goodPts = high.length * 100 + mid.length * 65 + low.length * 25;
    const overP = total ? (over.length / total) * 100 * 0.25 : 0;
    const score = total ? Math.max(0, Math.min(100, Math.round(goodPts / total - overP))) : 0;
    return { total, avgN1, high: high.length, mid: mid.length, low, over, score };
  }, [okEntries]);

  // ĐÁNH GIÁ TẢI DÀI HẠN: TB lấp đầy toàn cụm theo N-1 · 1 tuần · 2 tuần · 1 tháng (mẫu dài hơn).
  const longTerm = useMemo(() => {
    if (!index) return null;
    const rows = okEntries.map(([, t]) => t);
    const clusterAvg = (pick: (t: (typeof rows)[number]) => number | null) => {
      const vs = rows.map(pick).filter((v): v is number => v != null);
      if (!vs.length) return null;
      return {
        avg: vs.reduce((a, b) => a + b, 0) / vs.length,
        low: vs.filter((v) => v < 0.6).length,
        over: vs.filter((v) => v > 1).length,
        n: vs.length,
      };
    };
    const W = [0, 1, 2, 3];
    return {
      cur: W.map((i) => clusterAvg((t) => t.rollCur?.[i] ?? null)),       // Phần 1 hiện tại (cuốn chiếu)
      rollPrev: W.map((i) => clusterAvg((t) => t.rollPrev?.[i] ?? null)), // Phần 1 kỳ liền trước
      calCur: W.map((i) => clusterAvg((t) => t.calCur?.[i] ?? null)),     // Phần 2 hiện tại (tuần lịch)
      calPrev: W.map((i) => clusterAvg((t) => t.calPrev?.[i] ?? null)),   // Phần 2 tuần(s) trước
    };
  }, [okEntries]);

  // CẢNH BÁO THEO MỨC DUY TRÌ: phân tuyến vào bậc DÀI NHẤT mà nó còn xấu (kinh niên > 2 tuần > 1 tuần > mới N-1).
  // + nhóm CUỐI TUẦN (T7/CN) tách riêng. Cho cả 2 chiều: THẤP (<60% lãng phí) & VƯỢT (>100% thiếu xe).
  const warn = useMemo(() => {
    if (!index) return null;
    // LÃNG PHÍ tính TỪ 1% trở lên (bỏ tuyến ~0% vì ngày đó nhiều khả năng KHÔNG chạy/off, không phải lãng phí).
    const bad = (dir: "low" | "over", v: number | null) => v != null && (dir === "low" ? v >= 0.005 && v < 0.6 : v > 1.0);
    const build = (dir: "low" | "over") => {
      const b = { month: [] as { code: string; v: number }[], w2: [] as any[], w1: [] as any[], n1: [] as any[], weekend: [] as any[] };
      for (const [code, t] of okEntries) {
        if (bad(dir, t.avg30)) b.month.push({ code, v: t.avg30! });
        else if (bad(dir, t.avg14)) b.w2.push({ code, v: t.avg14! });
        else if (bad(dir, t.avg7)) b.w1.push({ code, v: t.avg7! });
        else if (bad(dir, t.n1)) b.n1.push({ code, v: t.n1! });
        if (bad(dir, t.weekendAvg)) b.weekend.push({ code, v: t.weekendAvg! });
      }
      const srt = (a: any[]) => a.sort((x, y) => (dir === "low" ? x.v - y.v : y.v - x.v));
      (["month", "w2", "w1", "n1", "weekend"] as const).forEach((k) => srt(b[k]));
      return b;
    };
    return { low: build("low"), over: build("over") };
  }, [okEntries]);

  // Cảnh báo nhanh thông minh — nhiều nhóm, mỗi nhóm kèm "lưu ý" + "nên làm".
  const liveAlerts = useMemo(() => {
    if (!index) return null;
    const pcT = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
    const E = okEntries.map(([code, t]) => ({ code, ...t }));

    const dropDown = E
      .filter((t) => t.n1 != null && t.avg7 != null && t.avg7 >= 0.5 && t.n1 >= 0.08 && t.n1 < t.avg7 * 0.6)
      .sort((a, b) => a.n1! / a.avg7! - b.n1! / b.avg7!)
      .slice(0, 8)
      .map((t) => ({ code: t.code, main: pcT(t.n1), sub: `TB 7N ${pcT(t.avg7)} · ▼${Math.round((1 - t.n1! / t.avg7!) * 100)}%` }));

    const spikeUp = E
      .filter((t) => t.n1 != null && t.avg7 != null && t.avg7 >= 0.2 && t.n1 > t.avg7 * 1.5)
      .sort((a, b) => b.n1! / b.avg7! - a.n1! / a.avg7!)
      .slice(0, 8)
      .map((t) => ({ code: t.code, main: pcT(t.n1), sub: `TB 7N ${pcT(t.avg7)} · ▲${Math.round((t.n1! / t.avg7! - 1) * 100)}%` }));

    const chronicLow = E
      .filter((t) => t.avg30 != null && t.days30 >= 10 && t.avg30 < 0.6)
      .sort((a, b) => a.avg30! - b.avg30!)
      .slice(0, 8)
      .map((t) => ({ code: t.code, main: pcT(t.avg30), sub: `TB tháng (${t.days30} ngày)` }));

    const overload = E
      .filter((t) => t.n1 != null && t.n1 > 1.1)
      .sort((a, b) => b.n1! - a.n1!)
      .slice(0, 8)
      .map((t) => ({ code: t.code, main: pcT(t.n1), sub: `vượt ${Math.round((t.n1! - 1) * 100)}%` }));

    const volatile = E
      .map((t) => {
        const s = t.series.map((x) => x.val).filter((v): v is number => v != null);
        return { code: t.code, n: s.length, range: s.length ? Math.max(...s) - Math.min(...s) : 0 };
      })
      .filter((t) => t.n >= 4 && t.range >= 0.5)
      .sort((a, b) => b.range - a.range)
      .slice(0, 8)
      .map((t) => ({ code: t.code, main: `±${Math.round(t.range * 100)}%`, sub: "dao động trong tuần" }));

    const groups = [
      { key: "drop", ic: "📉", title: "Giảm bất thường", color: "red", luuY: "Lấp đầy hôm nay tụt mạnh so với mức thường ngày của chính tuyến.", nenLam: "Kiểm tra ngay xe/tài xế/đơn; nếu thiếu hàng thì gộp chuyến để khỏi chạy rỗng.", items: dropDown },
      { key: "up", ic: "📈", title: "Tăng bất thường", color: "orange", luuY: "Sản lượng tăng đột biến so với thường ngày.", nenLam: "Chuẩn bị xe tăng cường, bám sát cut-off để không rớt chuyến.", items: spikeUp },
      { key: "chronic", ic: "🐢", title: "Thấp kéo dài cả tháng", color: "red", luuY: "Lấp đầy dưới 60% suốt cả tháng — lãng phí xe cố hữu, không phải sự cố nhất thời.", nenLam: "Cân nhắc gộp tuyến / đổi lịch / giảm tần suất để tiết kiệm chi phí lâu dài.", items: chronicLow },
      { key: "over", ic: "🛑", title: "Vượt tải nặng (>110%)", color: "orange", luuY: "Xe quá tải — dễ rớt cut-off, hư hàng, hao mòn xe.", nenLam: "Bổ sung xe/chuyến hoặc tách bớt điểm khỏi tuyến.", items: overload },
      { key: "vol", ic: "🎢", title: "Dao động thất thường", color: "blue", luuY: "Lấp đầy lên xuống mạnh trong tuần — khó dự báo & xếp xe.", nenLam: "Chuẩn hoá lịch & gom đơn ổn định hơn cho tuyến này.", items: volatile },
    ].filter((g) => g.items.length > 0);

    const total = groups.reduce((a, g) => a + g.items.length, 0);
    return { groups, total };
  }, [okEntries]);

  // BẢN CHỐT 10h sáng: lấy bản đã chốt hôm nay (nếu có); nếu chưa & đã qua 10h -> tự chốt từ số liệu thực tế hiện tại.
  const [snap, setSnap] = useState<{ at: number; date: string; refDate?: string; stat: typeof liveStat; alerts: typeof liveAlerts } | null>(null);
  const [snapMode, setSnapMode] = useState<"loading" | "snapshot" | "live">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/overview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "get" }) })
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d?.snap?.stat) { setSnap(d.snap); setSnapMode("snapshot"); } else setSnapMode("live"); })
      .catch(() => { if (alive) setSnapMode("live"); });
    return () => { alive = false; };
  }, []);
  // Chưa có bản chốt hôm nay & đã qua 10h sáng & có số liệu -> CHỐT ngay (lưu cho mọi người).
  useEffect(() => {
    if (snapMode !== "live" || !liveStat || !liveAlerts) return;
    if (new Date().getHours() < 10) return; // chưa tới 10h -> để realtime, chưa chốt
    let alive = true;
    fetch("/api/overview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", refDate: index?.refDate, stat: liveStat, alerts: liveAlerts }) })
      .then((r) => r.json())
      .then((d) => { if (alive && d?.ok && d.snap?.stat) { setSnap(d.snap); setSnapMode("snapshot"); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [snapMode, liveStat, liveAlerts, index]);

  // Số liệu hiển thị: ưu tiên BẢN CHỐT, chưa có thì dùng realtime.
  const stat = snap?.stat ?? liveStat;
  const alerts = snap?.alerts ?? liveAlerts;

  const scoreColor = !stat ? "var(--muted)" : stat.score >= 80 ? "var(--green)" : stat.score >= 60 ? "var(--orange)" : "var(--red)";
  const scoreLabel = !stat ? "" : stat.score >= 80 ? "Xuất sắc" : stat.score >= 65 ? "Tốt" : stat.score >= 50 ? "Khá" : "Cần cải thiện";

  // "cong-xuat" không còn là menu cấp 1 riêng (đã gộp vào sub-tab Lịch Tải) nên không có trong
  // TOP_MENUS — gán nhãn tay để lối tắt trên Tổng Quan không hiện raw key.
  const label = (k: TopMenu) => (k === "cong-xuat" ? "Cổng Xuất" : TOP_MENUS.find((m) => m.key === k)?.label || k);
  const greet = useGreeting(stat?.low.length || 0);
  const [openAlerts, setOpenAlerts] = useState(false);
  const [warnOpen, setWarnOpen] = useState<Set<string>>(new Set()); // "dir:tier" đang xem đủ tuyến

  return (
    <div className="ov">
      <div className="section-card ov-copilot">
        <span className="ov-copilot-glow" aria-hidden="true" />
        <div className="ov-greet-ava">🤖</div>
        <div className="ov-greet-body">
          <div className="ov-greet-hi">
            <span>{greet.ic} {greet.hi}{user?.name ? `, ${user.ghn ? "Sếp " : ""}${user.name}` : ""}!</span>
            {snapMode === "snapshot" && snap
              ? <span className="ov-rt">📌 Bản chốt {ddmm(snap.date)} · {new Date(snap.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
              : index ? <span className="ov-rt"><span className="blink" /> realtime{index ? <> · TLLD {ddmm(index.refDate)}</> : null}</span> : null}
          </div>
          <div className="ov-greet-note">
            <span dangerouslySetInnerHTML={{ __html: greet.note }} />
            <button className="ov-greet-shuffle" onClick={greet.shuffleNote} title="Đổi câu khác">↻</button>
          </div>
          {alerts && (
            alerts.total > 0 ? (
              <button className={"ov-insight" + (openAlerts ? " open" : "")} onClick={() => setOpenAlerts((o) => !o)}>
                <span className="ov-insight-ic">⚡</span>
                <span className="ov-insight-txt">
                  <b>{alerts.total} cảnh báo cần chú ý</b>
                  <span className="ov-insight-counts">
                    {alerts.groups.map((g) => <span key={g.key}>{g.ic} {g.items.length}</span>)}
                  </span>
                </span>
                <span className="ov-insight-go">{openAlerts ? "⌄" : "›"}</span>
              </button>
            ) : (
              <div className="ov-insight ok"><span className="ov-insight-ic">✅</span><span className="ov-insight-txt"><b>Không có cảnh báo lớn</b> — cụm đang ổn định.</span></div>
            )
          )}
          <div className="ov-owner">
            <span className="ov-owner-lb">👤 Phụ trách</span>
            <b>Võ Dương Trường Thọ</b>
            <a href="mailto:thovdt@ghn.com">✉️ thovdt@ghn.com</a>
            <a href="https://t.me/ThoVDT" target="_blank" rel="noopener noreferrer">✈️ @ThoVDT</a>
          </div>
        </div>
        {stat && (
          <div className="ov-score">
            <svg width="104" height="104" viewBox="0 0 104 104">
              <circle cx="52" cy="52" r="42" fill="none" stroke="var(--surface-sunken)" strokeWidth="10" />
              <circle cx="52" cy="52" r="42" fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 42} strokeDashoffset={2 * Math.PI * 42 * (1 - stat.score / 100)}
                transform="rotate(-90 52 52)" className="ov-score-arc" />
              <text x="52" y="50" textAnchor="middle" fontSize="26" fontWeight="800" fill={scoreColor}>{stat.score}</text>
              <text x="52" y="66" textAnchor="middle" fontSize="9.5" fill="var(--text-faint)">/100</text>
            </svg>
            <div className="ov-score-lb" style={{ color: scoreColor }}>Sức khoẻ cụm: {scoreLabel}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", marginTop: 1 }}>điểm 0–100 · {stat.total} tuyến</div>
            <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", marginTop: 3, lineHeight: 1.4, maxWidth: 150 }}>
              Mỗi tuyến: Tốt ≥85% = <b>100đ</b> · Khá 60–85% = <b>65đ</b> · Thấp &lt;60% = <b>25đ</b>; trừ điểm tuyến vượt tải, rồi lấy trung bình /100.
            </div>
          </div>
        )}
      </div>

      {/* HỎI NHANH — hỏi bất cứ điều gì trong Dash (tuyến, NCC, TLLD…) */}
      <HoiNhanh />

      {/* 4 KHUNG TỔNG QUAN: (trên) Sức khoẻ · Xu hướng dài hạn — (dưới) Lãng phí · Vượt tải */}
      {stat && stat.total > 0 && (() => {
        const TIERS: { key: "month" | "w2" | "w1" | "n1" | "weekend"; label: string }[] = [
          { key: "month", label: "Kinh niên (tháng)" },
          { key: "w2", label: "Duy trì 2 tuần" },
          { key: "w1", label: "Duy trì 1 tuần" },
          { key: "n1", label: "Mới N-1" },
          { key: "weekend", label: "Cuối tuần T7/CN" },
        ];
        const SHOWN = 3;
        const toggle = (id: string) => setWarnOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
        const dirFrame = (dir: "low" | "over") => {
          const cls = dir === "low" ? "red" : "orange";
          const anyTier = !!warn && TIERS.some((t) => (warn as any)[dir][t.key].length);
          return (
            <div className={"section-card ov-fr ov-fr-" + cls}>
              <div className="ov-fr-h">
                {dir === "low" ? "🔴 Lãng phí — theo mức duy trì" : "⚠️ Vượt tải — theo mức duy trì"}
                <span>{dir === "low" ? "· TLLD 1–60% · nên ghép tải" : "· >100% · cần thêm xe / giãn giờ"}</span>
              </div>
              {!anyTier ? (
                <div className="ov-fr-empty">Không có tuyến {dir === "low" ? "lãng phí" : "vượt tải"} duy trì — ổn 👍</div>
              ) : TIERS.map((t) => {
                const list = warn ? ((warn as any)[dir][t.key] as { code: string; v: number }[]) : [];
                if (!list.length) return null;
                const id = dir + ":" + t.key;
                const open = warnOpen.has(id);
                const show = open ? list : list.slice(0, SHOWN);
                return (
                  <div className={"ov-frt" + (t.key === "month" ? " top" : "")} key={t.key}>
                    <div className="ov-frt-lb">{t.label} <b className={"cnt " + cls}>{list.length}</b></div>
                    <div className="ov-frt-chips">
                      {show.map((x) => (
                        <span key={x.code} className={"ov-chip " + cls} onClick={() => onNav("tlld-tuyen")} title="Xem ở TLLD">{x.code} <b>{pct(x.v)}</b></span>
                      ))}
                      {list.length > SHOWN && (
                        <button className="ov-wl-more" onClick={() => toggle(id)}>{open ? "Thu gọn" : `+${list.length - SHOWN}`}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        };
        return (
          <>
            <div className="ov-grid4">
              {/* F2 — Lấp đầy xe toàn cụm (FULL WIDTH): 2 phần × 4 mốc */}
              <div className="section-card ov-fr" style={{ gridColumn: "1 / -1" }}>
                <div className="ov-fr-h">📊 Lấp đầy xe toàn cụm <span>· xe đang đầy hay chạy rỗng</span></div>
                {longTerm && index?.refDate ? (() => {
                  const lt = longTerm;
                  const rd = index.refDate!; // ISO N-1
                  const dnq = DOW_VN[dowOf(rd)]; // thứ của N-1
                  // PHẦN 1 — cuốn chiếu (rolling): N ngày gần nhất vs N ngày liền trước.
                  const WINS = [
                    { lb: "Hôm qua", off: 0 },
                    { lb: "7 ngày", off: 6 },
                    { lb: "14 ngày", off: 13 },
                    { lb: "20 ngày", off: 19 },
                  ];
                  const curRg = (o: number) => (o === 0 ? dmOf(rd) : `${dmOf(addISO(rd, -o))}–${dmOf(rd)}`);
                  const rollRg = (o: number) => (o === 0 ? dmOf(addISO(rd, -1)) : `${dmOf(addISO(rd, -(2 * o + 1)))}–${dmOf(addISO(rd, -(o + 1)))}`);
                  // PHẦN 2 — tuần lịch (T2→N-1) vs tuần(s) trước cùng số ngày.
                  const dow = dowOf(rd);
                  const monThis = addISO(rd, -dow); // Thứ 2 tuần này
                  const CAL = [
                    { k: 1, lb: "Tuần này", curR: `${dmOf(monThis)}–${dmOf(rd)}`, prevR: `${dmOf(addISO(monThis, -7))}–${dmOf(addISO(rd, -7))}` },
                    { k: 2, lb: "2 tuần", curR: `${dmOf(addISO(monThis, -7))}–${dmOf(rd)}`, prevR: `${dmOf(addISO(monThis, -21))}–${dmOf(addISO(rd, -14))}` },
                    { k: 3, lb: "3 tuần", curR: `${dmOf(addISO(monThis, -14))}–${dmOf(rd)}`, prevR: `${dmOf(addISO(monThis, -35))}–${dmOf(addISO(rd, -21))}` },
                  ];
                  // Tổng quan = 7 ngày cuốn chiếu.
                  const hero = lt.cur[1]?.avg ?? null, hprev = lt.rollPrev[1]?.avg ?? null;
                  const hdd = hero != null && hprev != null && hprev > 0 ? Math.round(((hero - hprev) / hprev) * 100) : null;
                  const verdict = hero == null ? "—" : hero > 1 ? "Vượt tải" : hero >= 0.85 ? "Đầy tốt" : hero >= 0.7 ? "Khá ổn" : hero >= 0.6 ? "Hơi thấp" : "Thấp · chạy rỗng";
                  const hCol = hero != null && hero > 1 ? "var(--color-warning)" : fillColor(hero);
                  const insight = hdd == null ? "Chưa đủ dữ liệu để đánh giá."
                    : `7 ngày gần nhất lấp đầy TB <b>${pct(hero)}</b> — ${hdd <= -5 ? `<b style="color:var(--red)">giảm ${Math.abs(hdd)}%</b> so 7 ngày trước, xe vơi hơn → ưu tiên GHÉP TẢI` : hdd >= 5 ? `<b style="color:var(--green)">tăng ${hdd}%</b> so 7 ngày trước 👍` : `đi ngang so 7 ngày trước → ổn định`}.`;
                  return (
                    <>
                      <div className="ovf-hero">
                        <div className="ovf-hero-num" style={{ color: hCol }}>{hero != null ? pct(hero) : "—"}</div>
                        <div className="ovf-hero-side">
                          <span className="ovf-badge" style={{ background: hCol }}>{verdict}</span>
                          <div className="ovf-hero-cap"><b>Tổng quan · 7 ngày gần nhất</b> ({curRg(6)}) · xe chở TB <b>{hero != null ? pct(hero) : "—"}</b> tải {hdd != null && <span style={{ color: ddCol(hdd), fontWeight: 800 }}>{hdd >= 0 ? "▲" : "▼"}{Math.abs(hdd)}% so 7 ngày trước</span>}</div>
                        </div>
                      </div>
                      <div className="ovf-2col">
                        <div className="ovf-part">
                          <div className="ovf-sec">🔄 Phần 1 · Cuốn chiếu <span>· vs kỳ liền trước</span></div>
                          {WINS.map((w, i) => (
                            <CmpLine key={w.lb} label={i === 0 ? `${w.lb} (${dnq})` : w.lb} note={`${rollRg(w.off)} → ${curRg(w.off)}`} cur={lt.cur[i]?.avg ?? null} prev={lt.rollPrev[i]?.avg ?? null} />
                          ))}
                        </div>
                        <div className="ovf-part">
                          <div className="ovf-sec">📅 Phần 2 · Tuần lịch <span>· tuần này vs tuần trước</span></div>
                          {CAL.map((c) => (
                            <CmpLine key={c.lb} label={c.lb} note={`${c.prevR} → ${c.curR}`} cur={lt.calCur[c.k]?.avg ?? null} prev={lt.calPrev[c.k]?.avg ?? null} />
                          ))}
                        </div>
                      </div>
                      <div className="ov-lt-note" dangerouslySetInnerHTML={{ __html: "🤖 " + insight }} />
                      <div className="ovf-src">ℹ️ Nguồn: <b>TLLD</b> (tỷ lệ lấp đầy theo khối lượng) toàn cụm ~<b>{stat.total}</b> tuyến, realtime từ Google Sheet. <b>Cuốn chiếu</b> = N ngày gần nhất (đến N-1) vs N ngày LIỀN TRƯỚC → bắt nhịp nóng. <b>Tuần lịch</b> = tuần này (T2→N-1) vs tuần(s) trước cùng số ngày. <b>▲/▼ %</b> = mức tăng/giảm so kỳ trước (vd lấp đầy 63% → 80% tức <b>tăng ~27%</b>).</div>
                    </>
                  );
                })() : <div className="ov-fr-empty">Đang tải dữ liệu…</div>}
              </div>

              {/* F3 — Lãng phí duy trì · F4 — Vượt tải duy trì */}
              {dirFrame("low")}
              {dirFrame("over")}
            </div>
            <div className="ov-warn-note" style={{ marginTop: 10 }}>🤖 “Duy trì” = TB lấp đầy cả kỳ vẫn xấu (không chỉ 1 ngày) — <b>kinh niên cả tháng</b> ưu tiên xử lý trước, <b>mới N-1</b> có thể chỉ là biến động. Lãng phí chỉ tính tuyến <b>TLLD ≥ 1%</b> (bỏ 0% vì ngày đó khả năng không chạy). Bấm tuyến để xem chi tiết ở TLLD.</div>
          </>
        );
      })()}

      {/* Chi tiết cảnh báo — mở ra khi bấm mũi tên ở khung trợ lý */}
      {openAlerts && alerts && alerts.total > 0 && (
        <div className="section-card ov-alertdetail">
          <div className="ov-sec-h">⚡ Chi tiết cảnh báo · {alerts.total} tuyến — <span style={{ color: "var(--muted)", fontWeight: 600 }}>kèm lưu ý & việc nên làm</span></div>
          {alerts.groups.map((g) => (
            <div key={g.key} className={"ov-ag ov-ag-" + g.color}>
              <div className="ov-ag-h">{g.ic} {g.title} <span className="ov-ag-n">{g.items.length} tuyến</span></div>
              <div className="ov-ag-meta"><b>Lưu ý:</b> {g.luuY}</div>
              <div className="ov-ag-meta act"><b>Nên làm:</b> {g.nenLam}</div>
              <div className="ov-ag-items">
                {g.items.map((it) => (
                  <button key={it.code} className="ov-ag-chip" onClick={() => onNav("tlld-tuyen")} title="Xem ở mục TLLD">
                    <b>{it.code}</b> <span className="m">{it.main}</span> <span className="s">{it.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cảnh báo sản lượng realtime: N vs N-1, xu hướng N+1/N+2 + kiến nghị */}
      <VolumeAlert />

      {/* Lối tắt các mục */}
      <div className="ov-sec-h" style={{ margin: "4px 2px 8px" }}>🧭 Đi tới các mục</div>
      <div className="ov-nav">
        {QUICK.map((q) => (
          <button
            key={q.key}
            className="ov-navcard"
            // "cong-xuat" không phải TopMenu render trực tiếp được (đã gộp vào sub-tab
            // "Cổng Xuất" trong Lịch Tải) — phải đi qua nav bus (App.tsx đã đăng ký redirect
            // sẵn) thay vì setTopMenu thẳng, nếu không trang sẽ trắng vì không khớp nhánh nào.
            onClick={() => (q.key === "cong-xuat" ? navTo({ view: "cong-xuat" }) : onNav(q.key))}
            style={{ ["--accent" as string]: q.color }}
          >
            <span className="ov-navic">{q.icon}</span>
            <span className="ov-navtxt">
              <span className="ov-navtit">{label(q.key)}</span>
              <span className="ov-navdesc">{q.desc}</span>
            </span>
            <span className="ov-navgo">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
