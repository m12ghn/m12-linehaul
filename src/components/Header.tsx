import { Clock } from "./Clock";
import { VisitCounter } from "./VisitCounter";
import { addressOf, getUser, type AppUser } from "../lib/useUser";
import { useAdmin } from "../lib/useAdmin";
import { useTheme } from "../lib/useTheme";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", deputy: "Phó Phòng", manager: "Quản lý", staff: "Nhân viên",
  cluster: "QL Cụm", leader: "Trưởng nhóm",
};

/** Khung trên cùng: logo + định danh cụm + tên dashboard + cập nhật realtime + tài khoản. */
export function Header({ user, onLogout }: { user?: AppUser | null; onLogout?: () => void }) {
  const { isAdmin } = useAdmin();
  const { theme, toggle } = useTheme();
  return (
    <header className="topbar">
      <div className="logo-wrap">
        {/* Quy tắc brand: nền sáng dùng bản chữ đen + mũi tên teal, nền tối dùng bản trắng.
            LƯU Ý: bộ logo brand gửi kèm chỉ có 3 file và CẢ 3 đều là bản chữ trắng
            (primary / white / on-teal giống nhau ở phần chữ) — không có bản cho nền
            sáng. `ghn-logo-on-light.png` là bản tự đổi chữ trắng thành đen, giữ nguyên
            mũi tên teal. Khi nào brand gửi file gốc thì thay lại đúng file đó. */}
        <img
          className="logo-img"
          src={theme === "dark" ? "/ghn-logo-white.png" : "/ghn-logo-on-light.png"}
          alt="Giao Hàng Nặng"
        />
      </div>
      <div className="title-block">
        <div className="crumb">
          M12SC <span className="sep">-</span> <span className="lh">LINEHAUL</span>
        </div>
        <h1>LỊCH TẢI MIỀN NAM</h1>
        <div className="sub">
          Cập nhật: <Clock /> <span className="sep">·</span>{" "}
          <span className="live">● realtime</span>
        </div>
      </div>
      <VisitCounter />
      <button
        className="feedback-jump"
        onClick={() =>
          document.getElementById("gop-y")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        title="Gửi câu hỏi / góp ý"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Góp ý
      </button>

      <button
        className="hdr-theme"
        onClick={toggle}
        title={theme === "dark" ? "Chuyển sang nền sáng" : "Chuyển sang nền tối"}
        aria-label={theme === "dark" ? "Chuyển sang nền sáng" : "Chuyển sang nền tối"}
      >
        {theme === "dark" ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>

      {/* Tài khoản: tên người đăng nhập + Đăng xuất (đăng xuất -> về màn đăng nhập). */}
      {user && (
        <div className="hdr-acc">
          <span className="hdr-acc-name" title={user.email}>👤 {addressOf(user)}</span>
          <span className={"hdr-admin" + (isAdmin ? " on" : "")} title={"Vai trò của tài khoản: " + (ROLE_LABEL[getUser()?.roleId || ""] || getUser()?.roleId || "—")}>
            {isAdmin ? "🛡️ Admin" : "👤 " + (ROLE_LABEL[getUser()?.roleId || ""] || "Người dùng")}
          </span>
          <button className="hdr-logout" onClick={onLogout} title="Đăng xuất / đổi tài khoản">⎋ Đăng xuất</button>
        </div>
      )}
      <style>{`
        .hdr-acc{display:flex;align-items:center;gap:8px;margin-left:8px}
        .hdr-acc-name{font-size:12.5px;font-weight:700;color:var(--ink,var(--text-strong));max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hdr-admin{font-size:11.5px;font-weight:800;border-radius:999px;padding:5px 10px;white-space:nowrap;border:1px solid var(--border-subtle);color:var(--text-muted);background:var(--surface-card)}
        .hdr-admin.on{color:var(--color-success);background:var(--success-soft);border-color:var(--color-success);cursor:pointer}
        .hdr-logout{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:var(--text-onaccent);background:var(--accent);border:none;border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap}
        .hdr-logout:hover{background:var(--accent-hover)}
        .hdr-theme{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;border:1px solid var(--border-subtle);background:var(--surface-card);color:var(--text-muted);border-radius:8px;cursor:pointer}
        .hdr-theme:hover{color:var(--accent);border-color:var(--border-accent)}
        .hdr-theme:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
        @media (max-width:760px){.hdr-acc-name{display:none}}
      `}</style>
    </header>
  );
}
