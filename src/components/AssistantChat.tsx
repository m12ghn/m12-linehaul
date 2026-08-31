import { useEffect, useMemo, useRef, useState } from "react";
import { getKnowledge, addKnowledge, updateKnowledge, organizeKnowledge, type Fact } from "../lib/knowledge";
import { useReply } from "../lib/useReply";
import { usePersistentState } from "../lib/usePersistent";
import { RichText } from "./RichText";

interface Msg {
  role: "user" | "assistant";
  content: string;
  quote?: string;
}

/** Gộp đoạn trích vào nội dung gửi AI. */
const toApi = (m: Msg) => ({ role: m.role, content: m.quote ? `[Người dùng đang hỏi về đoạn: "${m.quote}"]\n${m.content}` : m.content });

/* Tiến trình trợ lý đang chạy + lưu hội thoại — sống ở cấp module để KHÔNG mất
 * khi người dùng chuyển tab rồi quay lại (component unmount/mount). */
const inflight = new Map<string, Promise<void>>();
const sKey = (id: string) => "m12:as.chat." + id; // trùng key usePersistentState bên dưới
const readStore = (id: string, fb: Msg[]): Msg[] => { try { const s = sessionStorage.getItem(sKey(id)); return s ? JSON.parse(s) : fb; } catch { return fb; } };
const writeStore = (id: string, msgs: Msg[]) => { try { sessionStorage.setItem(sKey(id), JSON.stringify(msgs)); } catch { /* bỏ qua */ } };

const GREETING =
  "Dạ chào Sếp 👋 Em là Trợ lý Lịch Tải. Sếp có thể: tải/đăng file mẫu ngay trên này, nói ý muốn sắp lịch, hoặc DẠY em kiến thức (gõ \"dạy: ...\") — em sẽ lọc ý chính, nhớ mãi và áp dụng cho mọi lần sắp lịch ạ.";

const TEACH_RE = /^(d[aạ]y|nh[oớ]|ghi nh[oớ])\b\s*[:：]?\s*/i;

