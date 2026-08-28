import { useRef, useState } from "react";
import { MapPanel } from "../components/MapPanel";
import { AssistantChat } from "../components/AssistantChat";
import { KeyConfig } from "../components/KeyConfig";
import { navTo, setPendingGhep } from "../lib/nav";
import { usePlaceNames, usePlaceIds, useAllRoutes } from "../lib/allRoutes";
import { checkCamTai } from "../lib/camTai";
import { useTlld } from "../lib/useTlld";
import { normCode } from "../lib/tlld";
import { PlaceInput } from "../components/PlaceInput";
import { TimeInput } from "../components/TimeInput";
import { shortKhoName } from "../lib/normalize";
import { GhepTai } from "./GhepTai";
import {
  planSchedule,
  planFromTemplate,
  validateTemplate,
  pickVehicle,
  VEHICLE_CONFIG,
  type PlanInput,
  type PlanResult,
  type GroupPlan,
  type TemplateRow,
} from "../lib/planner";
import { downloadTemplate, parseTemplate } from "../lib/template";
import { usePersistentState } from "../lib/usePersistent";
import { TOP_MENUS } from "../config";
import type { Route, TopMenu } from "../types";

// Câu Sếp XÁC NHẬN muốn dẫn trang / TỪ CHỐI.
const AFFIRM = /^\s*(đúng|đúng r[ồô]i|ừ|ừa|um+|oki?e?|ok|oke|okê|c[óo]|vâng|d[ạa](\s|$)|mở|mở đi|mở lu[ôo]n|d[ẫâ]n|d[ẫâ]n đi|đồng ý|đồng ý|conform|confirm|yes|y)\b/i;
const NEGATE = /^\s*(kh[ôo]ng|th[ôo]i|kh[ỏo]i|đừng|no|kg)\b/i;
// "cong-xuat" không còn là menu cấp 1 riêng (đã gộp vào sub-tab Lịch Tải) nên không có trong
// TOP_MENUS — gán nhãn tay để gợi ý điều hướng của trợ lý không hiện raw key (giống Overview.tsx).
const menuLabel = (k: string) => (k === "cong-xuat" ? "Cổng Xuất" : TOP_MENUS.find((m) => m.key === k)?.label || k);

const fmtKg = (n: number) => n.toLocaleString("vi-VN");

function buildRoute(rows: PlanResult["rows"], label: string, load: string, mode: string): Route {
  return {
    route: label,
    load,
    category: mode,
    stops: rows.map((r) => ({ kho: r.name, loaiHinh: r.loaiHinh, toi: r.toi, roi: r.roi, coord: r.coord })),
    mappedCount: rows.filter((r) => r.coord).length,
  };
}

/** Cảnh báo cấm tải — có nút ẩn/hiện riêng (Sếp yêu cầu 2026-08-24): khi cần chụp màn hình gửi
 *  NCC, ẩn tạm cảnh báo đi cho gọn, không xoá — bấm lại là hiện ra ngay, không mất dữ liệu. */
function CamTaiBanner({ cap, result }: { cap: number; result: PlanResult }) {
  const [hidden, setHidden] = useState(false);
  const ct = checkCamTai(cap, result.rows);
  if (hidden) {
    return (
      <button className="camtai-collapsed" onClick={() => setHidden(false)} title="Hiện lại cảnh báo cấm tải">
        👁 Hiện cảnh báo cấm tải
      </button>
    );
  }
  const closeBtn = (
    <button className="camtai-close" onClick={() => setHidden(true)} title="Ẩn để chụp màn hình">✕</button>
  );
  if (!ct.subject) return <div className="camtai camtai-ok">{closeBtn}✅ Xe <b>{fmtKg(cap)}kg</b> (Van/xe nhỏ) — <b>không vướng cấm tải</b> nội thành, chạy được mọi khung giờ.</div>;
  if (ct.hits.length === 0) return <div className="camtai camtai-ok">{closeBtn}✅ Xe <b>{fmtKg(cap)}kg</b> ({ct.tier}) — lịch KHÔNG rơi vào giờ cấm tải ({ct.windowsText}).</div>;
  return (
    <div className="camtai camtai-warn">
      {closeBtn}
      ⛔ <b>CẢNH BÁO CẤM TẢI</b> — xe <b>{fmtKg(cap)}kg</b> ({ct.tier}) cấm khung <b>{ct.windowsText}</b>. Có <b>{ct.hits.length} điểm</b> rơi vào giờ cấm: {ct.hits.slice(0, 8).map((h) => `${h.name} (${h.time})`).join("; ")}{ct.hits.length > 8 ? "…" : ""}.
      <div className="camtai-tip">→ Cân nhắc <b>dời giờ</b> ra ngoài khung cấm, hoặc dùng <b>xe ≤1.7T (Van)</b> cho các điểm này.</div>
    </div>
  );
}

