import { useCallback, useEffect, useState } from "react";
import { getQA, submitQA, replyQA, deleteQA, type QAData } from "../lib/qa";
import { startPoll } from "../lib/poll";
import { useAdmin } from "../lib/useAdmin";

const p2 = (n: number) => String(n).padStart(2, "0");
function fmt(ts: number): string {
  const d = new Date(ts);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function QABoard() {
  const { isAdmin } = useAdmin(); // admin = đăng nhập email @ghn.vn
  const [data, setData] = useState<QAData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await getQA());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    // 15s + tự dừng khi tab ẩn (giảm tải server khi nhiều người mở nền).
    return startPoll(load, 15000);
  }, [load]);

  const total = data?.total ?? 0;
  const answered = data?.answered ?? 0;
  const pending = total - answered;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (msg.trim().length < 2) return;
    setSending(true);
    try {
      await submitQA(name, msg);
      setMsg("");
      setSent(true);
      setTimeout(() => setSent(false), 4000);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function onReply(id: string) {
    const text = (drafts[id] || "").trim();
    if (!text) return;
    try {
      await replyQA(id, text, isAdmin ? "admin" : "user", name);
      setDrafts((d) => ({ ...d, [id]: "" }));
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }
  async function onDelete(id: string) {
    if (!confirm("Xoá câu hỏi này?")) return;
    try {
      await deleteQA(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="qa" id="gop-y">
      <div className="qa-head">
        <h2>💬 Hỏi đáp &amp; Góp ý</h2>
        <div className="qa-badges">
          <span className="qa-badge pending" title="Số câu chưa được phản hồi">
            Chưa trả lời: <b>{pending}</b>
          </span>
          <span className="qa-badge done" title="Đã phản hồi / tổng số câu">
            Đã phản hồi <b>{answered}/{total}</b>
          </span>
          {isAdmin && (
            <span className="qa-admin-tag" title="Chế độ quản trị">★ Admin</span>
          )}
        </div>
      </div>

      <form className="qa-form" onSubmit={onSubmit}>
        <input
          className="qa-name"
          type="text"
          placeholder="Tên / Mã NV (không bắt buộc)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <textarea
          className="qa-msg"
          placeholder="Nhập câu hỏi hoặc góp ý về lịch tải, lộ trình, TLLD…"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
          maxLength={1500}
        />
        <button className="qa-send" type="submit" disabled={sending || msg.trim().length < 2}>
          {sending ? "Đang gửi…" : "Gửi góp ý"}
        </button>
      </form>
      {sent && <div className="qa-sent">✓ Đã gửi! Cảm ơn góp ý của bạn.</div>}
      {err && <div className="qa-err">Lỗi: {err}</div>}

      <div className="qa-list">
        {!data ? (
          <div className="qa-empty">Đang tải…</div>
        ) : data.items.length === 0 ? (
          <div className="qa-empty">Chưa có câu hỏi nào. Hãy là người đầu tiên góp ý!</div>
        ) : (
          data.items.map((q) => {
            const answeredItem = q.replies.length > 0;
            return (
              <div className={"qa-item" + (answeredItem ? " answered" : "")} key={q.id}>
                <div className="qa-q">
                  <div className="qa-meta">
                    <b>{q.name}</b> <span className="qa-time">{fmt(q.ts)}</span>
                    {answeredItem ? (
                      <span className="qa-tag done">Đã trả lời</span>
                    ) : (
                      <span className="qa-tag wait">Chờ trả lời</span>
                    )}
                    {isAdmin && (
                      <button className="qa-del" onClick={() => onDelete(q.id)} style={{ marginLeft: "auto" }}>
                        Xoá
                      </button>
                    )}
                  </div>
                  <div className="qa-text">{q.msg}</div>
                </div>

                {q.replies.length > 0 && (
                  <div className="qa-thread">
                    {q.replies.map((r, i) => (
                      <div className={"qa-bubble " + r.by} key={i}>
                        <div className="b-name">
                          {r.by === "admin" ? "M12SC" : r.name}
                          <span className="b-time">{fmt(r.ts)}</span>
                        </div>
                        <div className="b-text">{r.text}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={"qa-replybox" + (isAdmin ? " admin" : "")}>
                  <input
                    type="text"
                    placeholder={isAdmin ? "Phản hồi với vai trò M12SC…" : "Nhắn tiếp / trả lời…"}
                    value={drafts[q.id] || ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onReply(q.id);
                      }
                    }}
                  />
                  <button className="qa-reply" onClick={() => onReply(q.id)} disabled={!(drafts[q.id] || "").trim()}>
                    {isAdmin ? "Trả lời" : "Gửi"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
