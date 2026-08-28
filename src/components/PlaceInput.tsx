/* Ô nhập tên kho/bưu cục có GỢI Ý (autocomplete): gõ tới đâu lọc tên tới đó
   (không phân biệt dấu), bấm/Enter để chọn. */
import { useMemo, useRef, useState } from "react";
import { expandAliases } from "../lib/normalize";

const strip = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

export function PlaceInput({
  value, onChange, names, ids, placeholder, className = "pl-in", wrapStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  names: string[];
  ids?: Map<string, string>; // tên -> mã ID kho (nếu có) — cho phép gõ MÃ để tìm ra tên
  placeholder?: string;
  className?: string;
  wrapStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const blurT = useRef<number | undefined>(undefined);

  const matches = useMemo(() => {
    const q = strip(value.trim());
    if (!q) return [];
    // Mở rộng viết tắt kho (HCM20 -> "ho chi minh 20", TT -> "tan tao"…) rồi mới khớp token.
    const toks = expandAliases(q).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const n of names) {
      const ns = strip(n);
      const matchName = toks.every((t) => ns.includes(t));
      // Gõ đúng/gần đúng MÃ ID kho (1 từ, không dấu cách) -> cũng khớp ra tên tương ứng.
      const idStr = ids?.get(n);
      const matchId = !!idStr && toks.length === 1 && idStr.includes(toks[0]);
      if (matchName || matchId) { out.push(n); if (out.length >= 8) break; }
    }
    // Vẫn hiện gợi ý dù đã gõ trùng khít 1 tên — Sếp bấm chọn lại để chắc chắn khớp CHÍNH XÁC
    // 100% với tên trong hệ thống (đỡ trường hợp gõ tay lệch dấu/khoảng trắng nhìn giống nhưng khác).
    return out;
  }, [value, names, ids]);

  // Chọn gợi ý -> điền dạng "ID - Tên" (vd "2451 - (HCM) Đông Hưng Thuận 2") khi có ID, để dễ phân
  // biệt các điểm dễ trùng/gần tên nhau — tra toạ độ vẫn dùng đúng tên thật (xem stripIdPrefix ở planner.ts).
  const pick = (n: string) => {
    const id = ids?.get(n);
    onChange(id ? `${id} - ${n}` : n);
    setOpen(false); setHi(-1);
  };

  return (
    <div className="ac-wrap" style={wrapStyle}>
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurT.current = window.setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => {
          if (!open || !matches.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter" && hi >= 0) { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {open && matches.length > 0 && (
        <div className="ac-list">
          {matches.map((n, i) => (
            <div
              key={n}
              className={"ac-item" + (i === hi ? " hi" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(n); }}
              onMouseEnter={() => setHi(i)}
            >
              {/kho/i.test(n) ? "🏠 " : "📦 "}{n}
              {ids?.get(n) && <span style={{ color: "var(--muted)", marginLeft: 6 }}>#{ids.get(n)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
