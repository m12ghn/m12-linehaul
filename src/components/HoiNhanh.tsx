/* ============================================================
   HỎI NHANH — ô hỏi đáp ở đầu Tổng Quan. Trợ lý trả lời về MỌI dữ liệu Dash:
   - Nạp TÓM TẮT (TLLD cụm + danh sách NCC) làm ngữ cảnh, VÀ
   - Có CÔNG CỤ tra cứu (function-calling) để lấy ĐÚNG số khi cần:
       tra_tuyen · tra_ncc · top_tuyen · thong_ke_tlld
   Số liệu do code cung cấp (không bịa); trợ lý chỉ diễn giải.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAllRoutes } from "../lib/allRoutes";
import { useTlld } from "../lib/useTlld";
import { normCode, type TlldRoute } from "../lib/tlld";
import { normSearch } from "../lib/normalize";
import { loadNccVT, nccVTDigest, type NccVT } from "../lib/nccVT";
import { loadXinTc, type XtcRec } from "../lib/xinTangCuong";
import { usePersistentState } from "../lib/usePersistent";
import { getUser, addressOf } from "../lib/useUser";
import { RichText } from "./RichText";

interface Msg { role: "user" | "assistant"; content: string }

const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
const pc = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

const GỢI_Ý = [
  "Xe 50H-26441 chạy những tuyến nào?",
  "BC Tân Sơn Nhì xin tăng cường mấy xe, T7 bao nhiêu?",
  "NCC Vạn Lợi: người liên hệ, SĐT?",
  "Bưu cục ở Quận 12 có bị cấm tải không?",
  "Top 5 tuyến lấp đầy thấp nhất?",
];

/* Tiến trình đang chạy + hội thoại — sống ở cấp MODULE để KHÔNG bị huỷ khi rời tab Tổng Quan
 * (component unmount) rồi quay lại. Ghi thẳng sessionStorage để bám tiếp & không mất câu trả lời. */
const HN_KEY = "m12:hn.chat"; // trùng key usePersistentState("hn.chat")
let hnInflight: Promise<void> | null = null;
const readMsgs = (): Msg[] => { try { const s = sessionStorage.getItem(HN_KEY); return s ? JSON.parse(s) : []; } catch { return []; } };
const writeMsgs = (m: Msg[]) => { try { sessionStorage.setItem(HN_KEY, JSON.stringify(m)); } catch { /* bỏ qua */ } };

