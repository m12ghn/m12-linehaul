import { useEffect, useRef, useState } from "react";
import { usePersistentState } from "../lib/usePersistent";
import { useAdmin } from "../lib/useAdmin";
import { getUser, addressOf } from "../lib/useUser";
import { isTeach, teachKnowledge } from "../lib/knowledge";
import { RichText } from "./RichText";

interface Msg { role: "user" | "assistant"; content: string; quote?: string }
interface Extra { at: number; source: string; chars: number }

/** Gộp đoạn trích vào nội dung gửi cho trợ lý (để model biết đang hỏi về đoạn nào). */
const toApi = (m: Msg) => ({ role: m.role, content: m.quote ? `[Người dùng đang hỏi về đoạn: "${m.quote}"]\n${m.content}` : m.content });

const fmtTime = (at: number) =>
  at ? new Date(at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "";
const shortSrc = (s: string) => (s.length > 46 ? s.slice(0, 44) + "…" : s);

/**
 * Phân tích tự động hằng ngày (09:00) cho 1 mục số liệu + chat hỏi đáp.
 * - id: khoá lưu KV (phân biệt từng mục).
 * - digest: số liệu hiện tại (chuỗi) để phân tích & làm ngữ cảnh chat.
 */
export function DailyAnalysis({ id, digest, title, sub, tools }: {
  id: string; digest: string; title: string; sub: string;
  tools?: { decls: any[]; run: (name: string, args: any) => any };
}) {
  const { isAdmin } = useAdmin();
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"" | "ok" | "stale" | "waiting" | "error" | "loading">("");
  const [at, setAt] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = usePersistentState("da.collapse." + id, false);

  const [msgs, setMsgs] = usePersistentState<Msg[]>("da.chat." + id, []);
  // Giữ nội dung đang soạn khi chuyển tab/menu.
  const [input, setInput] = usePersistentState<string>("da.draft." + id, "");
  const [chatBusy, setChatBusy] = useState(false);
  const [extra, setExtra] = useState<Extra[]>([]);
  const [replyTo, setReplyTo] = useState<{ role: "user" | "assistant"; text: string } | null>(null);

  const digestRef = useRef(digest);
  digestRef.current = digest;
  const msgsEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trích 1 tin nhắn (hoặc đoạn đang bôi đen trong tin đó) để trả lời.
  function quoteMsg(m: Msg, e: React.MouseEvent) {
    const sel = window.getSelection();
    const box = (e.currentTarget as HTMLElement).closest(".da-msg");
    let text = "";
    if (sel && !sel.isCollapsed && box && box.contains(sel.anchorNode)) text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) text = m.content.replace(/\s+/g, " ").trim();
    if (text.length > 180) text = text.slice(0, 178) + "…";
    setReplyTo({ role: m.role, text });
    inputRef.current?.focus();
  }

  async function dashdata(payload: any) {
    const r = await fetch("/api/dashdata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    return r.json();
  }
  async function refreshExtra() {
    try { const d = await dashdata({ action: "get" }); if (d?.ok) setExtra(d.items || []); } catch { /* bỏ qua */ }
  }
  async function clearExtra() {
    if (!confirm("Xoá toàn bộ dữ liệu đã nạp thêm cho mục này?")) return;
    try { const d = await dashdata({ action: "clear" }); if (d?.ok) setExtra([]); } catch { /* bỏ qua */ }
  }

  async function load(force: boolean) {
    const dg = digestRef.current;
    if (force) setBusy(true); else setStatus("loading");
    try {
      const r = await fetch("/api/daily", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, digest: dg, force }),
      });
      const d = await r.json();
      setStatus(d?.status || "error");
      setResult(d?.text || "");
      setAt(d?.at || 0);
      setErrMsg(d?.errMsg || "");
    } catch (e) {
      setStatus("error");
      setResult("");
      setErrMsg("Lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Tự nạp bản phân tích + dữ liệu đã lưu khi có số liệu (và khi đổi mục) — chỉ admin.
  const hasDigest = digest.trim().length > 0;
  useEffect(() => {
    if (!isAdmin) return;
    if (hasDigest) load(false);
    refreshExtra();
    // eslint-disable-next-line
  }, [id, hasDigest, isAdmin]);

  useEffect(() => { msgsEnd.current?.scrollIntoView({ block: "nearest" }); }, [msgs, chatBusy]);

  // Vòng lặp Tool Calling: model gọi công cụ -> client tra số thật -> trả lại tới khi có đáp án.
  async function askWithTools(q: string, address?: string): Promise<string | null> {
    if (!tools) return null;
    const qx = address ? `${q}\n\n(Gọi tôi là "${address}".)` : q;
    let contents: any[] = [{ role: "user", parts: [{ text: qx }] }];
    for (let i = 0; i < 6; i++) {
      let d: any;
      try {
        const r = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "tools", contents, tools: tools.decls }),
        });
        d = await r.json();
      } catch { return null; }
      if (!d || d.status !== "ok") return null;
      const parts: any[] = d.parts || [];
      const fcPart = parts.find((p) => p.functionCall);
      if (fcPart) {
        const { name, args } = fcPart.functionCall;
        let result: any;
        try { result = tools.run(name, args || {}); } catch (e) { result = { error: String(e) }; }
        contents = [
          ...contents,
          { role: "model", parts: [{ functionCall: fcPart.functionCall }] },
          { role: "user", parts: [{ functionResponse: { name, response: { result } } }] },
        ];
        continue;
      }
      const text = parts.map((p) => p.text).filter(Boolean).join("").trim();
      return text || null;
    }
    return null;
  }

  async function send() {
    const q = input.trim();
    if (!q || chatBusy) return;
    const rq = replyTo; // chốt đoạn trích tại thời điểm gửi
    const userMsg: Msg = { role: "user", content: q, ...(rq ? { quote: rq.text } : {}) };
    const askMsgs: Msg[] = [...msgs, userMsg];
    let convo = askMsgs;
    setMsgs(convo);
    setInput("");
    setReplyTo(null);
    setChatBusy(true);
    // Dạy kiến thức ("dạy: ...") từ chính mục này -> lưu vào kho CHUNG cho mọi chat.
    if (isTeach(q)) {
      try { const note = await teachKnowledge(q); setMsgs([...convo, { role: "assistant", content: note }]); }
      catch { setMsgs([...convo, { role: "assistant", content: "Dạ em chưa lưu được, Sếp thử lại nhé." }]); }
      finally { setChatBusy(false); }
      return;
    }
    const qForAi = rq ? `[Tôi đang hỏi về đoạn này: "${rq.text}"]\n${q}` : q;
    try {
      // Có link trong câu chat -> đọc & LƯU LẠI (dùng cho các lần sau).
      const urls = q.match(/https?:\/\/[^\s]+/g) || [];
      let added = false;
      for (const u of urls) {
        const d = await dashdata({ action: "addUrl", url: u });
        const note = d?.ok
          ? `📎 Đã đọc & lưu dữ liệu từ link (${(d.chars || 0).toLocaleString("vi-VN")} ký tự). Em đã nhớ để dùng cho các lần sau ạ.`
          : `⚠ Không đọc được link: ${d?.error || "lỗi"}`;
        if (d?.ok) added = true;
        convo = [...convo, { role: "assistant", content: note }];
        setMsgs(convo);
      }
      if (added) await refreshExtra();

      // Ưu tiên TOOL CALLING (trợ lý tự tra số chính xác); hết khoá Gemini -> quay về chat thường.
      const address = addressOf(getUser());
      let reply: string | null = null;
      if (tools && tools.decls.length) reply = await askWithTools(qForAi, address);
      if (reply == null) {
        const r = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "askdata", id, messages: askMsgs.slice(-8).map(toApi), context: digestRef.current + `\n\n[XƯNG HÔ: gọi người dùng là "${address}"]` }),
        });
        const d = await r.json();
        reply = d?.reply || "(không có phản hồi)";
      }
      convo = [...convo, { role: "assistant", content: reply || "(không có phản hồi)" }];
      setMsgs(convo);
    } catch (e) {
      setMsgs((c) => [...c, { role: "assistant", content: "Lỗi: " + (e instanceof Error ? e.message : String(e)) }]);
    } finally {
      setChatBusy(false);
    }
  }

  const stamp =
    busy || status === "loading" ? "🕘 Đang tải phân tích…"
    : status === "ok" ? `🕘 Phân tích tự động · cập nhật ${fmtTime(at)}`
    // "stale" kèm errMsg = lần làm mới hôm nay bị lỗi, đây là BẢN CŨ còn giữ lại (không phải mới).
    : status === "stale" && errMsg ? `🕘 Bản cũ ${fmtTime(at)} (lần cập nhật mới nhất bị lỗi, xem bên dưới)`
    : status === "stale" ? `🕘 Bản gần nhất ${fmtTime(at)} · tự phân tích lúc 09:00 mỗi ngày`
    : status === "waiting" ? `🕘 Phân tích tự động chạy 09:00 mỗi ngày — bấm “Phân tích lại” để xem ngay`
    : status === "error" ? "⚠ Chưa có phân tích nào — lỗi bên dưới"
    : "";

  // Toàn bộ phần phân tích & chat của trợ lý CHỈ admin mới xem được.

  return (
    <div className="section-card sl-ai" style={{ marginTop: 12 }}>
      <div className="sl-ai-head">
        <div>
          <div className="sl-ai-title">{title}</div>
          <div className="sl-ai-sub">{sub}</div>
        </div>
        <button className="pl-calc" onClick={() => load(true)} disabled={busy || !hasDigest}>
          {busy ? "🤖 Đang phân tích…" : "Phân tích lại"}
        </button>
      </div>

      {(stamp || result) && (
        <div className="da-stamprow">
          {stamp && <span className="da-stamp">{stamp}</span>}
          {result && (
            <button className="da-toggle" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? "▸ Mở phân tích" : "▾ Ẩn phân tích"}
            </button>
          )}
        </div>
      )}
      {errMsg && (
        <div className="da-err" style={{ fontSize: 14, color: "var(--red)", background: "var(--red-soft, #fbeae8)", border: "1px solid var(--red)", borderRadius: 8, padding: "7px 11px", margin: "8px 0" }}>
          {errMsg}
        </div>
      )}
      {result && !collapsed && <RichText className="sl-result-rich" text={result} />}

      {extra.length > 0 && (
        <div className="da-extra">
          <span className="da-extra-h">📎 Dữ liệu đã nạp thêm ({extra.length}):</span>
          {extra.map((x, i) => (
            <a key={i} className="da-extra-item" href={/^https?:/.test(x.source) ? x.source : undefined} target="_blank" rel="noopener" title={`${x.source} · ${x.chars.toLocaleString("vi-VN")} ký tự · ${fmtTime(x.at)}`}>
              {shortSrc(x.source)}
            </a>
          ))}
          <button className="da-extra-clear" onClick={clearExtra}>Xoá hết</button>
        </div>
      )}

      <div className="da-chat">
        <div className="da-chat-h">💬 Hỏi trợ lý về số liệu này <span className="da-chat-hint">— dán link để em đọc &amp; nhớ · gõ “dạy: …” để dạy kiến thức (dùng chung mọi mục)</span></div>
        {msgs.length > 0 && (
          <div className="da-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={"da-msg " + m.role}>
                {m.quote && <div className="da-quote">↪ {m.quote}</div>}
                {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                <button className="da-reply-btn" title="Trả lời / hỏi về tin này (bôi đen 1 đoạn để trích đúng đoạn đó)" onClick={(e) => quoteMsg(m, e)}>↩ Trả lời</button>
              </div>
            ))}
            {chatBusy && <div className="da-msg assistant da-typing">Trợ lý đang trả lời…</div>}
            <div ref={msgsEnd} />
          </div>
        )}
        {replyTo && (
          <div className="da-replybar">
            <span className="da-replybar-tag">↪ Đang trả lời {replyTo.role === "assistant" ? "trợ lý" : "bạn"}:</span>
            <span className="da-replybar-text">{replyTo.text}</span>
            <button className="da-replybar-x" onClick={() => setReplyTo(null)} title="Bỏ trích">✕</button>
          </div>
        )}
        <div className="da-row">
          <input
            ref={inputRef}
            className="pl-in"
            placeholder={replyTo ? "Hỏi về đoạn đang trích…" : "Hỏi số liệu, tìm nguyên nhân, hoặc dán link để em đọc…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="pl-calc" onClick={send} disabled={chatBusy || !input.trim()}>Gửi</button>
          {msgs.length > 0 && <button className="da-clear" onClick={() => setMsgs([])} title="Xoá hội thoại">✕</button>}
        </div>
      </div>
    </div>
  );
}
