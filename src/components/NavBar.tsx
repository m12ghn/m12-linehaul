import { useEffect, useRef, useState } from "react";
import { TOP_MENUS } from "../config";
import type { TopMenu } from "../types";
import { useMyRole } from "../lib/usePermissions";

/** Icon nhỏ minh hoạ theo nghĩa từng menu cho sống động. */
const MENU_ICON: Record<TopMenu, string> = {
  "tong-quan": "🏠",
  "lich-tai": "🚚",
  "gsvt": "👷",
  "lo-trinh": "✈️",
  "tlld-tuyen": "📈",
  "tang-cuong": "🌆",
  "cong-xuat": "🚪",
  "san-luong": "📦",
  "ds-ncc": "📇",
  "plan-event": "✈️",
  "sap-lich-tai": "🤖",
  "phan-quyen": "🛡️",
};
void MENU_ICON; // tạm không render icon (xem bên dưới) — giữ map lại để khôi phục nhanh khi cần

/** Thanh menu cấp 1 — các mục đích của dashboard. */
export function NavBar({ active, onChange }: { active: TopMenu; onChange: (m: TopMenu) => void }) {
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false });
  const [hasMore, setHasMore] = useState(false);
  const { canOpen } = useMyRole();

  // Còn nội dung bên phải để kéo? -> bật dải mờ gợi ý.
  function updateMore() {
    const el = navRef.current; if (!el) return;
    setHasMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }
  useEffect(() => {
    updateMore();
    window.addEventListener("resize", updateMore);
    return () => window.removeEventListener("resize", updateMore);
  }, []);

  function onDown(e: React.PointerEvent) {
    const el = navRef.current; if (!el) return;
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }
  function onMove(e: React.PointerEvent) {
    const el = navRef.current; if (!el || !drag.current.down) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
    updateMore();
  }
  function endDrag() { drag.current.down = false; }

  return (
    <div className={"navwrap" + (hasMore ? " has-more" : "")}>
      <nav
        className="tabs"
        ref={navRef}
        onScroll={updateMore}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {TOP_MENUS.map((m) => {
          const locked = !canOpen(m.key); // vai trò chưa có quyền Xem -> khoá tab
          return (
            <button
              key={m.key}
              className={"tab" + (m.key === active ? " active" : "") + (locked ? " locked" : "")}
              onClick={() => { if (!drag.current.moved && !locked) onChange(m.key); }}
              title={locked ? "Vai trò của bạn chưa có quyền xem mục này" : undefined}
            >
              <span className="dot" />
              {m.label}
              {/* Tạm ẩn icon menu theo yêu cầu Sếp (2026-08-18) — bỏ comment 2 dòng dưới để khôi phục. */}
              {/* {locked && <span className="menu-lock">🔒</span>} */}
              {/* <span className={"menu-ic ic-" + m.key}>{MENU_ICON[m.key]}</span> */}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
