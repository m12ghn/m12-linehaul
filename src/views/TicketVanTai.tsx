/* ============================================================
   TICKET VẬN TẢI — 07/09/2026: đọc log tin nhắn Telegram (30 group vùng vận
   tải), lọc ra các tin mang tính "yêu cầu GSVT xử lý" thành ticket, hiện kèm
   luồng phản hồi liên quan (dù không nằm chung 1 dòng trong Sheet gốc).
   Xem đầy đủ bối cảnh + logic gộp luồng ở src/lib/ticket.ts.

   MVP (Sếp chốt qua AskUserQuestion): chỉ hiển thị + lọc/tìm kiếm (tìm nội
   dung/người gửi, lọc theo loại yêu cầu, lọc theo nhóm Telegram) — CHƯA có
   cột trạng thái Mở/Đã xử lý, để dành đợt sau nếu cần.

   07/09/2026 (tối) — Sếp yêu cầu đổi 2 dropdown lọc (loại/nhóm) thành sidebar
   trái 2 tầng, thay vì hỏi lại (việc UI/UX rõ ràng, không đụng logic dữ liệu):
     Cột 1 "Nhóm Telegram" — chọn 1 nhóm (hoặc "Tất cả nhóm").
     Cột 2 "Loại yêu cầu" — chỉ liệt kê các loại CÓ MẶT trong nhóm đang chọn ở
       cột 1 (đúng nghĩa "loại ticket trong nhóm telegram đó" Sếp mô tả) — đổi
       nhóm ở cột 1 sẽ tự reset lựa chọn cột 2 về "Tất cả loại" vì danh sách
       loại có thể đã đổi hẳn. Đếm ở cột 1 KHÔNG phụ thuộc cột 2 (cột 1 luôn
       là tổng số ticket của từng nhóm, không đổi theo loại đang chọn).
   Ô tìm kiếm + danh sách ticket (thẻ, bấm mở rộng xem phản hồi) chuyển sang
   cột phải, giữ nguyên logic lọc/giới hạn hiển thị mặc định như trước.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { loadTickets, TICKET_CATEGORIES, type Ticket, type TicketData, type TicketCategory } from "../lib/ticket";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";
import { normSearch } from "../lib/normalize";
import { useMyRole } from "../lib/usePermissions";
import { getUser } from "../lib/useUser";
import {
  loadTicketStatus, setTicketStatus, addTicketNote, TICKET_STATUS_META,
  type TicketStatusData, type TicketStatusValue, type TicketStatusRow, type TicketNote,
} from "../lib/ticketStatus";

let cache: TicketData | null = null;
let statusCache: TicketStatusData | null = null;

/* 07/09/2026 (khuya) — yêu cầu #3: thêm bộ lọc Trạng thái. "closed" KHÔNG phải giá trị
   trong bảng ticket_status (Supabase) — chỉ là trạng thái HIỂN THỊ suy ra từ autoClosed
   (xem src/lib/ticket.ts) cho riêng loại "TC - Đăng ký mới (auto)" đã có phản hồi tự động
   Duyệt/Từ chối. "" (mặc định, chưa bấm lọc) = ẩn các ticket đã "closed" (đúng yêu cầu
   "không cần hiện lên nữa"); bấm rõ "Đóng" mới xem lại được. */
type StatusFilterValue = "" | TicketStatusValue | "closed";
const CLOSED_META = { label: "🔒 Đóng (tự động)", cls: "" };
function effectiveStatus(t: Ticket, statusRow?: TicketStatusRow): TicketStatusValue | "closed" {
  if (t.autoClosed) return "closed";
  return statusRow?.status || "open";
}

