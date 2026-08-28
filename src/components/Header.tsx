import { Clock } from "./Clock";
import { VisitCounter } from "./VisitCounter";
import { addressOf, getUser, type AppUser } from "../lib/useUser";
import { useAdmin } from "../lib/useAdmin";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", deputy: "Phó Phòng", manager: "Quản lý", staff: "Nhân viên",
  cluster: "QL Cụm", leader: "Trưởng nhóm",
};

/** Khung trên cùng: logo + định danh cụm + tên dashboard + cập nhật realtime + tài khoản. */
export function Header({ user, onLogout }: { user?: AppUser | null; onLogout?: () => void }) {
  const { isAdmin } = useAdmin();
  return (
    <header className="topbar">
      <div className="logo-wrap">
        <img className="logo-img" src="/logo-ghn.jpg" alt="Giao Hàng Nhanh" />
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
        .hdr-acc-name{font-size:12.5px;font-weight:700;color:var(--ink,#1f2a37);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hdr-admin{font-size:11.5px;font-weight:800;border-radius:999px;padding:5px 10px;white-space:nowrap;border:1px solid var(--line-2,#e2e7ee);color:#78889a;background:#fff}
        .hdr-admin.on{color:#157a40;background:#e9f7ef;border-color:#1faa59;cursor:pointer}
        .hdr-logout{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:#fff;background:var(--orange,#f15a24);border:none;border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap}
        .hdr-logout:hover{filter:brightness(.95)}
        @media (max-width:760px){.hdr-acc-name{display:none}}
      `}</style>
    </header>
  );
}
