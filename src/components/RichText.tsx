import type { ReactNode } from "react";

/** Tô đậm các đoạn **...** trong 1 dòng, trả về mảng node React. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  const clean = (s: string) => s.replace(/\*+/g, ""); // bỏ dấu * lẻ còn sót (tránh rối mắt)
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(clean(text.slice(last, m.index)));
    out.push(<b key={k++}>{clean(m[1])}</b>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(clean(text.slice(last)));
  return out;
}

/**
 * Hiển thị văn bản trợ lý (markdown rút gọn) gọn gàng, dễ đọc:
 * tiêu đề (#/##/###), gạch đầu dòng (* hoặc -, có cấp con), in đậm **...**,
 * và đường kẻ ---. Không hiện ký tự markdown thô.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    if (!t) { nodes.push(<div key={i} className="rt-gap" />); return; }
    if (/^---+$/.test(t)) { nodes.push(<hr key={i} className="rt-hr" />); return; }
    let mm = t.match(/^(#{1,6})\s+(.*)$/);
    if (mm) {
      const lvl = Math.min(mm[1].length, 3);
      nodes.push(<div key={i} className={"rt-h rt-h" + lvl}>{inline(mm[2].replace(/[:：]\s*$/, ""))}</div>);
      return;
    }
    // Gạch đầu dòng: nhận "-", "*", "•", "–", "—" và cả trường hợp lặp "--"/"**" (trợ lý hay xuất dư).
    mm = line.match(/^(\s*)(?:[*\-•–—]{1,3})\s+(.*)$/);
    if (mm) {
      const indent = Math.floor(mm[1].length / 2);
      nodes.push(
        <div key={i} className={"rt-li" + (indent > 0 ? " rt-li-sub" : "")}>
          <span className="rt-dot">{indent > 0 ? "◦" : "•"}</span>
          <span>{inline(mm[2])}</span>
        </div>
      );
      return;
    }
    nodes.push(<div key={i} className="rt-p">{inline(t)}</div>);
  });
  return <div className={"rt " + (className || "")}>{nodes}</div>;
}