/** Nhãn ngắn + icon + màu (dùng lại .btbd-pill, xem index.css) cho từng loại yêu cầu. */
const CATEGORY_META: Record<TicketCategory, { icon: string; short: string; cls: string }> = {
  "Gắn/Lên App": { icon: "📲", short: "Gắn/Lên App", cls: "blue" },
  "Yêu cầu kết thúc app": { icon: "🔚", short: "Kết thúc app", cls: "ink" },
  "TC - Đăng ký mới (auto)": { icon: "🚛", short: "TC - Đăng ký mới", cls: "due" },
  "Yêu cầu bỏ điểm": { icon: "📍", short: "Bỏ điểm", cls: "warn" },
  "Lỗi app / cần xử lý tay app": { icon: "⚠️", short: "Lỗi app / xử lý tay", cls: "warn" },
  "Yêu cầu hủy tải": { icon: "❌", short: "Hủy tải", cls: "warn" },
  "Hỏi vị trí/tiến độ tải": { icon: "❓", short: "Hỏi vị trí/tiến độ", cls: "blue" },
  "Báo tình trạng hàng (ít/hết)": { icon: "📦", short: "Báo hàng ít/hết", cls: "due" },
  "Yêu cầu gán tài xế/xe": { icon: "🚚", short: "Gán tài xế/xe", cls: "blue" },
  "Yêu cầu xin/hỏi TC (thủ công)": { icon: "🙋", short: "Xin/hỏi TC (thủ công)", cls: "due" },
};