function ScheduleTable({ result, cap, showCamTai = true, showCutoff = true, onRowClick, highlightIdx }: { result: PlanResult; cap: number; showCamTai?: boolean; showCutoff?: boolean; onRowClick?: (idx: number) => void; highlightIdx?: number | null }) {
  const fmtMin = (m: number) => `${Math.round(m)}′`;
  const totalDrive = Math.round(result.rows.reduce((a, r) => a + (r.min || 0), 0));
  const colCount = showCutoff ? 7 : 6;
  return (
    <div className="rt-wrap">
      {showCamTai && <CamTaiBanner cap={cap} result={result} />}
      <table className="route-table">
        <thead>
          <tr><th>#</th><th>Điểm / Kho</th><th>Loại hình</th><th>Tới</th><th>Rời</th>{showCutoff && <th>Cut-off</th>}<th>KM | TIME</th></tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(i + 1) : undefined}
              className={onRowClick ? "rt-row-click" + (highlightIdx === i + 1 ? " hi" : "") : undefined}
              title={onRowClick ? "Bấm để xem điểm này trên bản đồ" : undefined}
            >
              <td className="num">{i + 1}</td>
              <td className="rt-kho">{r.name}</td>
              <td className="rt-type">{r.loaiHinh}</td>
              <td className="num">{r.toi}</td>
              <td className="num">{r.roi}</td>
              {showCutoff && (
                <td className="num" style={r.late ? { color: "var(--red)", fontWeight: 800 } : undefined} title={r.late ? "Tới SAU cut-off!" : undefined}>
                  {r.cutoff || "—"}{r.late ? " ⚠" : ""}
                </td>
              )}
              <td className="num km">{r.km == null ? "—" : <>{r.km.toFixed(1)} <span className="km-min">· {fmtMin(r.min || 0)}</span></>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={colCount - 1}>Tổng quãng đường{showCutoff && result.lateCount > 0 ? ` · ⚠ ${result.lateCount} điểm trễ cut-off` : ""}</td><td className="num km">{result.totalKm.toFixed(1)} km · {fmtMin(totalDrive)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Giới thiệu nhanh dưới mỗi sub-tab: làm được gì · cần cấp gì · ra kết quả gì. */
function TabIntro({ icon, what, need, out }: { icon: string; what: string; need: string; out: string }) {
  return (
    <div className="section-card" style={{ marginBottom: 10, padding: "9px 14px", borderLeft: "3px solid var(--orange)", fontSize: 14.3, lineHeight: 1.6 }}>
      <span style={{ marginRight: 6 }}>{icon}</span>
      <b>Làm gì:</b> {what} <span style={{ color: "var(--muted)" }}>•</span> <b> Cần cấp:</b> {need} <span style={{ color: "var(--muted)" }}>•</span> <b> Kết quả:</b> {out}
    </div>
  );
}

export function SapLichTai({
  mapMode,
  setMapMode,
}: {
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
}) {
  const [subTab, setSubTab] = usePersistentState<"moi" | "nhanh" | "ghep">("sap.subTab", "moi");
  const placeNames = usePlaceNames(); // gợi ý tên kho/bưu cục khi nhập tay
  const placeIds = usePlaceIds(); // cho phép gõ MÃ ID kho để tìm ra tên (thay vì chỉ gõ tên)
  const allRoutes = useAllRoutes(); // toàn bộ tuyến (tải trọng, điểm, NCC, biển số) -> nạp DỮ LIỆU THẬT cho trợ lý
  const { index: tlldIndex } = useTlld(); // TLLD + sản lượng theo tuyến/ngày
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [missing, setMissing] = useState<{ group: string; name: string }[]>([]);
  const [plans, setPlans] = useState<GroupPlan[]>([]);
  const [sel, setSel] = useState(0);
  // Bấm 1 dòng trong bảng lịch (tab "Sắp Mới") -> nhô/mở popup đúng điểm đó trên bản đồ.
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ id: number; text: string } | undefined>(undefined);
  const noteId = useRef(0);
  const pushNote = (text: string) => setNote({ id: ++noteId.current, text });

  // form nhập tay nhanh
  const [mMode, setMMode] = usePersistentState<"Giao" | "Lấy">("sap.mMode", "Lấy");
  const [mVeh, setMVeh] = usePersistentState("sap.mVeh", 1900);
  const [mTime, setMTime] = usePersistentState("sap.mTime", "19:30");
  // Danh sách điểm thống nhất: Điểm 1 (nơi bắt đầu) → Điểm 2 → … mỗi điểm chọn loại hình + kg.
  const [mPts, setMPts] = usePersistentState<{ name: string; kg: string; loaiHinh?: string }[]>(
    "sap.mRoute",
    [{ name: "Kho Trung Chuyển Hồ Chí Minh 01", kg: "", loaiHinh: "Phân loại" }, { name: "", kg: "", loaiHinh: "" }]
  );
  const [mBusy, setMBusy] = useState(false);
  // Lịch ĐÃ TÍNH trong "Tính nhanh" — CHỈ lưu tạm trong phiên làm việc (state React thường, KHÔNG
  // usePersistentState/localStorage) để tính nhiều lịch liên tiếp gửi NCC; tải lại trang là mất,
  // đúng ý Sếp "không lưu mãi". Mỗi lần "Tính lịch" thành công -> tự thêm 1 thẻ mới + tự chọn thẻ
  // đó lên bản đồ; Sếp bấm vào thẻ khác thì đổi bản đồ sang lịch đó, xoá được từng thẻ hoặc xoá hết.
  const [mSaved, setMSaved] = useState<{ id: string; at: number; mode: "Giao" | "Lấy"; cap: number; result: PlanResult }[]>([]);
  const [mSelId, setMSelId] = useState<string | null>(null);
  // Mặc định TẤT CẢ thẻ đều xổ chi tiết sẵn -> chỉ đóng lại đúng thẻ nào Sếp bấm "Ẩn".
  const [mHiddenIds, setMHiddenIds] = useState<Set<string>>(new Set());
  const [mCopiedId, setMCopiedId] = useState<string | null>(null);
  // Bấm 1 dòng trong bảng lịch -> nhô/mở popup đúng điểm đó trên bản đồ (thứ tự 1-based).
  const [mHighlightIdx, setMHighlightIdx] = useState<number | null>(null);
  // Sếp báo 2026-08-25: bấm 1 thẻ Tuyến ở xa (đã cuộn xuống) thì map (sticky, đứng yên gần đầu
  // trang) không nằm cạnh thẻ đó -> chụp màn hình gửi NCC bị lệch, phải tự cuộn tay. Lưu DOM ref
  // từng thẻ để bấm phát là tự cuộn thẻ đó lên NGANG HÀNG với map — xem scrollCardToMap() bên dưới.
  const mCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  function scrollCardToMap(el: HTMLDivElement | null) {
    if (!el) return;
    const MAP_STICKY_TOP = 110; // PHẢI khớp .map-panel { position: sticky; top: 110px } trong index.css
    const curY = window.scrollY;
    const rect = el.getBoundingClientRect();
    let targetY = curY + rect.top - MAP_STICKY_TOP;

    // Sếp báo tiếp 2026-08-25 (sau khi có bản trên): thẻ CUỐI danh sách (Tuyến 1, ít tuyến) bị cuộn
    // QUÁ TAY -> map biến mất khỏi khung hình. Lý do: ".map-panel { position: sticky }" chỉ "dính"
    // ở top:110px trong PHẠM VI chiều cao khối chứa nó (".split", CAO BẰNG cột trái/danh sách thẻ) —
    // cuộn vượt quá phạm vi đó, map tự nhả ra khỏi vị trí dính và trôi lên trên, ra khỏi khung hình.
    // Tính scroll TỐI ĐA còn giữ map dính đúng top:110px, không cho cuộn vượt qua mốc này dù thẻ có
    // nằm thấp hơn nữa (thà thẻ hơi lệch dưới map còn hơn map biến mất hẳn).
    const mapPanel = document.querySelector(".map-panel");
    const split = mapPanel?.closest(".split");
    if (mapPanel && split) {
      const splitRect = split.getBoundingClientRect();
      const splitDocTop = splitRect.top + curY;
      const maxY = splitDocTop + splitRect.height - mapPanel.getBoundingClientRect().height - MAP_STICKY_TOP;
      targetY = Math.min(targetY, Math.max(0, maxY));
    }
    window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
  }
  // Gợi ý sắp lại thứ tự khi lộ trình Sếp nhập tay đi "nghịch đường" — CHỈ gợi ý, không tự áp dụng
  // (Sếp luôn quyết định thứ tự thật, xem onManual()).
  const [mSuggest, setMSuggest] = useState<{ order: { name: string; kg: string; loaiHinh?: string }[]; savedKm: number; pct: number } | null>(null);
  // Kéo-thả đổi thứ tự điểm trong form Tính nhanh.
  const [dragI, setDragI] = useState<number | null>(null);
  const movePt = (from: number, to: number) =>
    setMPts((a) => {
      if (from === to || from < 0 || to < 0) return a;
      const b = a.slice();
      const [m] = b.splice(from, 1);
      b.splice(to, 0, m);
      return b;
    });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setPlans([]);
    try {
      const r = await parseTemplate(f);
      setRows(r);
      const miss = await validateTemplate(r);
      setMissing(miss);
      const nPts = r.filter((x) => x.name.trim()).length;
      if (miss.length === 0) {
        pushNote(`📄 Đã nhận "${f.name}" — ${nPts} điểm. Đang sắp lịch…`);
        await runPlan(r);
      } else {
        pushNote(`📄 "${f.name}": ${nPts} điểm, nhưng có ${miss.length} điểm KHÔNG có toạ độ (xem báo lỗi bên dưới). Bạn có thể sửa tên rồi đăng lại, hoặc bấm "Vẫn sắp lịch".`);
      }
    } catch (err) {
      pushNote("Lỗi đọc file: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function runPlan(r: TemplateRow[]) {
    setBusy(true);
    try {
      const p = await planFromTemplate(r);
      setPlans(p);
      setSel(0);
      const sum = p
        .map((x) => `• ${x.group}: ${x.mode}, ${x.result.rows.length} điểm, ${x.totalKg}kg → ${x.vehicle.soXe} xe ${x.vehicle.cap}kg, ${x.result.totalKm.toFixed(1)}km`)
        .join("\n");
      pushNote(`✅ Đã sắp ${p.length} tuyến:\n${sum}\nXem chi tiết & bản đồ bên dưới. Bạn muốn điều chỉnh gì không?`);
    } finally {
      setBusy(false);
    }
  }

  async function onManual() {
    setMBusy(true);
    setMSuggest(null);
    try {
      const [first, ...rest] = mPts;
      const points = rest.map((p) => ({ name: p.name, kg: parseFloat(p.kg) || 0, loaiHinh: p.loaiHinh || "" }));
      const baseInput: Omit<PlanInput, "keepOrder"> = {
        mode: mMode,
        vehicleCap: mVeh,
        startName: first?.name || "",
        startTime: mTime,
        startLoaiHinh: first?.loaiHinh || "",
        startKg: parseFloat(first?.kg || "") || 0,
        endName: "", // tuyến dừng ở điểm cuối danh sách
        points,
      };
      // Tính ĐÚNG theo thứ tự Sếp đã điền — không tự sắp lại (thứ tự này có thể do Sếp biết trước
      // ràng buộc thật ngoài đường mà bản đồ không có, vd giờ mở cửa BC, đường 1 chiều...).
      const kept = await planSchedule({ ...baseInput, keepOrder: true });
      const id = String(Date.now());
      setMSaved((a) => [...a, { id, at: Date.now(), mode: mMode, cap: mVeh, result: kept }]);
      setMSelId(id);
      setMapMode("auto"); // luôn hiện Lộ trình vừa tính (MyMap không vẽ được lịch tự tính)

      // Từ 2 điểm cần đi trở lên mới có thứ tự khác để so — thử sắp lại theo lân cận gần nhất, CHỈ
      // gợi ý (không tự áp dụng) nếu ngắn hơn HẲN (>=1km VÀ >=8%) để tránh gợi ý vặt không đáng đổi.
      if (points.filter((p) => p.name.trim()).length >= 2) {
        try {
          const optimized = await planSchedule({ ...baseInput, keepOrder: false });
          const savedKm = kept.totalKm - optimized.totalKm;
          if (kept.totalKm > 0 && savedKm >= 1 && savedKm / kept.totalKm >= 0.08) {
            setMSuggest({
              savedKm,
              pct: Math.round((savedKm / kept.totalKm) * 100),
              order: optimized.rows.slice(1).map((r) => ({ name: r.name, kg: r.kg != null ? String(r.kg) : "", loaiHinh: r.loaiHinh })),
            });
          }
        } catch { /* gợi ý là phụ — lỗi thì bỏ qua, không chặn kết quả chính đã lưu */ }
      }
    } finally {
      setMBusy(false);
    }
  }
  /** Áp gợi ý sắp lại thứ tự vào form (giữ nguyên Điểm 1) — Sếp bấm "Tính lịch" lại để tính + lưu bản mới. */
  function applyMSuggest() {
    if (!mSuggest) return;
    setMPts((a) => [a[0], ...mSuggest.order.map((o) => ({ name: o.name, kg: o.kg, loaiHinh: o.loaiHinh || "" }))]);
    setMSuggest(null);
  }
  // Đầu mục tóm tắt thẻ tuyến — Sếp chốt 2026-08-26: "giờ lấy | Kho đầu → Kho cuối | tải trọng".
  // "giờ lấy" = giờ TỚI thật của Điểm 1 trên lộ trình (đúng "Giờ bắt đầu" Sếp gõ trong form) — KHÔNG
  // phải giờ Sếp bấm "Tính lịch" (đã dùng nhầm field "at" = Date.now() lúc tính, Sếp phát hiện
  // 2026-08-26: form ghi 13:00 mà đầu mục lại hiện 10:39 giờ bấm nút). Kho viết tắt (xem
  // shortKhoName — CHỈ áp ở đây, bảng chi tiết bên dưới vẫn hiện tên đầy đủ).
  function mSchedLabel(s: { mode: "Giao" | "Lấy"; cap: number; result: PlanResult }): string {
    const rows = s.result.rows;
    const hhmm = rows[0]?.toi || "?";
    const start = shortKhoName(rows[0]?.name || "?");
    const end = shortKhoName(rows[rows.length - 1]?.name || start);
    return `${hhmm} | ${start} → ${end} | ${fmtKg(s.cap)}kg`;
  }
  // Sếp chốt 2026-08-26: nội dung "Sao chép" gửi NCC phải GỌN — bỏ mã ID, bỏ loại hình, bỏ dòng
  // tổng km/giờ kết thúc, chỉ giữ tải trọng + số thứ tự + tên điểm + giờ tới-rời + link định vị.
  function copyMSaved(s: { id: string; mode: "Giao" | "Lấy"; cap: number; result: PlanResult }) {
    const stripId = (n: string) => n.replace(/^\s*\d+\s*-\s*/, "").trim();
    const lines = s.result.rows.map((r, i) => `${i + 1}. ${stripId(r.name)} | ${r.toi} - ${r.roi}`);
    // Kèm link Google Maps chỉ đường qua ĐÚNG THỨ TỰ các điểm — gửi NCC bấm 1 phát ra thẳng bản đồ
    // dẫn đường, không cần tự gõ lại từng địa chỉ để kiểm tra lộ trình.
    const coords = s.result.rows.filter((r) => r.coord).map((r) => `${r.coord![0]},${r.coord![1]}`);
    const mapLine = coords.length >= 2 ? `\n\nĐịnh vị: https://www.google.com/maps/dir/${coords.join("/")}` : "";
    const text = `${s.cap}KG\n\n${lines.join("\n")}${mapLine}`;
    navigator.clipboard?.writeText(text).then(() => {
      setMCopiedId(s.id);
      setTimeout(() => setMCopiedId((v) => (v === s.id ? null : v)), 1500);
    }).catch(() => {});
  }
  function delMSaved(id: string) {
    setMSaved((a) => a.filter((s) => s.id !== id));
    setMSelId((v) => (v === id ? null : v));
  }

  // Lịch đang chọn trong "Tính nhanh" (mới tính xong HOẶC Sếp bấm 1 thẻ cũ) — dùng chung cho bản đồ
  // + banner cấm tải ở "mục đề xuất" (KHÔNG lặp lại banner này trong từng thẻ đã lưu, xem JSX bên dưới).
  const mSel = mSaved.find((s) => s.id === mSelId) || null;

  // tuyến để vẽ bản đồ (tab "Sắp Mới" — tab "Tính nhanh" tự vẽ theo lịch đã lưu đang chọn, xem bên dưới)
  let mapRoutes: Route[] = [];
  if (plans.length && plans[sel]) mapRoutes = [buildRoute(plans[sel].result.rows, plans[sel].group, String(plans[sel].vehicle.cap), plans[sel].mode)];

  // tóm tắt cho trợ lý chat
  const ctx = plans.length
    ? plans
        .map((p) => `Nhóm ${p.group}: ${p.mode}, ${p.result.rows.length} điểm, tổng ${p.totalKg}kg → ${p.vehicle.soXe} xe ${p.vehicle.cap}kg, ${p.result.totalKm.toFixed(1)}km, kết thúc ${p.result.endTime}`)
        .join("\n") + (missing.length ? `\nĐiểm thiếu toạ độ: ${missing.length}` : "")
    : "Chưa nạp file lịch.";

  // Điều hướng ĐANG CHỜ Sếp xác nhận (không tự nhảy trang khi Sếp chỉ hỏi thông tin).
  const pendingNav = useRef<{ view: TopMenu; search?: string; region?: string; label: string } | null>(null);

  /** NẠP DỮ LIỆU THẬT của (các) mã tuyến có trong câu hỏi -> chống trợ lý bịa số.
   *  Lấy tải trọng/điểm/NCC/BKS (Lịch tải) + TLLD (N-1/TB7/tháng/cuối tuần) + sản lượng N-1. */
  function routeFacts(text: string): string {
    const codes = [...new Set(text.toUpperCase().match(/[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)+/g) || [])].slice(0, 6);
    if (!codes.length) return "";
    const pc = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
    const lines: string[] = [];
    for (const code of codes) {
      const nc = normCode(code);
      const t = tlldIndex?.byCode.get(nc);
      let rt = allRoutes.get(code);
      if (!rt) { for (const [k, v] of allRoutes) { if (normCode(k) === nc) { rt = v; break; } } }
      if (!t && !rt) { lines.push(`• ${code}: CHƯA có trong dữ liệu Dash (TLLD & Lịch tải) — KHÔNG bịa số.`); continue; }
      const p: string[] = [];
      if (rt) {
        if (rt.load) p.push(`tải trọng ${rt.load}kg`);
        p.push(`${rt.stops.length} điểm`);
        if (rt.ncc) p.push(`NCC ${rt.ncc}`);
        if (rt.bks) p.push(`BKS ${rt.bks}`);
        if (rt.category) p.push(`loại ${rt.category}`);
      }
      if (t) {
        p.push(`TLLD (tỷ lệ lấp đầy) hôm qua ${pc(t.n1)}, TB 7 ngày ${pc(t.avg7)}, TB tháng ${pc(t.avg30)}, cuối tuần ${pc(t.weekendAvg)}`);
        if (t.trips) p.push(`${t.trips} chuyến`);
      }
      const vol = tlldIndex?.volByCode.get(nc);
      if (vol && tlldIndex?.refDate) { const e = vol.get(tlldIndex.refDate); if (e) p.push(`sản lượng N-1 ${Math.round(e.soDon)} đơn/${Math.round(e.kg)}kg`); }
      const lt = t?.routeText || (rt ? rt.stops.map((s, i) => `${i + 1}.${s.kho}`).join(" → ") : "");
      if (lt) p.push(`lộ trình: ${lt}`);
      lines.push(`• ${code}: ${p.join("; ")}`);
    }
    return "[DỮ LIỆU THẬT TỪ DASH — trả lời ĐÚNG theo đây, KHÔNG bịa số]\n" + lines.join("\n");
  }

  /** Chat ở "Sắp Mới" — LUÔN trả lời đúng trọng tâm; chỉ ĐỀ XUẤT dẫn trang (hỏi ý Sếp)
   *  rồi mới dẫn khi Sếp xác nhận. Lệnh GHÉP / SẮP LỊCH rõ ràng thì hành động luôn. */
  async function navOrChat(text: string, history: { role: string; content: string }[]): Promise<string> {
    const t = text.trim();

    // (0) Đang chờ Sếp xác nhận dẫn trang?
    if (pendingNav.current) {
      const nav = pendingNav.current;
      if (AFFIRM.test(t)) {
        pendingNav.current = null;
        navTo({ view: nav.view, search: nav.search || undefined, region: nav.region || undefined });
        return `Dạ, em mở **${nav.label}** cho Sếp ngay đây ạ 👇`;
      }
      pendingNav.current = null; // câu khác/từ chối -> bỏ đề nghị, xử lý bình thường tiếp
      if (NEGATE.test(t)) return "Dạ vâng, em ở lại khung chat trả lời cho Sếp ạ. Sếp cần em phân tích/giải thích thêm gì không?";
    }

    // (1) SẮP LỊCH tự động từ mô tả (bưu cục + kg) -> chạy bộ tính lịch, hiện bảng + bản đồ.
    if (/\bs[ắâ]p\s*l[ịi]ch|l[êê]n\s*l[ịi]ch|t[íi]nh\s*l[ịi]ch|d[ựư]ng\s*l[ịi]ch|x[êê]́?p\s*l[ịi]ch\b/i.test(t)) {
      try {
        const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "schedcmd", text }) });
        const raw = (await r.json())?.reply || "";
        const m = raw.match(/\{[\s\S]*\}/);
        const cmd = m ? JSON.parse(m[0]) : null;
        if (cmd?.intent === "schedule" && Array.isArray(cmd.points) && cmd.points.filter((p: any) => p?.name && (p?.kg ?? 0) >= 0).length >= 1) {
          const s = await runChatSchedule(cmd);
          if (s) return s;
        }
        if (cmd?.ask) return cmd.ask; // thiếu thông tin -> hỏi lại đúng trọng tâm
      } catch { /* rơi xuống chat thường */ }
    }

    // (2) Lệnh GHÉP rõ ràng -> hành động (giữ nguyên).
    if (/\bgh[eé]p\b/i.test(t)) try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "agentcmd", text }) });
      const raw = (await r.json())?.reply || "";
      const m = raw.match(/\{[\s\S]*\}/);
      const cmd = m ? JSON.parse(m[0]) : null;
      if (cmd?.intent === "ghep" && cmd.ghep?.bc) {
        setPendingGhep({ bc: cmd.ghep.bc, kg: Number(cmd.ghep.kg) || 0, loai: cmd.ghep.loai || "", region: cmd.ghep.region || "", kho: cmd.ghep.kho || "" });
        setSubTab("ghep");
        return cmd.say || "Dạ em qua **Ghép Tải** điền & tìm tuyến giúp Sếp 👇";
      }
    } catch { /* rơi xuống chat thường */ }

    // (3) LUÔN trả lời câu hỏi. NẾU hỏi về tuyến/số liệu -> NẠP DỮ LIỆU THẬT (TLLD, tải, sản lượng)
    //     rồi trả bằng mode askdata (bám dữ liệu, KHÔNG bịa) — chống trả lời sai như trước.
    const facts = routeFacts(t);
    const looksData = !!facts || /tlld|l[ấâ]p đ[ầâ]y|s[ảa]n l[ưu][ơợ]ng|t[ảa]i tr[ọo]ng|l[ộô] tr[ìi]nh|bi[eể]n s[ốô]|bks|đi[eể]m d[ừư]ng|ncc|bao nhi[êe]u|m[ấâ]y (xe|đi[eể]m|kg)/i.test(t);
    let answer: string;
    try {
      const body = looksData
        ? { mode: "askdata", id: "saplich", messages: history, context: ctx + (facts ? "\n\n" + facts : "\n\n(Không tìm thấy mã tuyến trong dữ liệu — nếu Sếp hỏi 1 tuyến cụ thể mà chưa có số, hãy nói CHƯA CÓ dữ liệu, TUYỆT ĐỐI không bịa số.)") }
        : { messages: history, context: ctx };
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      answer = (await r.json())?.reply || "(không có phản hồi)";
    } catch (e) {
      return "Lỗi kết nối trợ lý: " + (e instanceof Error ? e.message : String(e));
    }

    // (4) Nếu câu liên quan 1 mục/tuyến cụ thể -> ĐỀ XUẤT dẫn (hỏi ý Sếp), KHÔNG tự nhảy.
    const looksNav =
      /\b(m[ởo]|xem|coi|qua|chuy[eể]n|v[àa]o|t[ơớ]i|hi[eể]n|nh[ảa]y|đi[êe]̀u h[ưu][ơớ]ng)\b|tlld|l[ịi]ch t[ảa]i|s[ảa]n l[ưu][ơợ]ng|plan event|c[ổô]ng xu[ấâ]t|t[ăa]ng c[ưu][ờơ]ng|v[ùu]ng hcm|t[ổô]ng quan/i.test(t) ||
      /[A-Z]{2,}[_-][A-Z0-9]/.test(t);
    if (looksNav) try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "navcmd", text }) });
      const raw = (await r.json())?.reply || "";
      const m = raw.match(/\{[\s\S]*\}/);
      const cmd = m ? JSON.parse(m[0]) : null;
      if (cmd?.view) {
        const label = menuLabel(cmd.view) + (cmd.search ? ` · lọc “${cmd.search}”` : "");
        pendingNav.current = { view: cmd.view, search: cmd.search || undefined, region: cmd.region || undefined, label };
        answer += `\n\n———\n👉 Nếu Sếp muốn xem trực quan, em mở **${menuLabel(cmd.view)}**${cmd.search ? ` và lọc sẵn **${cmd.search}**` : ""} nhé? Sếp nhắn **“đúng”** là em dẫn qua ạ.`;
      }
    } catch { /* bỏ qua đề xuất nếu lỗi */ }

    return answer;
  }

  /** Chạy bộ tính lịch từ lệnh chat (schedcmd) -> hiện bảng lịch + bản đồ ngay dưới chat. */
  async function runChatSchedule(cmd: any): Promise<string | null> {
    const mode: "Giao" | "Lấy" = /giao/i.test(cmd.mode || "") ? "Giao" : "Lấy";
    const kho = String(cmd.kho || "Kho Trung Chuyển Hồ Chí Minh 01").trim();
    const startTime = /^\d{1,2}:\d{2}/.test(cmd.startTime || "") ? cmd.startTime : "19:30";
    const points = cmd.points
      .filter((p: any) => p?.name)
      .map((p: any) => ({ name: String(p.name).trim(), kg: Number(p.kg) || 0, loaiHinh: p.loaiHinh || "" }));
    if (!points.length) return null;
    const totalKg = points.reduce((a: number, p: any) => a + (p.kg || 0), 0);
    const need = pickVehicle(totalKg);
    setBusy(true);
    try {
      const result = await planSchedule({ mode, vehicleCap: need.cap, startName: kho, startTime, endName: "", points });
      setPlans([{ group: "Lịch trợ lý sắp", mode, totalKg, vehicle: { cap: need.cap, kg: need.kg, soXe: need.soXe }, result }]);
      setSel(0);
      if (result.rows.length === 0) {
        return `Dạ, em tìm không thấy toạ độ cho: **${result.missing.join(", ")}** nên chưa sắp được lịch này. Có thể do điểm chưa có trên MyMap, HOẶC MyMap đã có nhưng đồng bộ về Dash đang lỗi tạm thời — Sếp thử lại sau ít phút, nếu vẫn vậy nhờ kiểm tra tên/toạ độ trên MyMap giúp em ạ.`;
      }
      const miss = result.missing.length ? ` ⚠ ${result.missing.length} điểm chưa có toạ độ (bỏ qua): ${result.missing.join(", ")} — có thể do MyMap chưa có điểm này hoặc đang đồng bộ lỗi tạm thời.` : "";
      const late = result.lateCount ? ` ⚠ ${result.lateCount} điểm trễ cut-off.` : "";
      return `Dạ, em đã sắp lịch **${mode}** từ **${kho}** lúc ${startTime}: **${result.rows.length} điểm**, tổng **${fmtKg(totalKg)} kg** → đề xuất **${need.soXe} xe ${fmtKg(need.cap)}kg**, ~${result.totalKm.toFixed(1)} km, kết thúc ${result.endTime}.${miss}${late}\nEm đã tối ưu thứ tự điểm theo lộ trình ngắn nhất — Sếp xem bảng & bản đồ ngay dưới đây 👇. Cần chỉnh điểm/giờ/xe gì Sếp cứ nói em ạ.`;
    } catch {
      return "Dạ em chưa sắp được lịch này (có thể do điểm chưa có toạ độ). Sếp thử ghi rõ tên bưu cục giúp em ạ.";
    } finally {
      setBusy(false);
    }
  }

  // Toàn bộ "Trợ lý Lịch Tải" (Sắp Mới + Ghép Tải + chat) chỉ dành cho ADMIN.

  return (
    <>
      <KeyConfig />
      <div className="sub-tabs">
        <button className={subTab === "moi" ? "active" : ""} onClick={() => setSubTab("moi")}>✨ Sắp Mới</button>
        <button className={subTab === "nhanh" ? "active" : ""} onClick={() => setSubTab("nhanh")}>⚡ Tính nhanh</button>
        <button className={subTab === "ghep" ? "active" : ""} onClick={() => setSubTab("ghep")}>🔗 Ghép Tải</button>
      </div>

      {subTab === "moi" && (
        <TabIntro icon="✨"
          what="Sắp lịch tải TỰ ĐỘNG — tải file danh sách điểm, HOẶC nhắn trợ lý: “sắp lịch lấy từ HCM01 lúc 19h: BC A 500kg, BC B 300kg…” là em tự tối ưu lộ trình. Hỏi thông tin thì em trả lời tại chỗ, chỉ dẫn sang trang khác khi Sếp đồng ý."
          need="File Excel (bấm tải mẫu) gồm điểm + kg theo nhóm, hoặc mô tả điểm + khối lượng ngay trong khung chat."
          out="Lịch từng tuyến (giờ tới/rời, km, cut-off) đã TỐI ƯU thứ tự điểm, đề xuất số xe & loại xe nhỏ nhất đủ tải, kèm bản đồ lộ trình." />
      )}
      {subTab === "nhanh" && (
        <TabIntro icon="⚡"
          what="Tính nhanh 1 lộ trình nhập tay — gõ thẳng các điểm để xem giờ & quãng đường, không cần file."
          need="Loại xe, giờ bắt đầu, và danh sách điểm theo thứ tự (mỗi điểm chọn loại hình + kg)."
          out="Bảng giờ tới/rời từng điểm, km · phút chạy thực tế, cảnh báo trễ cut-off và bản đồ lộ trình." />
      )}
      {subTab === "ghep" && (
        <TabIntro icon="🔗"
          what="Ghép thêm điểm/hàng vào tuyến đang chạy còn trống tải để tăng tỷ lệ lấp đầy, đỡ mở xe mới."
          need="Điểm cần ghép + khối lượng (kg) và loại (Lấy/Giao)."
          out="Gợi ý tuyến gần đó còn chỗ (TLLD thấp), TLLD trước→sau khi ghép, lộ trình; nếu không ghép được thì khuyến nghị mở tuyến mới." />
      )}

      {subTab === "ghep" ? (
        <GhepTai mapMode={mapMode} setMapMode={setMapMode} />
      ) : subTab === "nhanh" ? (
        <div className="split">
          <div>
            <div className="section-card pl-form">
              <h2 style={{ fontSize: 17, marginBottom: 4 }}>⚡ Tính nhanh 1 lộ trình (nhập tay)</h2>
              <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>Nhập các điểm theo thứ tự rồi bấm Tính lịch — ra giờ tới/rời, km, cut-off & đề xuất xe.</p>
              <div className="pl-seg">
                <button className={mMode === "Lấy" ? "on" : ""} onClick={() => setMMode("Lấy")}>📥 Lấy</button>
                <button className={mMode === "Giao" ? "on" : ""} onClick={() => setMMode("Giao")}>📤 Giao</button>
              </div>
              <div className="pl-grid">
                <label><span>Loại xe</span>
                  <select className="pl-in" value={mVeh} onChange={(e) => setMVeh(+e.target.value)}>
                    {VEHICLE_CONFIG.map((c) => <option key={c.cap} value={c.cap}>{fmtKg(c.cap)} kg</option>)}
                  </select>
                </label>
                <label><span>Giờ bắt đầu (tại Điểm 1)</span><TimeInput value={mTime} onChange={setMTime} /></label>
              </div>
              <div className="pl-full" style={{ fontSize: 14, color: "var(--muted)", margin: "2px 0" }}>
                Các điểm theo thứ tự — <b>Điểm 1</b> là nơi bắt đầu, điểm cuối là nơi kết thúc. Mỗi điểm chọn loại hình + kg.
              </div>
              {placeNames.length === 0 && (
                <div className="pl-full" style={{ fontSize: 13, color: "var(--red)", margin: "2px 0 8px" }}>
                  ⚠ Chưa tải được danh sách kho để gợi ý tên (nguồn Google Sheet) — vẫn gõ tay tính lịch được bình
                  thường, chỉ không có gợi ý. Thử tải lại trang; nếu vẫn vậy quá 10 giây, báo em kiểm tra nguồn Sheet.
                </div>
              )}
              <button
                className="pl-add-top"
                title="Chèn 1 điểm mới lên đầu tuyến (trước Điểm 1 hiện tại)"
                onClick={() => setMPts((a) => [{ name: "", kg: "", loaiHinh: "" }, ...a])}
              >+ Thêm điểm đầu tuyến</button>
              {mPts.map((p, i) => (
                <div
                  className="pl-pt"
                  key={i}
                  onDragOver={(e) => { if (dragI !== null && dragI !== i) e.preventDefault(); }}
                  onDrop={() => { if (dragI !== null) movePt(dragI, i); setDragI(null); }}
                  style={dragI === i ? { opacity: 0.4 } : undefined}
                >
                  <span
                    className="pl-pt-n"
                    draggable
                    title={`Điểm ${i + 1} · kéo để đổi thứ tự`}
                    onDragStart={(e) => { setDragI(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => setDragI(null)}
                    style={{ cursor: "grab" }}
                  >⋮⋮ {i + 1}</span>
                  <PlaceInput wrapStyle={{ flex: 1, minWidth: 0 }} placeholder="Tên hoặc mã ID bưu cục / kho" value={p.name} onChange={(v) => setMPts((a) => a.map((x, j) => j === i ? { ...x, name: v } : x))} names={placeNames} ids={placeIds} />
                  <select className="pl-in pl-lh" value={p.loaiHinh || ""} title="Loại hình tại điểm này" onChange={(e) => setMPts((a) => a.map((x, j) => j === i ? { ...x, loaiHinh: e.target.value } : x))}>
                    <option value="">⟳ Theo tuyến</option>
                    <option value="Phân loại">Phân loại</option>
                    <option value="Giao">Giao</option>
                    <option value="Lấy">Lấy</option>
                    <option value="Giao và lấy">Giao và lấy</option>
                  </select>
                  <input className="pl-in pl-kg" type="number" placeholder="kg" value={p.kg} onChange={(e) => setMPts((a) => a.map((x, j) => j === i ? { ...x, kg: e.target.value } : x))} />
                  <button
                    className="pl-ins"
                    title="Chèn điểm mới ngay sau điểm này"
                    onClick={() => setMPts((a) => { const b = a.slice(); b.splice(i + 1, 0, { name: "", kg: "", loaiHinh: "" }); return b; })}
                  >+</button>
                  <button className="pl-del" onClick={() => setMPts((a) => a.length > 1 ? a.filter((_, j) => j !== i) : a)}>✕</button>
                </div>
              ))}
              <div className="pl-actions">
                <button className="pl-add" onClick={() => setMPts((a) => [...a, { name: "", kg: "", loaiHinh: "" }])}>+ Thêm điểm</button>
                <button className="pl-calc" onClick={onManual} disabled={mBusy || mPts.filter((p) => p.name.trim()).length < 2}>{mBusy ? "Đang tính…" : "⚡ Tính lịch"}</button>
              </div>

              {mSel && <div style={{ marginTop: 10 }}><CamTaiBanner cap={mSel.cap} result={mSel.result} /></div>}

              {mSuggest && (
                <div className="pe-comment" style={{ borderLeftColor: "var(--blue)", marginTop: 10 }}>
                  💡 Thứ tự Sếp nhập có vẻ <b>nghịch đường</b> — sắp lại thành{" "}
                  <b>{mSuggest.order.map((o) => o.name).join(" → ")}</b> sẽ ngắn hơn{" "}
                  <b style={{ color: "var(--blue)" }}>{mSuggest.savedKm.toFixed(1)}km ({mSuggest.pct}%)</b>. Lịch vừa tính vẫn giữ đúng
                  thứ tự Sếp điền — đây chỉ là gợi ý.
                  <div style={{ marginTop: 6, display: "flex", gap: 10 }}>
                    <button className="lnk" onClick={applyMSuggest}>Áp dụng vào form</button>
                    <button className="lnk" onClick={() => setMSuggest(null)}>Bỏ qua</button>
                  </div>
                </div>
              )}
            </div>

            {mSaved.length > 0 && (
              <div className="section-card" style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <h2 style={{ fontSize: 15.5, margin: 0, textTransform: "uppercase" }}>📥 Danh Sách Tuyến ({mSaved.length})</h2>
                  <button className="lnk lnk-del" onClick={() => { setMSaved([]); setMSelId(null); }}>Xoá tất cả</button>
                </div>
                <p className="pe-sub" style={{ margin: "4px 0 8px" }}>
                  Tổng <b>{mSaved.reduce((a, s) => a + s.result.totalKm, 0).toFixed(1)} km</b> ·{" "}
                  {[...mSaved.reduce((m, s) => m.set(s.cap, (m.get(s.cap) || 0) + 1), new Map<number, number>()).entries()]
                    .map(([cap, n]) => `${n} xe ${fmtKg(cap)}kg`).join(" · ")}
                </p>
                {mSaved.map((s, i) => ({ s, num: i + 1 })).reverse().map(({ s, num }) => {
                  const isSel = s.id === mSelId;
                  const isHidden = mHiddenIds.has(s.id);
                  return (
                    <div
                      key={s.id}
                      ref={(el) => { if (el) mCardRefs.current.set(s.id, el); else mCardRefs.current.delete(s.id); }}
                      className="section-card"
                      style={{ marginTop: 8, padding: "10px 12px", cursor: "pointer", border: isSel ? "2px solid var(--orange)" : "1px solid var(--line)" }}
                      onClick={(e) => { setMSelId(s.id); setMapMode("auto"); scrollCardToMap(e.currentTarget); }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700, textTransform: "uppercase" }}>
                          <span style={{ color: "var(--orange)" }}>Tuyến {num}</span> | {mSchedLabel(s)}
                        </div>
                        <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            className="lnk"
                            onClick={() => setMHiddenIds((h) => {
                              const n = new Set(h);
                              if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
                              return n;
                            })}
                          >
                            {isHidden ? "👁 Hiện" : "🙈 Ẩn"}
                          </button>
                          <button className="lnk" onClick={() => copyMSaved(s)}>{mCopiedId === s.id ? "✅ Đã sao chép" : "📋 Sao chép"}</button>
                          <button className="lnk lnk-del" onClick={() => delMSaved(s.id)}>Xoá</button>
                        </div>
                      </div>
                      {s.result.missing.length > 0 && (
                        <div className="pl-warn" style={{ marginTop: 8, marginBottom: 0 }}>
                          🤖 Dạ, em tìm không thấy toạ độ cho {s.result.missing.length} điểm nên bỏ qua, không tính vào lịch: <b>{s.result.missing.join(", ")}</b>.
                          Có thể do điểm chưa có trên MyMap, HOẶC MyMap đã có nhưng đồng bộ về Dash đang lỗi tạm thời — Sếp thử lại sau ít phút, nếu vẫn vậy nhờ kiểm tra tên/toạ độ trên MyMap giúp em ạ.
                        </div>
                      )}
                      {!isHidden && (
                        <div style={{ marginTop: 10 }}>
                          <ScheduleTable
                            result={s.result}
                            cap={s.cap}
                            showCamTai={false}
                            showCutoff={false}
                            highlightIdx={isSel ? mHighlightIdx : null}
                            onRowClick={(idx) => { setMSelId(s.id); setMapMode("auto"); setMHighlightIdx(idx); scrollCardToMap(mCardRefs.current.get(s.id) || null); }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="map-panel">
            <MapPanel
              routes={mSel ? [buildRoute(mSel.result.rows, "Lịch nhanh", String(mSel.cap), mSel.mode)] : []}
              title="Lộ trình tính nhanh"
              mapMode={mapMode}
              setMapMode={setMapMode}
              highlightIdx={mHighlightIdx}
              placeIds={placeIds}
            />
          </div>
        </div>
      ) : (
        <div className="split">
      <div>
        {/* Trợ lý chat (gắn template + upload ngay trong này) */}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onFile} />
        <AssistantChat
          chatId="saplich"
          context={ctx}
          note={note}
          interpret={navOrChat}
          onTemplate={downloadTemplate}
          onUpload={() => fileRef.current?.click()}
        />
        {fileName && (
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>
            📄 {fileName}{busy && " · đang sắp lịch…"}
          </div>
        )}

        {/* Báo điểm thiếu toạ độ */}
        {missing.length > 0 && (
          <div className="section-card" style={{ marginTop: 12, borderLeft: "4px solid var(--red)" }}>
            <div style={{ color: "var(--red)", fontWeight: 800, marginBottom: 8 }}>
              ✕ File có {missing.length} điểm không tồn tại trong hệ thống — kiểm tra lại tên bưu cục/kho
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14.5 }}>
              {missing.slice(0, 12).map((m, i) => (
                <div key={i}>• <b>{m.group}</b>: {m.name}</div>
              ))}
              {missing.length > 12 && <div style={{ color: "var(--muted)" }}>… và {missing.length - 12} điểm khác</div>}
            </div>
            <button className="pl-calc" style={{ marginTop: 12 }} onClick={() => runPlan(rows)} disabled={busy}>
              {busy ? "Đang sắp lịch…" : "Vẫn sắp lịch (bỏ qua điểm thiếu)"}
            </button>
          </div>
        )}

        {/* Kết quả sắp lịch theo nhóm */}
        {plans.length > 0 && (
          <div className="section-card" style={{ marginTop: 12 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>Lịch tự tính · {plans.length} tuyến</h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {plans.map((p, i) => (
                <button key={i} className={"cat-chip" + (i === sel ? " active" : "")} onClick={() => setSel(i)}>
                  {p.group}<span className="n">{p.vehicle.soXe} xe</span>
                </button>
              ))}
            </div>
            {plans[sel] && (
              <>
                <p className="lead" style={{ marginBottom: 10 }}>
                  <b>{plans[sel].mode}</b> · {plans[sel].result.rows.length} điểm · tổng hàng <b>{fmtKg(plans[sel].totalKg)} kg</b> → đề xuất{" "}
                  <b style={{ color: "var(--orange)" }}>{plans[sel].vehicle.soXe} xe {fmtKg(plans[sel].vehicle.cap)}kg</b>{" "}
                  (tải chuẩn {fmtKg(plans[sel].vehicle.kg)}kg) · {plans[sel].result.totalKm.toFixed(1)} km · kết thúc {plans[sel].result.endTime}
                  {plans[sel].result.over && <span style={{ color: "var(--red)" }}> · ⚠ vượt tải</span>}
                </p>
                <ScheduleTable result={plans[sel].result} cap={plans[sel].vehicle.cap} onRowClick={setHighlightIdx} highlightIdx={highlightIdx} />
              </>
            )}
          </div>
        )}

      </div>

      <div className="map-panel">
        <MapPanel routes={mapRoutes} title={plans.length ? plans[sel]?.group ?? "Lộ trình" : "Bản đồ lộ trình"} mapMode={mapMode} setMapMode={setMapMode} highlightIdx={highlightIdx} placeIds={placeIds} />
      </div>
    </div>
      )}
    </>
  );
}
