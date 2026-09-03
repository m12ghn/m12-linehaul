/* ============================================================
   SIDEBAR TRÁI cấp NGOÀI CÙNG — chọn TEAM đang quản lý, thêm 03/09/2026 theo
   yêu cầu Sếp: ngoài Linehaul M12 (toàn bộ nội dung hiện tại của Dash), Sếp
   quản lý thêm team "Bảo Trì Bảo Dưỡng" (BTBD) — cần 1 chỗ chuyển qua lại.

   CỐ Ý làm NGOÀI CÙNG, KHÔNG đụng vào NavBar ngang hiện có (Tổng Quan/Lịch
   Tải/TLLD Tuyến/...) — chọn "Lịch Tải M12" ở đây thì hiện NGUYÊN dashboard
   cũ không đổi gì. BTBD hiện là trang trống chờ Sếp bổ sung nội dung/template
   sau — xem src/views/Btbd.tsx.
   ============================================================ */
export type Team = "linehaul" | "btbd";

const TEAMS: { key: Team; label: string; icon: string }[] = [
  { key: "linehaul", label: "Lịch Tải M12", icon: "🚚" },
  { key: "btbd", label: "Bảo Trì Bảo Dưỡng", icon: "🔧" },
];

export function TeamSidebar({ active, onChange }: { active: Team; onChange: (t: Team) => void }) {
  return (
    <nav className="team-sidebar">
      <div className="team-sidebar-head">M12SC</div>
      {TEAMS.map((t) => (
        <button
          key={t.key}
          className={"team-item" + (t.key === active ? " active" : "")}
          onClick={() => onChange(t.key)}
          title={t.label}
        >
          <span className="team-ic">{t.icon}</span>
          <span className="team-lb">{t.label}</span>
        </button>
      ))}
      <style>{`
        .team-shell{display:flex;min-height:100vh;align-items:stretch}
        .team-sidebar{
          flex:none;width:76px;display:flex;flex-direction:column;align-items:stretch;gap:2px;
          background:var(--surface-card);border-right:1px solid var(--border-subtle);
          padding:10px 6px;position:sticky;top:0;height:100vh;overflow-y:auto;z-index:20;
        }
        .team-sidebar-head{
          font-size:10.5px;font-weight:800;letter-spacing:.06em;color:var(--text-muted);
          text-align:center;padding:4px 0 10px;
        }
        .team-item{
          display:flex;flex-direction:column;align-items:center;gap:4px;
          border:1px solid transparent;background:transparent;border-radius:10px;
          padding:9px 4px;cursor:pointer;color:var(--text-muted);
        }
        .team-item .team-ic{font-size:20px;line-height:1}
        .team-item .team-lb{font-size:10px;font-weight:700;line-height:1.25;text-align:center}
        .team-item:hover{background:var(--surface-sunken)}
        .team-item.active{background:var(--accent-soft,var(--surface-sunken));border-color:var(--border-accent);color:var(--accent)}
        .team-content{flex:1;min-width:0}
        @media (max-width:760px){
          .team-shell{flex-direction:column}
          .team-sidebar{
            width:100%;height:auto;position:sticky;top:0;flex-direction:row;justify-content:center;
            padding:6px;overflow-x:auto;
          }
          .team-sidebar-head{display:none}
          .team-item{flex-direction:row;padding:7px 12px}
        }
      `}</style>
    </nav>
  );
}
