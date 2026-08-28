import { useEffect, useMemo, useRef, useState } from "react";
import { loadNccVT, nccVTDigest, type NccVTData } from "../lib/nccVT";
import { loadNccFixedCapacity, type NccCapacityData } from "../lib/nccFixedCapacity";
import { matchNccName, type NccConfidence } from "../lib/nccName";
import { NccProfileCard } from "../components/NccProfileCard";
import { AssistantChat } from "../components/AssistantChat";
import { normSearch } from "../lib/normalize";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";
import { navTo, setPendingTcSub } from "../lib/nav";
import { useMyRole } from "../lib/usePermissions";

/**
 * Performance NCC (trước là "DS NCC VT") — hồ sơ tổng về NCC vận tải: danh bạ liên
 * hệ + hồ sơ năng lực tự khai + năng lực cấp xe cố định tính từ lịch tải thật.
 * Trợ lý AI được nạp dữ liệu này để trả lời khi Sếp hỏi về NCC.
 */
let cache: NccVTData | null = null;
let capCache: NccCapacityData | null = null;
const tel = (s: string) => (s || "").replace(/[^\d]/g, "");

export function DsNcc() {
  const [data, setData] = useState<NccVTData | null>(cache);
  const [cap, setCap] = useState<NccCapacityData | null>(capCache);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [mien, setMien] = useState<string>("");
  const [sel, setSel] = useState<string>(""); // công ty đang chọn (key)
  const inputRef = useRef<HTMLInputElement>(null);
  const { canSub } = useMyRole();
  const canContact = canSub("ds-ncc", "contact");
  const canGd = canSub("ds-ncc", "gd");

  useEffect(() => {
    let alive = true;
    const run = () => { setRefreshing(true); loadNccVT().then((d) => { if (alive && d.ok) { cache = d; setData(d); } }).catch(() => {}).finally(() => { if (alive) setRefreshing(false); }); };
    if (!cache) run(); else setData(cache);
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => { loadNccFixedCapacity().then((d) => { if (alive) { capCache = d; setCap(d); } }).catch(() => {}); };
    if (!capCache) run(); else setCap(capCache);
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  const list = data?.list ?? [];
  const miens = useMemo(() => [...new Set(list.map((n) => n.mien).filter(Boolean))].sort(), [list]);
  const nq = normSearch(q);

  // GOM THEO CÔNG TY: 1 công ty có thể có nhiều dòng (nhiều miền/khu vực) -> gộp lại.
  interface NccGroup { key: string; ten: string; mien: string; khuVuc: string; status: string; rows: typeof list }
  const groups = useMemo<NccGroup[]>(() => {
    const m = new Map<string, { ten: string; status: string; mien: Set<string>; khu: Set<string>; rows: typeof list }>();
    for (const n of list) {
      const key = normSearch(n.ten) || n.ten;
      let g = m.get(key);
      if (!g) { g = { ten: n.ten, status: n.status, mien: new Set(), khu: new Set(), rows: [] }; m.set(key, g); }
      if (n.mien) g.mien.add(n.mien);
      if (n.khuVuc) g.khu.add(n.khuVuc);
      g.rows.push(n);
    }
    return [...m.entries()]
      .map(([key, g]) => ({ key, ten: g.ten, status: g.status, mien: [...g.mien].join(", "), khuVuc: [...g.khu].join(" · "), rows: g.rows }))
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi"));
  }, [list]);

  // Khớp NCC lịch tải (tên ngắn) <-> công ty TT NCC (tên đầy đủ) -> mức dùng + năng lực cố định.
  const fullNames = useMemo(() => groups.map((g) => g.ten), [groups]);
  const nccMatch = useMemo(() => {
    const out = new Map<string, { usage: NccCapacityData["usage"][number] | null; capacity: NccCapacityData["capacity"]; confidence: NccConfidence }>();
    for (const g of groups) out.set(g.ten, { usage: null, capacity: [], confidence: "none" });
    if (cap) {
      for (const u of cap.usage) {
        const m = matchNccName(u.name, fullNames);
        if (m.confidence === "none") continue;
        const e = out.get(m.ten);
        if (e) { e.usage = u; e.confidence = m.confidence; }
      }
      for (const c of cap.capacity) {
        const m = matchNccName(c.name, fullNames);
        if (m.confidence === "none") continue;
        out.get(m.ten)?.capacity.push(c);
      }
    }
    return out;
  }, [cap, groups, fullNames]);

  // Sắp theo THỨ TỰ NCC M12 ĐANG DÙNG — nhiều tuyến/điểm dừng nhất lên đầu; NCC
  // chưa từng chạy tuyến nào xếp cuối theo alphabet.
  const orderedGroups = useMemo(() => [...groups].sort((a, b) => {
    const ua = nccMatch.get(a.ten)?.usage?.stops || 0;
    const ub = nccMatch.get(b.ten)?.usage?.stops || 0;
    return ub - ua || a.ten.localeCompare(b.ten, "vi");
  }), [groups, nccMatch]);

  // Lọc danh sách CHỌN theo miền + tìm kiếm.
  const filtered = useMemo(() => orderedGroups.filter((g) => {
    if (mien && !g.mien.split(", ").includes(mien)) return false;
    if (!nq) return true;
    const blob = [g.ten, g.mien, g.khuVuc, ...g.rows.flatMap((r) => [r.lhTen, r.lhSdt, r.gdTen, r.gdSdt, r.email, r.diaChi])].join(" ");
    return normSearch(blob).includes(nq);
  }), [orderedGroups, nq, mien]);

  // Mặc định chọn công ty ĐẦU danh sách (NCC dùng nhiều nhất). Trước khi Sếp tự bấm chọn,
  // LUÔN bám theo filtered[0] — vì lúc mới vào trang, năng lực cấp xe (cap) chưa tải xong
  // nên thứ tự tạm thời là alphabet; khi cap tải xong danh sách sắp lại theo mức dùng thật,
  // lựa chọn mặc định phải cập nhật theo chứ không "kẹt" ở công ty alphabet-đầu ban đầu.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (!filtered.length) { setSel(""); return; }
    if (!userPicked || !filtered.some((g) => g.key === sel)) setSel(filtered[0].key);
  }, [filtered, sel, userPicked]);
  const cur = filtered.find((g) => g.key === sel) || filtered[0] || null;

  // Ngữ cảnh cho trợ lý: toàn bộ danh bạ NCC (gọn) -> hỏi là trả lời được, cập nhật realtime.
  // Vai trò bị khoá "contact"/"gd" thì cũng ẨN PII khỏi ngữ cảnh AI — tránh lộ qua chat
  // dù UI đã khoá (nếu không, hỏi trợ lý là lấy được số điện thoại đã khoá trên màn hình).
  const ctx = useMemo(() => {
    if (!list.length) return "Chưa tải được danh sách NCC.";
    const safeList = (canContact && canGd) ? list : list.map((n) => ({
      ...n,
      lhTen: canContact ? n.lhTen : "", lhSdt: canContact ? n.lhSdt : "", lhChuc: canContact ? n.lhChuc : "",
      gdTen: canGd ? n.gdTen : "", gdSdt: canGd ? n.gdSdt : "", gdChuc: canGd ? n.gdChuc : "",
    }));
    return `DANH SÁCH NCC VẬN TẢI (${list.length} nhà cung cấp — dữ liệu realtime từ sheet TT CC). Khi Sếp hỏi về NCC (thông tin liên hệ, khu vực hoạt động, giám đốc, email, địa chỉ, miền, năng lực, giá cả) hãy trả lời ĐÚNG theo danh sách này, không bịa:\n${nccVTDigest(safeList)}`;
  }, [list, canContact, canGd]);

  async function askNcc(_text: string, history: { role: string; content: string }[]): Promise<string> {
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "askdata", id: "ds-ncc", messages: history, context: ctx }) });
      return (await r.json())?.reply || "(không có phản hồi)";
    } catch (e) { return "Lỗi kết nối trợ lý: " + (e instanceof Error ? e.message : String(e)); }
  }


  return (
    <div>
      <div className="section-card tc-head">
        <h2 style={{ marginBottom: 2, fontSize: 17 }}>📇 Performance NCC</h2>
        <p className="lead" style={{ margin: 0, fontSize: 14 }}>
Chọn công ty ở danh sách bên dưới để xem hồ sơ đầy đủ — <b>{groups.length}</b> NCC vận tải, xếp theo <b>mức đang dùng thật</b>: miền, khu vực, năng lực xe/giá cả/phạm vi tự khai, năng lực cấp xe cố định tính từ lịch tải{(canContact || canGd) ? ", người liên hệ, giám đốc" : ""}. Hỏi trợ lý bên dưới cũng được.
          {data?.lastSync ? ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}{refreshing ? " · đồng bộ…" : ""}
        </p>
        <p className="lead" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
          Cần xem <b>lịch chạy hôm nay theo NCC</b>? → <button onClick={() => { setPendingTcSub("ncc"); navTo({ view: "tang-cuong" }); }} style={{ border: "none", background: "none", color: "var(--blue)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13.5 }}>xem Vùng HCM · Lịch TC theo NCC</button>
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="xtc-seg">
            <button className={mien === "" ? "on" : ""} onClick={() => setMien("")}>Tất cả</button>
            {miens.map((m) => <button key={m} className={mien === m ? "on" : ""} onClick={() => setMien(m)}>{m}</button>)}
          </div>
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
            <input ref={inputRef} className="pl-in" style={{ width: "100%", paddingRight: 28 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Tìm NCC: tên công ty, khu vực, người liên hệ, SĐT…" />
            {q && <button onClick={() => { setQ(""); inputRef.current?.focus(); }} title="Xoá" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>✕</button>}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải danh sách NCC…</div>
      ) : !data.ok ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Chưa đọc được sheet NCC (kiểm tra chia sẻ công khai).</div>
      ) : (
        <div className="nvt-split">
          {/* CỘT CHỌN: danh sách công ty (đã gom theo cty) */}
          <div className="section-card nvt-list">
            <div className="nvt-list-h">{filtered.length} công ty{mien ? ` · ${mien}` : ""}</div>
            {filtered.length === 0 ? (
              <div className="sl-empty" style={{ padding: 16 }}>Không có công ty nào khớp.</div>
            ) : filtered.map((g) => (
              <button key={g.key} className={"nvt-item" + (cur && g.key === cur.key ? " on" : "")} onClick={() => { setUserPicked(true); setSel(g.key); }}>
                <span className="nvt-item-ten">{g.ten}</span>
                <span className="nvt-item-sub">{g.mien || "—"}{g.rows.length > 1 ? ` · ${g.rows.length} dòng` : ""}</span>
              </button>
            ))}
          </div>

          {/* CỘT CHI TIẾT: thông tin công ty đang chọn */}
          <div className="section-card nvt-detail">
            {!cur ? <div className="sl-empty">Chọn 1 công ty để xem chi tiết.</div> : (
              <>
                <div className="nvt-d-ten">🏢 {cur.ten}{cur.status ? <span className="nvt-badge">{cur.status}</span> : null}</div>
                <div className="nvt-d-row"><span className="nvt-d-lb">Miền</span><b>{cur.mien || "—"}</b></div>
                <div className="nvt-d-row"><span className="nvt-d-lb">Khu vực hoạt động</span><span>{cur.khuVuc || "—"}</span></div>

                <NccProfileCard
                  rows={cur.rows}
                  usage={nccMatch.get(cur.ten)?.usage || null}
                  capacity={nccMatch.get(cur.ten)?.capacity || []}
                  matchConfidence={nccMatch.get(cur.ten)?.confidence || null}
                />

                {cur.rows.map((n, i) => (
                  <div className="nvt-d-block" key={i}>
                    {cur.rows.length > 1 && <div className="nvt-d-blocktag">Dòng {i + 1}{n.mien ? ` · ${n.mien}` : ""}{n.khuVuc ? ` · ${n.khuVuc}` : ""}</div>}
                    <div className="nvt-d-people">
                      {canContact ? (
                        <div className="nvt-d-person">
                          <div className="nvt-d-plb">👤 Người liên hệ</div>
                          {n.lhTen ? <div><b>{n.lhTen}</b>{n.lhChuc ? <span className="nvt-role"> · {n.lhChuc}</span> : ""}</div> : <div className="tc-empty">—</div>}
                          {n.lhSdt && <a href={`tel:${tel(n.lhSdt)}`} className="nvt-tel">📞 {n.lhSdt}</a>}
                        </div>
                      ) : (
                        <div className="nvt-d-person nvt-locked">
                          <div className="nvt-d-plb">👤 Người liên hệ</div>
                          <div className="tc-empty">🔒 Không có quyền xem</div>
                        </div>
                      )}
                      {canGd ? (
                        <div className="nvt-d-person">
                          <div className="nvt-d-plb">🧑‍💼 Giám đốc / Chủ DN</div>
                          {n.gdTen ? <div><b>{n.gdTen}</b>{n.gdChuc ? <span className="nvt-role"> · {n.gdChuc}</span> : ""}</div> : <div className="tc-empty">—</div>}
                          {n.gdSdt && <a href={`tel:${tel(n.gdSdt)}`} className="nvt-tel">📞 {n.gdSdt}</a>}
                        </div>
                      ) : (
                        <div className="nvt-d-person nvt-locked">
                          <div className="nvt-d-plb">🧑‍💼 Giám đốc / Chủ DN</div>
                          <div className="tc-empty">🔒 Không có quyền xem</div>
                        </div>
                      )}
                    </div>
                    {n.email && <div className="nvt-d-row"><span className="nvt-d-lb">Email</span><span className="nvt-email">{n.email}</span></div>}
                    {n.diaChi && <div className="nvt-d-row"><span className="nvt-d-lb">Địa chỉ</span><span>📍 {n.diaChi}</span></div>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <div className="section-card" style={{ marginTop: 12 }}>
        <AssistantChat chatId="dsncc" context={ctx} interpret={askNcc} onTemplate={() => {}} onUpload={() => {}} />
      </div>
    </div>
  );
}