function fmtTime(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// ~2.700 ticket trong tổng log — giới hạn số dòng HIỂN THỊ khi chưa lọc gì (không cắt dữ liệu đã tải),
// giống đúng cách NhatKySuaChua (BTBD) đang làm.
const TICKET_DEFAULT_LIMIT = 200;

export function TicketVanTai() {
  const [data, setData] = useState<TicketData | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const [group, setGroup] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState(""); // 07/09 khuya, yêu cầu #4: ô tìm trong cột Nhóm Telegram
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(""); // yêu cầu #3
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusData, setStatusData] = useState<TicketStatusData | null>(statusCache);
  const { canDo } = useMyRole();
  const canManage = canDo("ticket-vt", "edit");
  const myEmail = getUser()?.email || "";

  useEffect(() => {
    let alive = true;
    const run = (force = false) => {
      setRefreshing(true);
      loadTickets(undefined, force)
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

  // Trạng thái/note (07/09/2026, yêu cầu #4) — tách poll riêng khỏi log Telegram
  // vì đọc từ Supabase (api/tickets.ts), không phải Sheet, và có thể đổi bởi
  // GSVT khác đang thao tác cùng lúc.
  useEffect(() => {
    let alive = true;
    const run = () => {
      loadTicketStatus()
        .then((d) => { if (alive) { statusCache = d; setStatusData(d); } })
        .catch(() => { /* không chặn xem ticket nếu phần trạng thái lỗi tải */ });
    };
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  // Cập nhật lạc quan (optimistic) ngay khi bấm — không đợi round-trip server —
  // rồi vẫn gọi API thật; nếu API báo lỗi thì tải lại đúng dữ liệu từ server để
  // không lệch (khác 401: setTicketStatus() đã tự forceReauth() sẵn).
  function applyStatusChange(ticketId: string, status: TicketStatusValue, myEmail: string) {
    const now = new Date().toISOString();
    setStatusData((prev) => {
      const next: TicketStatusData = { status: { ...(prev?.status || {}) }, notes: { ...(prev?.notes || {}) } };
      next.status[ticketId] = {
        status, updatedBy: myEmail, updatedAt: now,
        doneBy: status === "done" ? myEmail : null,
        doneAt: status === "done" ? now : null,
      };
      statusCache = next;
      return next;
    });
    setTicketStatus(ticketId, status).then((ok) => { if (!ok) loadTicketStatus().then((d) => { statusCache = d; setStatusData(d); }); });
  }

  function applyNewNote(ticketId: string, author: string, note: string) {
    setStatusData((prev) => {
      const next: TicketStatusData = { status: { ...(prev?.status || {}) }, notes: { ...(prev?.notes || {}) } };
      next.notes[ticketId] = [...(next.notes[ticketId] || []), { author, note, at: new Date().toISOString() }];
      statusCache = next;
      return next;
    });
  }

  const nq = normSearch(q);
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.tickets.filter((t) => {
      if (category && t.category !== category) return false;
      if (group && t.groupName !== group) return false;
      if (nq && !normSearch(t.content + " " + t.sender).includes(nq)) return false;
      const eff = effectiveStatus(t, statusData?.status[t.id]);
      // Mặc định (chưa bấm lọc trạng thái) ẩn ticket đã "closed" tự động — bấm rõ
      // "Đóng" ở cột Trạng thái mới xem lại (yêu cầu #2+#3, 07/09 khuya).
      if (statusFilter) { if (eff !== statusFilter) return false; }
      else if (eff === "closed") return false;
      return true;
    });
  }, [data, category, group, nq, statusFilter, statusData]);
  const hasFilter = !!(q || category || group || statusFilter);
  const shown = hasFilter ? filtered : filtered.slice(0, TICKET_DEFAULT_LIMIT);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.tickets || []) m.set(t.category, (m.get(t.category) || 0) + 1);
    return m;
  }, [data]);
  const topCategory = useMemo(() => {
    let best: [string, number] | null = null;
    for (const [k, v] of catCounts) if (!best || v > best[1]) best = [k, v];
    return best;
  }, [catCounts]);
  // Đếm theo nhóm (toàn bộ, KHÔNG phụ thuộc loại đang chọn) — dùng cho cả KPI lẫn cột 1 sidebar.
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.tickets || []) m.set(t.groupName, (m.get(t.groupName) || 0) + 1);
    return m;
  }, [data]);
  const topGroup = useMemo(() => {
    let best: [string, number] | null = null;
    for (const [k, v] of groupCounts) if (!best || v > best[1]) best = [k, v];
    return best;
  }, [groupCounts]);
  // 07/09/2026: cột 1 sidebar trước đây liệt kê nhóm theo A-Z (data.groupNames đã sort
  // alphabet ở lib/ticket.ts) — Sếp yêu cầu đổi sang xếp theo số lượng ticket giảm dần
  // (giống cột 2 "Loại yêu cầu" đã làm vậy từ đầu). Sort riêng ở component này (không
  // đụng data.groupNames gốc) vì đây chỉ là thứ tự HIỂN THỊ.
  const groupNamesByCount = useMemo(() => {
    return [...(data?.groupNames || [])].sort((a, b) => (groupCounts.get(b) || 0) - (groupCounts.get(a) || 0));
  }, [data, groupCounts]);

  // Đếm loại yêu cầu CHỈ trong phạm vi nhóm đang chọn ở cột 1 (rỗng = tất cả nhóm) — dùng cho cột 2 sidebar.
  const catCountsInScope = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.tickets || []) {
      if (group && t.groupName !== group) continue;
      m.set(t.category, (m.get(t.category) || 0) + 1);
    }
    return m;
  }, [data, group]);
  // Chỉ liệt kê các loại thực sự CÓ MẶT trong phạm vi đang chọn, xếp theo số lượng giảm dần.
  const categoriesInScope = useMemo(() => {
    return TICKET_CATEGORIES.filter((c) => (catCountsInScope.get(c) || 0) > 0).sort(
      (a, b) => (catCountsInScope.get(b) || 0) - (catCountsInScope.get(a) || 0)
    );
  }, [catCountsInScope]);
  const scopeTotal = group ? groupCounts.get(group) || 0 : data?.tickets.length || 0;

  // 07/09/2026 (khuya), yêu cầu #4: lọc DANH SÁCH hiển thị ở cột "Nhóm Telegram" theo ô tìm
  // (không đụng gì tới lựa chọn `group` đang chọn, chỉ thu hẹp các nút hiện ra) — "Tất cả
  // nhóm" luôn hiện, không bị lọc bởi ô tìm này.
  const groupNamesFiltered = useMemo(() => {
    const nq2 = normSearch(groupQuery);
    if (!nq2) return groupNamesByCount;
    return groupNamesByCount.filter((g) => normSearch(g).includes(nq2));
  }, [groupNamesByCount, groupQuery]);

  // 07/09/2026 (khuya), yêu cầu #3: đếm theo Trạng thái, phạm vi = nhóm + loại ĐANG chọn (đúng
  // kiểu "khoan sâu dần" Nhóm -> Loại -> Trạng thái, giống cách cột 2 đã scope theo cột 1).
  const statusCountsInScope = useMemo(() => {
    const m = new Map<StatusFilterValue, number>();
    for (const t of data?.tickets || []) {
      if (group && t.groupName !== group) continue;
      if (category && t.category !== category) continue;
      const eff = effectiveStatus(t, statusData?.status[t.id]);
      m.set(eff, (m.get(eff) || 0) + 1);
    }
    return m;
  }, [data, group, category, statusData]);
  const statusScopeTotalOpenish = (["open", "in_progress", "done"] as StatusFilterValue[])
    .reduce((sum, s) => sum + (statusCountsInScope.get(s) || 0), 0);

  // Chọn nhóm ở cột 1 -> luôn reset loại ở cột 2 (danh sách loại có thể đã đổi hẳn).
  function pickGroup(g: string) {
    setGroup(g);
    setCategory("");
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="page">
      <div className="section-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <div>
            <h2 style={{ margin: 0 }}>🎫 Ticket Vận Tải</h2>
            <p className="lead" style={{ margin: "4px 0 0" }}>
              Lọc từ log tin nhắn {data ? data.groupNames.length : "…"} nhóm Telegram vùng vận tải — tự làm mới mỗi {Math.round(REFRESH_MS / 1000)}s.
              {refreshing && !loading && <span style={{ marginLeft: 8, color: "var(--muted)" }}>⏳ đang làm mới…</span>}
            </p>
          </div>
          <button className="re-btn" onClick={() => loadTickets(undefined, true).then((d) => { cache = d; setData(d); })} disabled={refreshing}>
            🔄 Làm mới
          </button>
        </div>
      </div>

      {loading ? (
        <div className="state"><div className="spinner" /><div className="big">Đang tải log Telegram…</div></div>
      ) : err && !data ? (
        <div className="state">
          <div className="big">Không tải được dữ liệu</div>
          <div><code>{err}</code></div>
        </div>
      ) : !data ? null : (
        <>
          <div className="kpi-row" style={{ marginTop: 16 }}>
            <div className="kpi"><div className="lbl">Tổng ticket</div><div className="val">{data.tickets.length.toLocaleString("vi-VN")}</div><div className="note">Trong {data.groupNames.length} nhóm Telegram</div></div>
            {/* 07/09/2026: 2 thẻ dưới đây trước chỉ hiển thị chữ, không bấm được — đây đúng
                là chỗ Sếp bấm mà danh sách bên phải không lọc theo. Giờ bấm được, lọc y hệt
                bấm vào mục tương ứng ở sidebar trái (reset về đúng phạm vi TOÀN CỤM vì cả 2
                số này đều tính trên toàn bộ ticket, không theo phạm vi đang chọn). */}
            <div
              className="kpi ink kpi-click"
              role="button" tabIndex={0}
              onClick={() => topCategory && setCategory(topCategory[0])}
              onKeyDown={(e) => { if (e.key === "Enter" && topCategory) setCategory(topCategory[0]); }}
              title={topCategory ? "Bấm để lọc theo loại này" : undefined}
            >
              <div className="lbl">Loại yêu cầu nhiều nhất</div><div className="val" style={{ fontSize: 16 }}>{topCategory ? CATEGORY_META[topCategory[0] as TicketCategory]?.short || topCategory[0] : "—"}</div><div className="note">{topCategory ? `${topCategory[1].toLocaleString("vi-VN")} ticket` : "—"}</div>
            </div>
            <div
              className="kpi green kpi-click"
              role="button" tabIndex={0}
              onClick={() => topGroup && pickGroup(topGroup[0])}
              onKeyDown={(e) => { if (e.key === "Enter" && topGroup) pickGroup(topGroup[0]); }}
              title={topGroup ? "Bấm để lọc theo nhóm này" : undefined}
            >
              <div className="lbl">Nhóm nhiều ticket nhất</div><div className="val" style={{ fontSize: 16 }}>{topGroup ? topGroup[0] : "—"}</div><div className="note">{topGroup ? `${topGroup[1].toLocaleString("vi-VN")} ticket` : "—"}</div>
            </div>
            <div className="kpi"><div className="lbl">Mới nhất</div><div className="val" style={{ fontSize: 18 }}>{data.tickets[0] ? fmtTime(data.tickets[0].time) : "—"}</div><div className="note">{data.tickets[0]?.groupName || "—"}</div></div>
          </div>

          <div className="section-card" style={{ marginTop: 16 }}>
            <div className="ticket-layout">
              <div className="ticket-side">
                <div className="ticket-side-section">
                  <div className="ticket-side-title">Nhóm Telegram</div>
                  <input
                    className="ticket-side-filter"
                    placeholder="Tìm nhóm…"
                    value={groupQuery}
                    onChange={(e) => setGroupQuery(e.target.value)}
                  />
                  <button className={"ticket-side-item" + (group === "" ? " active" : "")} onClick={() => pickGroup("")}>
                    <span>Tất cả nhóm</span><span className="cnt">{data.tickets.length}</span>
                  </button>
                  {groupNamesFiltered.map((g) => (
                    <button key={g} className={"ticket-side-item" + (group === g ? " active" : "")} onClick={() => pickGroup(g)}>
                      <span>{g}</span><span className="cnt">{groupCounts.get(g) || 0}</span>
                    </button>
                  ))}
                  {groupNamesFiltered.length === 0 && <p className="lead" style={{ margin: "4px 8px", fontSize: 12.5 }}>Không có nhóm nào khớp.</p>}
                </div>
                <div className="ticket-side-section">
                  <div className="ticket-side-title">Loại yêu cầu{group ? ` — trong "${group}"` : ""}</div>
                  <button className={"ticket-side-item" + (category === "" ? " active" : "")} onClick={() => setCategory("")}>
                    <span>Tất cả loại</span><span className="cnt">{scopeTotal}</span>
                  </button>
                  {categoriesInScope.map((c) => (
                    <button key={c} className={"ticket-side-item" + (category === c ? " active" : "")} onClick={() => setCategory(c)}>
                      <span>{CATEGORY_META[c].icon} {CATEGORY_META[c].short}</span><span className="cnt">{catCountsInScope.get(c) || 0}</span>
                    </button>
                  ))}
                </div>
                <div className="ticket-side-section">
                  {/* 07/09/2026 (khuya), yêu cầu #3. "Tất cả trạng thái" = mặc định, KHÔNG tính
                      ticket đã "Đóng" tự động (khớp đúng hành vi mặc định của bộ lọc `filtered`
                      ở trên) — bấm rõ dòng "Đóng" bên dưới mới xem lại các ticket đó. */}
                  <div className="ticket-side-title">Trạng thái{category ? ` — "${CATEGORY_META[category as TicketCategory]?.short || category}"` : ""}</div>
                  <button className={"ticket-side-item" + (statusFilter === "" ? " active" : "")} onClick={() => setStatusFilter("")}>
                    <span>Tất cả trạng thái</span><span className="cnt">{statusScopeTotalOpenish}</span>
                  </button>
                  {(["open", "in_progress", "done"] as StatusFilterValue[]).map((s) => (
                    <button key={s} className={"ticket-side-item" + (statusFilter === s ? " active" : "")} onClick={() => setStatusFilter(s)}>
                      <span>{TICKET_STATUS_META[s as TicketStatusValue].label}</span><span className="cnt">{statusCountsInScope.get(s) || 0}</span>
                    </button>
                  ))}
                  <button className={"ticket-side-item" + (statusFilter === "closed" ? " active" : "")} onClick={() => setStatusFilter("closed")}>
                    <span>{CLOSED_META.label}</span><span className="cnt">{statusCountsInScope.get("closed") || 0}</span>
                  </button>
                </div>
              </div>

              <div className="ticket-main">
                <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  <div className="search-box" style={{ maxWidth: 320 }}>
                    <input placeholder="Tìm nội dung/người gửi…" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                  <span className="lead" style={{ alignSelf: "center" }}>
                    {hasFilter ? `${shown.length} / ${filtered.length} ticket khớp` : `Đang hiện ${shown.length} ticket mới nhất / ${filtered.length} tổng — lọc để xem hết`}
                  </span>
                </div>

                {shown.length === 0 ? (
                  <p className="lead">Không có ticket nào khớp bộ lọc.</p>
                ) : (
                  <div className="ticket-list">
                    {shown.map((t) => (
                      <TicketCard
                        key={t.id}
                        t={t}
                        open={expanded.has(t.id)}
                        onToggle={() => toggle(t.id)}
                        statusRow={statusData?.status[t.id]}
                        notes={statusData?.notes[t.id] || []}
                        canManage={canManage}
                        onChangeStatus={(s) => applyStatusChange(t.id, s, myEmail)}
                        onAddNote={(note) => {
                          applyNewNote(t.id, myEmail, note);
                          addTicketNote(t.id, note).then((saved) => {
                            if (!saved) loadTicketStatus().then((d) => { statusCache = d; setStatusData(d); });
                          });
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface TicketCardProps {
  t: Ticket;
  open: boolean;
  onToggle: () => void;
  statusRow?: TicketStatusRow;
  notes: TicketNote[];
  canManage: boolean;
  onChangeStatus: (s: TicketStatusValue) => void;
  onAddNote: (note: string) => void;
}

/* 07/09/2026 (yêu cầu #4): trạng thái xử lý + nhật ký ghi chú, hiện NGAY dưới
   thẻ ticket (không đợi mở rộng) để GSVT thấy trạng thái khi lướt danh sách;
   phần chi tiết (đổi trạng thái + note) gói trong 1 khung riêng, tự mở rộng
   nếu ticket ĐÃ có note (để không mất log cũ), thu gọn mặc định nếu chưa có gì. */
function TicketCard({ t, open, onToggle, statusRow, notes, canManage, onChangeStatus, onAddNote }: TicketCardProps) {
  const meta = CATEGORY_META[t.category];
  const status = statusRow?.status || "open";
  // 07/09/2026 (khuya): ticket "TC - Đăng ký mới (auto)" đã tự "Đóng" (t.autoClosed, xem
  // ticket.ts) -> LUÔN hiện pill "Đóng" bất kể trạng thái thủ công trong ticket_status (nếu
  // có), và ẩn hẳn nút đổi trạng thái bên dưới (bấm vào cũng không đổi được gì trên pill vì
  // autoClosed luôn thắng — ẩn đi cho khỏi rối, tránh nút "chết").
  const statusMeta = t.autoClosed ? CLOSED_META : TICKET_STATUS_META[status];
  const [noteOpen, setNoteOpen] = useState(notes.length > 0);
  const [draft, setDraft] = useState("");

  function submitNote() {
    const v = draft.trim();
    if (!v) return;
    onAddNote(v);
    setDraft("");
  }

  return (
    <div className="ticket-card">
      <div className="ticket-head">
        <span className={"btbd-pill" + (meta.cls ? " " + meta.cls : "")}>{meta.icon} {meta.short}</span>
        <span className={"btbd-pill" + (statusMeta.cls ? " " + statusMeta.cls : "")}>{statusMeta.label}</span>
        <span className="ticket-time">{fmtTime(t.time)}</span>
        <span className="ticket-group">{t.groupName}</span>
        {t.ticketCode && <span className="ticket-code">{t.ticketCode}</span>}
      </div>
      <div className="ticket-sender">{t.sender || "—"}</div>
      <div className="ticket-content">{t.content || <span className="lead">(không có nội dung text)</span>}</div>
      {t.replies.length > 0 && (
        <button className="ticket-reply-toggle" onClick={onToggle}>
          {open ? "▲ Thu gọn" : `▼ Xem ${t.replies.length} phản hồi liên quan`}
        </button>
      )}
      {open && (
        <div className="ticket-replies">
          {t.replies.map((r, i) => (
            <div className="ticket-reply" key={i}>
              <div className="ticket-reply-head">
                <b>{r.sender || "—"}</b>
                <span className="ticket-time">{fmtTime(r.time)}</span>
                {r.viaTicketCode ? <span className="lead">· khớp theo mã ticket</span> : null}
              </div>
              <div className="ticket-reply-content">{r.content}</div>
            </div>
          ))}
        </div>
      )}

      <button className="ticket-reply-toggle" onClick={() => setNoteOpen((v) => !v)}>
        {noteOpen ? "▲ Thu gọn xử lý & ghi chú" : `📝 Xử lý & ghi chú${notes.length ? ` (${notes.length})` : ""}`}
      </button>
      {noteOpen && (
        <div className="ticket-notes">
          {t.autoClosed && (
            <div className="ticket-status-meta">
              Tự động chuyển "Đóng" — phát hiện phản hồi <b>{t.autoCloseReason === "approved" ? "Đã duyệt" : "Từ chối"}</b>
              {t.ticketCode ? <> (mã {t.ticketCode})</> : null}.
            </div>
          )}
          {canManage && !t.autoClosed && (
            <div className="ticket-status-actions">
              {(Object.keys(TICKET_STATUS_META) as TicketStatusValue[]).map((s) => (
                <button
                  key={s}
                  className={"ticket-status-btn" + (status === s ? " active " + TICKET_STATUS_META[s].cls : "")}
                  onClick={() => onChangeStatus(s)}
                  disabled={status === s}
                >
                  {TICKET_STATUS_META[s].label}
                </button>
              ))}
            </div>
          )}
          {statusRow?.updatedBy && (
            <div className="ticket-status-meta">
              Cập nhật gần nhất: <b>{statusRow.updatedBy}</b> · {fmtTime(new Date(statusRow.updatedAt))}
              {statusRow.doneBy && status === "done" && <> · Đã xử lý bởi <b>{statusRow.doneBy}</b></>}
            </div>
          )}
          {notes.length > 0 && (
            <div className="ticket-note-log">
              {notes.map((n, i) => (
                <div className="ticket-note" key={i}>
                  <div className="ticket-reply-head">
                    <b>{n.author}</b>
                    <span className="ticket-time">{fmtTime(new Date(n.at))}</span>
                  </div>
                  <div className="ticket-reply-content">{n.note}</div>
                </div>
              ))}
            </div>
          )}
          {canManage ? (
            <div className="ticket-note-form">
              <textarea
                placeholder="Ghi chú xử lý (vd: đã liên hệ tài xế, đang chờ xác nhận kho…)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
              />
              <button className="re-btn" onClick={submitNote} disabled={!draft.trim()}>Lưu ghi chú</button>
            </div>
          ) : notes.length === 0 && !statusRow?.updatedBy ? (
            <p className="lead" style={{ margin: 0 }}>Chưa có ghi chú xử lý.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