export function AssistantChat({
  context,
  note,
  onTemplate,
  onUpload,
  chatId = "main",
  interpret,
}: {
  context?: string;
  note?: { id: number; text: string };
  onTemplate: () => void;
  onUpload: () => void;
  chatId?: string;
  /** Nếu có: thay vì chat thường, mỗi tin nhắn được component CHA "hiểu" và tự hành động
   *  trên Dash (điều hướng / điền form), trả về câu phản hồi. Nhận kèm lịch sử để fallback chat. */
  interpret?: (text: string, history: { role: string; content: string }[]) => Promise<string>;
}) {
  const [messages, setMessages] = usePersistentState<Msg[]>("as.chat." + chatId, [{ role: "assistant", content: GREETING }]);
  // Nội dung đang soạn: giữ qua chuyển tab/menu (sessionStorage) -> không mất khi quay lại.
  const [input, setInput] = usePersistentState<string>("as.draft." + chatId, "");
  const [sending, setSending] = useState(false);
  const { replyTo, setReplyTo, quote } = useReply();
  const mountedRef = useRef(true);

  // Giữ tiến trình khi quay lại tab: nếu còn request đang chạy cho chat này -> bám theo.
  useEffect(() => {
    mountedRef.current = true;
    const p = inflight.get(chatId);
    if (p) {
      setSending(true);
      p.then(() => { if (mountedRef.current) setMessages(readStore(chatId, messages)); })
        .finally(() => { if (mountedRef.current) setSending(false); });
    }
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  /** Chạy 1 lượt trợ lý: lưu hội thoại + giữ tiến trình dù rời tab. */
  function runAssistant(base: Msg[], worker: () => Promise<string>) {
    setMessages(base);
    writeStore(chatId, base);
    setSending(true);
    const p = (async () => {
      let content: string;
      try { content = await worker(); }
      catch (e) { content = "Lỗi kết nối trợ lý: " + (e instanceof Error ? e.message : String(e)); }
      const final = [...base, { role: "assistant" as const, content }];
      writeStore(chatId, final); // lưu ngay cả khi đã rời tab
      if (mountedRef.current) setMessages(final);
    })();
    inflight.set(chatId, p);
    p.finally(() => { inflight.delete(chatId); if (mountedRef.current) setSending(false); });
  }
  const [facts, setFacts] = useState<Fact[]>([]);
  const [showKb, setShowKb] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function saveEdit(f: Fact) {
    const t = editText.trim();
    if (!t) return;
    setSavingEdit(true);
    try {
      const items = await updateKnowledge(f.id, t, f.cat);
      setFacts(items);
      setEditId(null);
    } catch {
      /* giữ nguyên */
    } finally {
      setSavingEdit(false);
    }
  }
  // Gom kiến thức theo chủ đề để vẽ sơ đồ tư duy
  const groups = useMemo(() => {
    const m = new Map<string, Fact[]>();
    for (const f of facts) {
      const c = (f.cat || "Khác").trim() || "Khác";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(f);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [facts]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getKnowledge().then(setFacts);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);
  // Ghi chú từ ngoài (vd: kết quả upload) -> thêm vào chat
  useEffect(() => {
    if (note?.text) setMessages((m) => [...m, { role: "assistant", content: note.text }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Lượt DẠY kiến thức: chắt lọc/gộp + gán chủ đề; trả về câu xác nhận để hiển thị.
  async function teachWorker(text: string): Promise<string> {
    try {
      const org = await organizeKnowledge(text, facts);
      let items: Fact[];
      let note: string;
      if (org && org.action === "merge" && org.mergeId) {
        items = await updateKnowledge(org.mergeId, org.text, org.cat);
        note = `🔄 Dạ, ý này trùng nên em đã GỘP vào mục “${org.cat}”: “${org.text}”`;
      } else if (org && org.text) {
        items = await addKnowledge(org.text, org.cat);
        note = `📌 Dạ, em đã ghi nhớ vào mục “${org.cat}”: “${org.text}”`;
      } else {
        items = await addKnowledge(text);
        note = `📌 Dạ, em đã ghi nhớ: “${text}” (lát em tự sắp vào mục phù hợp ạ).`;
      }
      if (mountedRef.current) setFacts(items);
      return note;
    } catch {
      try { const items = await addKnowledge(text); if (mountedRef.current) setFacts(items); return `📌 Dạ, em đã ghi nhớ: “${text}”.`; }
      catch { return "Dạ em chưa lưu được, sếp thử lại giúp em nhé."; }
    }
  }

  function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const rq = replyTo;
    setReplyTo(null);
    // Người dùng DẠY kiến thức
    if (TEACH_RE.test(text)) {
      const base: Msg[] = [...messages, { role: "user", content: text }];
      runAssistant(base, () => teachWorker(text.replace(TEACH_RE, "").trim()));
      return;
    }
    const base: Msg[] = [...messages, { role: "user", content: text, ...(rq ? { quote: rq.text } : {}) }];
    // Chế độ AGENT: component cha tự "hiểu" + hành động trên Dash (điều hướng / điền form).
    if (interpret) {
      runAssistant(base, () => interpret(text, base.slice(-12).map(toApi)));
      return;
    }
    runAssistant(base, async () => {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: base.slice(-12).map(toApi), context }),
      });
      const data = await r.json();
      return data.reply || "(không có phản hồi)";
    });
  }

  function onDay() {
    const t = prompt("Dạy trợ lý điều cần nhớ mãi (vd: 'Xe 1900kg ưu tiên tuyến nội thành'):");
    if (t && t.trim()) runAssistant([...messages, { role: "user", content: "📌 Dạy: " + t.trim() }], () => teachWorker(t.trim()));
  }

  return (
    <div className="as-chat">
      <div className="as-head">
        🤖 Trợ lý sắp lịch
        <div className="as-tools">
          <button onClick={onTemplate} title="Tải file mẫu Excel"><i className="ti" />📥 Mẫu</button>
          <button onClick={onUpload} title="Đăng file lịch">⬆ Upload</button>
          <button onClick={() => setShowKb((v) => !v)} title="Kiến thức đã dạy">🧠 {facts.length}</button>
          <button onClick={onDay} title="Dạy trợ lý">📌 Dạy</button>
        </div>
      </div>

      {showKb && (
        <div className="as-kb">
          <div className="as-kb-h">🧠 Sơ đồ tư duy — Kiến thức trợ lý ({facts.length} mục · {groups.length} chủ đề)</div>
          {facts.length === 0 ? (
            <div className="as-kb-empty">Chưa có. Gõ "dạy: ..." hoặc bấm 📌 Dạy.</div>
          ) : (
            <div className="mindmap">
              <div className="mm-root">🤖<br />Trợ lý<br />Lịch Tải</div>
              <div className="mm-branches">
                {groups.map(([cat, items], gi) => (
                  <div className={"mm-branch c" + (gi % 6)} key={cat}>
                    <div className="mm-cat">{cat}<span className="mm-n">{items.length}</span></div>
                    <div className="mm-leaves">
                      {items.map((f) => (
                        <div className="mm-leaf" key={f.id}>
                          {editId === f.id ? (
                            <div className="mm-edit">
                              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} autoFocus />
                              <div className="mm-edit-act">
                                <button className="mm-cancel" onClick={() => setEditId(null)}>Huỷ</button>
                                <button className="mm-save" onClick={() => saveEdit(f)} disabled={savingEdit}>{savingEdit ? "Đang lưu…" : "Lưu"}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <span>{f.text}</span>
                              <button onClick={() => { setEditId(f.id); setEditText(f.text); }} title="Điều chỉnh nội dung">✏️</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="as-list" ref={listRef}>
        {messages.map((m, i) => (
          <div className={"as-msg " + m.role} key={i} data-msg>
            <div className="as-bubble">
              {m.quote && <div className="da-quote">↪ {m.quote}</div>}
              {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
            </div>
            <button className="da-reply-btn as-reply" title="Trả lời / hỏi về tin này (bôi đen 1 đoạn để trích đúng đoạn đó)" onClick={(e) => quote(m.content, m.role, e)}>↩ Trả lời</button>
          </div>
        ))}
        {sending && (
          <div className="as-msg assistant">
            <div className="as-bubble as-thinking">
              <span className="as-think-spin" aria-hidden /> 🤔 Trợ lý đang suy nghĩ
              <span className="as-dots"><i>.</i><i>.</i><i>.</i></span>
            </div>
          </div>
        )}
      </div>
      <style>{`
        .as-thinking{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--chart-2);background:linear-gradient(90deg,rgba(0,161,154,.10),rgba(0,161,154,.20),rgba(0,161,154,.10));background-size:200% 100%;animation:asShimmer 1.3s linear infinite}
        @keyframes asShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .as-think-spin{width:13px;height:13px;border:2px solid rgba(0,161,154,.35);border-top-color:var(--chart-2);border-radius:50%;display:inline-block;animation:asSpin .7s linear infinite}
        @keyframes asSpin{to{transform:rotate(360deg)}}
        .as-dots i{animation:asBlink 1.2s infinite both;font-weight:800}
        .as-dots i:nth-child(2){animation-delay:.2s}
        .as-dots i:nth-child(3){animation-delay:.4s}
        @keyframes asBlink{0%,80%,100%{opacity:.2}40%{opacity:1}}
      `}</style>

      {replyTo && (
        <div className="da-replybar">
          <span className="da-replybar-tag">↪ Đang trả lời {replyTo.role === "assistant" ? "trợ lý" : "bạn"}:</span>
          <span className="da-replybar-text">{replyTo.text}</span>
          <button className="da-replybar-x" onClick={() => setReplyTo(null)} title="Bỏ trích">✕</button>
        </div>
      )}
      <div className="as-input">
        <input
          type="text"
          placeholder={replyTo ? "Hỏi về đoạn đang trích…" : 'Nhập ý muốn sắp lịch, hoặc "dạy: ..." để trợ lý nhớ'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); send(); }
          }}
        />
        <button onClick={send} disabled={sending || !input.trim()}>Gửi</button>
      </div>
    </div>
  );
}
