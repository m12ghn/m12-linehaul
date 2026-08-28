/* Khối thu gọn/mở rộng dùng chung: mặc định ĐÓNG, bấm tiêu đề để xem chi tiết.
   Dùng cho các bảng/danh sách dài để giảm mật độ khối hiện cùng lúc trên 1 trang. */
import { useState, type CSSProperties, type ReactNode } from "react";

export function Collapsible({
  title, sub, defaultOpen = false, badge, children, className = "", style,
}: {
  title: ReactNode; sub?: ReactNode; defaultOpen?: boolean; badge?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""} ${className}`.trim()} style={style}>
      <button type="button" className="collapsible-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="collapsible-arrow">{open ? "▾" : "▸"}</span>
        <span className="collapsible-title">{title}</span>
        {sub && <span className="collapsible-sub">{sub}</span>}
        {badge}
        <span className="collapsible-hint">{open ? "Thu gọn" : "Xem chi tiết"}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