export function HoiNhanh() {
  const allRoutes = useAllRoutes();
  const { index } = useTlld();
  const [ncc, setNcc] = useState<NccVT[]>([]);
  const [xtc, setXtc] = useState<XtcRec[]>([]);
  useEffect(() => {
    let alive = true;
    loadNccVT().then((d) => { if (alive && d.ok) setNcc(d.list); }).catch(() => {});
    loadXinTc().then((d) => { if (alive && d.ok) setXtc(d.recs); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [msgs, setMsgs] = usePersistentState<Msg[]>("hn.chat", []);
  const [input, setInput] = usePersistentState<string>("hn.draft", ""); // giữ nội dung đang soạn khi chuyển tab
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = usePersistentState<boolean>("hn.open", false);
  const endRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  // Quay lại tab: nếu còn 1 câu hỏi ĐANG chạy -> bám theo, hiện lại đáp án khi xong.
  useEffect(() => {
    mountedRef.current = true;
    if (hnInflight) {
      setBusy(true);
      hnInflight.then(() => { if (mountedRef.current) setMsgs(readMsgs()); }).finally(() => { if (mountedRef.current) setBusy(false); });
    }
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ngữ cảnh tóm tắt: thống kê TLLD cụm + toàn bộ NCC (để trả lời cả khi không gọi công cụ).
  const digest = useMemo(() => {
    const L: string[] = ["DỮ LIỆU DASH M12 (tóm tắt — dùng công cụ để tra chi tiết chính xác)."];
    if (index) {
      const ents = [...index.byCode.values()];
      const vals = ents.map((t) => t.n1 ?? t.avg7).filter((v): v is number => v != null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const low = vals.filter((v) => v < 0.6).length, over = vals.filter((v) => v > 1).length;
      L.push(`TLLD: ${index.byCode.size} tuyến, lấp đầy TB ${pct(avg)}; ${low} tuyến thấp (<60%), ${over} tuyến vượt tải (>100%). Ngày cập nhật ${index.refDate || "—"}.`);
    }
    L.push(`LỊCH TẢI: ${allRoutes.size} tuyến có lộ trình/tải trọng (tra bằng công cụ tra_tuyen / tra_bien_so / tra_kho).`);
    if (xtc.length) {
      const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const r30 = xtc.filter((r) => r.date >= cutoff);
      const co = r30.filter((r) => r.coXe === true).length, kh = r30.filter((r) => r.coXe === false).length;
      L.push(`XIN TĂNG CƯỜNG (30 ngày): ${r30.length} lượt xin xe, đáp ứng ${co + kh ? Math.round((co / (co + kh)) * 100) : "—"}% (dùng tra_xin_tang_cuong để lọc theo bưu cục/thứ).`);
    }
    if (ncc.length) L.push(`\nDANH SÁCH NCC VẬN TẢI (${ncc.length}):\n${nccVTDigest(ncc)}`);
    return L.join("\n");
  }, [index, allRoutes, ncc, xtc]);

  // Công cụ tra cứu chính xác (client tự chạy khi model yêu cầu).
  const tools = useMemo(() => {
    const decls = [
      { name: "tra_tuyen", description: "Tra 1 tuyến theo mã: tải trọng, lộ trình (kho theo giờ), NCC, biển số, và TLLD (lấp đầy N-1/7 ngày/tháng, đơn vị %).", parameters: { type: "OBJECT", properties: { ma_tuyen: { type: "STRING", description: "mã tuyến hoặc một phần, vd 'SG_CK2_101'" } }, required: ["ma_tuyen"] } },
      { name: "tra_bien_so", description: "Tra xe theo BIỂN SỐ: trả về các tuyến mà xe đó đang chạy + tải trọng + lộ trình. Khớp cả khi gõ thiếu dấu '-' hoặc chỉ vài số cuối (vd '50H-26441', '50H26441', '26441').", parameters: { type: "OBJECT", properties: { bien_so: { type: "STRING", description: "biển số xe hoặc phần số của nó" } }, required: ["bien_so"] } },
      { name: "tra_ncc", description: "Tra nhà cung cấp vận tải (NCC) theo tên hoặc khu vực: miền, khu vực hoạt động, người liên hệ (tên/SĐT/chức danh), giám đốc, email, địa chỉ.", parameters: { type: "OBJECT", properties: { ten: { type: "STRING", description: "tên hoặc một phần tên NCC / khu vực" } }, required: ["ten"] } },
      { name: "top_tuyen", description: "Danh sách tuyến theo tiêu chí lấp đầy.", parameters: { type: "OBJECT", properties: { loai: { type: "STRING", description: "thap (lấp đầy thấp nhất) | cao (cao nhất) | vuot_tai (>100%)" }, n: { type: "INTEGER", description: "số lượng, mặc định 5" } }, required: ["loai"] } },
      { name: "thong_ke_tlld", description: "Thống kê TLLD toàn cụm: số tuyến, lấp đầy TB, số tuyến tốt(≥85%)/khá(60-85%)/thấp(<60%)/vượt tải(>100%).", parameters: { type: "OBJECT", properties: {} } },
      { name: "tra_xin_tang_cuong", description: "Tra lượt XIN XE TĂNG CƯỜNG (BC xin tăng cường): số lượt xin, có xe/không xe, tỷ lệ đáp ứng, và TÁCH THEO THỨ trong tuần trong trường theo_thu (T2,T3,T4,T5,T6,T7,CN). Mỗi lượt = 1 xe. LƯU Ý: 'T7' nghĩa là THỨ BẢY -> đọc theo_thu.T7, KHÔNG phải 7 ngày.", parameters: { type: "OBJECT", properties: { bc: { type: "STRING", description: "tên bưu cục cần lọc (bỏ trống = toàn cụm)" }, so_ngay: { type: "INTEGER", description: "cửa sổ nhìn lại (ngày), mặc định 30; để ≥30 cho đủ nhiều tuần" } } } },
      { name: "tra_kho", description: "Tra 1 KHO/BƯU CỤC: liệt kê các tuyến ĐI QUA kho đó (mã tuyến + loại hình + giờ) và đếm số tuyến.", parameters: { type: "OBJECT", properties: { ten: { type: "STRING", description: "tên kho / bưu cục hoặc một phần" } }, required: ["ten"] } },
    ];
    const tlldOf = (code: string): TlldRoute | undefined => index?.byCode.get(normCode(code));
    const entries = () => (index ? [...index.byCode.entries()] : []);
    const vOf = (t: TlldRoute) => t.n1 ?? t.avg7;
    const run = (name: string, args: any) => {
      if (name === "tra_tuyen") {
        const q = String(args?.ma_tuyen || ""); const nc = normCode(q);
        let rt = allRoutes.get(nc);
        if (!rt) for (const [k, v] of allRoutes) { if (normCode(k).includes(nc)) { rt = v; break; } }
        const t = tlldOf(rt?.route || q);
        if (!rt && !t) return { thong_bao: "Không tìm thấy tuyến khớp mã này." };
        return {
          ma_tuyen: rt?.route || q.toUpperCase(),
          tai_trong: rt?.load || null,
          ncc: rt?.ncc || null, bien_so: rt?.bks || null,
          lo_trinh: rt ? rt.stops.map((s, i) => `${i + 1}.${s.kho}${s.toi ? ` (tới ${s.toi})` : ""}`).join(" → ") : null,
          tlld_n1_phantram: pc(t?.n1), tlld_7ngay_phantram: pc(t?.avg7), tlld_thang_phantram: pc(t?.avg30),
        };
      }
      if (name === "tra_bien_so") {
        const qb = String(args?.bien_so || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!qb) return { thong_bao: "Thiếu biển số." };
        const hits: any[] = [];
        for (const r of allRoutes.values()) {
          const b = (r.bks || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (b && b.includes(qb)) {
            const t = tlldOf(r.route);
            hits.push({ ma_tuyen: r.route, bien_so: r.bks, tai_trong: r.load || null, lo_trinh: r.stops.map((s, i) => `${i + 1}.${s.kho}`).join(" → "), tlld_n1_phantram: pc(t?.n1) });
          }
          if (hits.length >= 15) break;
        }
        return hits.length ? { so_tuyen: hits.length, ket_qua: hits } : { thong_bao: "Không tìm thấy tuyến nào gắn biển số này trong lịch tải." };
      }
      if (name === "tra_ncc") {
        const q = normSearch(String(args?.ten || ""));
        const hits = ncc.filter((n) => normSearch(n.ten).includes(q) || normSearch(n.khuVuc).includes(q)).slice(0, 8);
        if (!hits.length) return { thong_bao: "Không tìm thấy NCC khớp." };
        return { ket_qua: hits.map((n) => ({ ten: n.ten, mien: n.mien, khu_vuc: n.khuVuc, nguoi_lien_he: n.lhTen, sdt_lien_he: n.lhSdt, chuc_danh_lh: n.lhChuc, giam_doc: n.gdTen, sdt_giam_doc: n.gdSdt, email: n.email, dia_chi: n.diaChi, trang_thai: n.status })) };
      }
      if (name === "top_tuyen") {
        const n = Math.min(20, Math.max(1, Number(args?.n) || 5));
        const loai = String(args?.loai || "thap");
        let list = entries().map(([code, t]) => ({ code, v: vOf(t) })).filter((x): x is { code: string; v: number } => x.v != null);
        if (loai === "cao") list.sort((a, b) => b.v - a.v);
        else if (loai === "vuot_tai") list = list.filter((x) => x.v > 1).sort((a, b) => b.v - a.v);
        else list.sort((a, b) => a.v - b.v);
        return { loai, ket_qua: list.slice(0, n).map((x) => ({ ma_tuyen: x.code, lap_day_phantram: pc(x.v) })) };
      }
      if (name === "thong_ke_tlld") {
        const vals = entries().map(([, t]) => vOf(t)).filter((v): v is number => v != null);
        const mean = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : null;
        return { so_tuyen: index?.byCode.size || 0, lap_day_tb_phantram: mean, tot_85: vals.filter((v) => v >= 0.85).length, kha_60_85: vals.filter((v) => v >= 0.6 && v < 0.85).length, thap_duoi_60: vals.filter((v) => v < 0.6).length, vuot_tai: vals.filter((v) => v > 1).length };
      }
      if (name === "tra_xin_tang_cuong") {
        if (!xtc.length) return { thong_bao: "Chưa tải được dữ liệu xin tăng cường." };
        const bcq = normSearch(String(args?.bc || ""));
        const days = Math.min(120, Math.max(1, Number(args?.so_ngay) || 30));
        const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const recs = xtc.filter((r) => r.date >= cutoff && (!bcq || normSearch(r.bc).includes(bcq)));
        if (!recs.length) return { thong_bao: `Không có lượt xin tăng cường khớp trong ${days} ngày gần nhất.` };
        const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
        const theoThu: Record<string, number> = {};
        for (const r of recs) { const t = THU[new Date(r.date + "T00:00:00").getDay()]; theoThu[t] = (theoThu[t] || 0) + 1; }
        const co = recs.filter((r) => r.coXe === true).length, khong = recs.filter((r) => r.coXe === false).length, cho = recs.filter((r) => r.coXe == null).length;
        return {
          khoang: `${days} ngày gần nhất`, tong_luot_xin_xe: recs.length, co_xe: co, khong_xe: khong, cho_xu_ly: cho,
          ty_le_dap_ung_phantram: co + khong ? Math.round((co / (co + khong)) * 100) : null,
          so_buu_cuc: new Set(recs.map((r) => r.bc)).size, theo_thu: theoThu,
          gan_day: recs.slice(-12).map((r) => ({ ngay: r.date, thu: THU[new Date(r.date + "T00:00:00").getDay()], buu_cuc: r.bc, the_tich: r.theTich, trang_thai: r.trangThai })),
        };
      }
      if (name === "tra_kho") {
        const q = normSearch(String(args?.ten || ""));
        if (!q) return { thong_bao: "Thiếu tên kho." };
        const hits: any[] = [];
        for (const r of allRoutes.values()) {
          const st = r.stops.find((s) => normSearch(s.kho).includes(q));
          if (st) hits.push({ ma_tuyen: r.route, loai_hinh: st.loaiHinh || "", gio_toi: st.toi || "", tai_trong: r.load || null });
          if (hits.length >= 30) break;
        }
        return hits.length ? { so_tuyen: hits.length, ket_qua: hits } : { thong_bao: "Không tìm thấy tuyến nào đi qua kho/bưu cục này." };
      }
      return { error: "Công cụ không hợp lệ" };
    };
    return { decls, run };
  }, [index, allRoutes, ncc, xtc]);

  // Vòng lặp tool-calling: model gọi công cụ -> client tra số thật -> trả lại tới khi có đáp án.
  async function askWithTools(q: string): Promise<string | null> {
    let contents: any[] = [{ role: "user", parts: [{ text: q }] }];
    for (let i = 0; i < 6; i++) {
      let d: any;
      try {
        const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "tools", contents, tools: tools.decls }) });
        d = await r.json();
      } catch { return null; }
      if (!d || d.status !== "ok") return null;
      const parts: any[] = d.parts || [];
      const fcPart = parts.find((p) => p.functionCall);
      if (fcPart) {
        const { name, args } = fcPart.functionCall;
        let result: any; try { result = tools.run(name, args || {}); } catch (e) { result = { error: String(e) }; }
        contents = [...contents, { role: "model", parts: [{ functionCall: fcPart.functionCall }] }, { role: "user", parts: [{ functionResponse: { name, response: { result } } }] }];
        continue;
      }
      const text = parts.map((p) => p.text).filter(Boolean).join("").trim();
      return text || null;
    }
    return null;
  }

  async function ask(q0?: string) {
    const q = (q0 ?? input).trim();
    if (!q || busy || hnInflight) return;
    const address = addressOf(getUser());
    const base: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(base); writeMsgs(base); setInput(""); setBusy(true);
    const qx = `${q}\n\n(Gọi tôi là "${address}".)`;
    // Chạy ở cấp module -> rời tab rồi quay lại vẫn chạy tiếp, KHÔNG mất câu trả lời.
    const p = (async () => {
      let reply: string | null = null;
      try {
        reply = await askWithTools(qx);
        if (reply == null) {
          // Dự phòng: hết khoá tool-calling -> trả lời từ ngữ cảnh tóm tắt.
          const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "askdata", id: "hoinhanh", messages: base.slice(-8), context: digest + `\n\n[XƯNG HÔ: gọi người dùng là "${address}"]` }) });
          reply = (await r.json())?.reply || "(không có phản hồi)";
        }
      } catch (e) {
        reply = "Lỗi: " + (e instanceof Error ? e.message : String(e));
      }
      // Chặn câu từ chối cụt lủn bằng tiếng Anh của model -> thay bằng lời tiếng Việt hữu ích.
      if (reply && /^\s*(i(['’]m| am)?\s+(sorry|unable|can[’'`]?t|cannot)|i can[’'`]?t help|as an ai|sorry,? i)/i.test(reply)) {
        reply = "Dạ câu này em chưa tra ra trên Dash ạ. Sếp thử hỏi cụ thể hơn giúp em — vd tên bưu cục/mã tuyến/biển số, hoặc \"… xin tăng cường mấy xe\", \"… có bị cấm tải không\". Em tra số thật rồi trả lời ngay ạ.";
      }
      const final: Msg[] = [...base, { role: "assistant", content: reply || "(không có phản hồi)" }];
      writeMsgs(final); // lưu ngay cả khi đã rời tab
      if (mountedRef.current) setMsgs(final);
    })();
    hnInflight = p;
    p.finally(() => { hnInflight = null; if (mountedRef.current) setBusy(false); });
  }

  return (
    <div className="section-card hn-card">
      <button className="hn-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hn-title">🤔 Hỏi nhanh <span className="hn-sub">— tuyến, biển số, NCC (liên hệ/SĐT), TLLD, xin tăng cường, cấm tải…</span></span>
        <span className="hn-caret">{open ? "⌄" : "›"}</span>
      </button>
      {open && (
        <div className="hn-body">
          {msgs.length > 0 && (
            <div className="hn-msgs">
              {msgs.map((m, i) => (
                <div key={i} className={"da-msg " + m.role}>
                  {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                </div>
              ))}
              {busy && <div className="da-msg assistant da-typing">Trợ lý đang tra dữ liệu…</div>}
              <div ref={endRef} />
            </div>
          )}
          {msgs.length === 0 && (
            <div className="hn-chips">
              {GỢI_Ý.map((g) => <button key={g} className="hn-chip" onClick={() => ask(g)}>{g}</button>)}
            </div>
          )}
          <div className="da-row" style={{ marginTop: 10 }}>
            <input className="pl-in" placeholder="Hỏi về tuyến, NCC, TLLD, sản lượng…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
            <button className="pl-calc" onClick={() => ask()} disabled={busy || !input.trim()}>Hỏi</button>
            {msgs.length > 0 && <button className="da-clear" onClick={() => setMsgs([])} title="Xoá hội thoại">✕</button>}
          </div>
        </div>
      )}
      <style>{`
        .hn-card{padding:0;overflow:hidden;border-left:4px solid var(--blue)}
        .hn-head{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;background:none;border:none;cursor:pointer;padding:13px 16px;text-align:left;font:inherit}
        .hn-title{font-size:15px;font-weight:800;color:var(--ink)}
        .hn-sub{font-weight:600;font-size:12px;color:var(--muted)}
        .hn-caret{font-size:18px;font-weight:800;color:var(--blue)}
        .hn-body{padding:0 16px 14px}
        .hn-msgs{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;padding:6px 2px}
        .hn-chips{display:flex;flex-wrap:wrap;gap:7px}
        .hn-chip{border:1px solid var(--line-2);background:var(--bg);color:#48586a;border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;transition:.14s}
        .hn-chip:hover{border-color:var(--blue);color:var(--blue);background:var(--white)}
        @media(max-width:640px){.hn-sub{display:none}}
      `}</style>
    </div>
  );
}
