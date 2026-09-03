import { useEffect, useState, lazy, Suspense, startTransition } from "react";
import { Header } from "./components/Header";
import { NavBar } from "./components/NavBar";
import { SheetTabs } from "./components/SheetTabs";
import { TeamSidebar, type Team } from "./components/TeamSidebar";
import { Btbd } from "./views/Btbd";
import { Overview } from "./views/Overview"; // trang đầu -> nạp ngay
// Các mục còn lại tách chunk, nạp khi mở (giảm JS ban đầu -> web nhẹ & mở nhanh hơn).
const LichTai = lazy(() => import("./views/LichTai").then((m) => ({ default: m.LichTai })));
const Gsvt = lazy(() => import("./views/Gsvt").then((m) => ({ default: m.Gsvt })));
const LoTrinh = lazy(() => import("./views/LoTrinh").then((m) => ({ default: m.LoTrinh })));
const TlldTuyen = lazy(() => import("./views/TlldTuyen").then((m) => ({ default: m.TlldTuyen })));
const TangCuong = lazy(() => import("./views/TangCuong").then((m) => ({ default: m.TangCuong })));
const CongXuat = lazy(() => import("./views/CongXuat").then((m) => ({ default: m.CongXuat })));
const SanLuong = lazy(() => import("./views/SanLuong").then((m) => ({ default: m.SanLuong })));
const DsNcc = lazy(() => import("./views/DsNcc").then((m) => ({ default: m.DsNcc })));
const PlanEvent = lazy(() => import("./views/PlanEvent").then((m) => ({ default: m.PlanEvent })));
const SapLichTai = lazy(() => import("./views/SapLichTai").then((m) => ({ default: m.SapLichTai })));
const PhanQuyen = lazy(() => import("./views/PhanQuyen").then((m) => ({ default: m.PhanQuyen })));
import { QABoard } from "./components/QABoard";
import { EmailGate } from "./components/EmailGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useLichTai } from "./lib/db/useLichTai";
import { initAutoReload } from "./lib/autoReload";
import { initLiveGeo } from "./lib/geo";
import { useUser, addressOf } from "./lib/useUser";
import { onNav } from "./lib/nav";
import { loadRbac, useMyRole } from "./lib/usePermissions";
import { normSearch } from "./lib/normalize";
import { VISIBLE_SHEETS, TOP_MENUS, GEO_REFRESH_MS } from "./config";
import type { TopMenu } from "./types";

export default function App() {
  const { user, emailLogin, logout } = useUser();
  // Team đang xem — 03/09/2026: Sếp quản lý thêm team "Bảo Trì Bảo Dưỡng" (BTBD) ngoài
  // Linehaul M12 (toàn bộ nội dung hiện tại). Sidebar ngoài cùng (TeamSidebar) chuyển
  // qua lại, KHÔNG đụng gì vào NavBar ngang/topMenu hiện có — xem render bên dưới.
  const [team, setTeam] = useState<Team>("linehaul");
  const [topMenu, setTopMenu] = useState<TopMenu>("tong-quan");
  const [sheetKey, setSheetKey] = useState<string>(VISIBLE_SHEETS[0].key);
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"auto" | "mymap">("auto");
  // sub-tab trong Lịch Tải: Lịch tải (Supabase, sửa tại chỗ bằng nút ✎) | GSVT | Cổng xuất.
  // 03/09/2026: bỏ tab "✏️ Nhập liệu" riêng (đã thay bằng nút ✎ ngay trong RouteCard của
  // tab Lịch Tải) theo yêu cầu Sếp — xem src/components/RouteCard.tsx.
  const [ltSub, setLtSub] = useState<"lich" | "gsvt" | "cong">("lich");
  const [tlldSub, setTlldSub] = useState<"tong-quan" | "bao-cao">("tong-quan"); // sub-tab trong TLLD Tuyến: Tổng Quan | Báo Cáo
  // sub-tab trong Plan Event: Kế Hoạch (quyết định hằng ngày) | Chi tiết & Đánh giá (kiểm chứng/tra cứu).
  // CỐ Ý dùng useState thường (không usePersistentState) — luôn reset về "ke-hoach" mỗi lần vào lại
  // trang, tránh kẹt ở tab "Chi tiết" từ lần xem trước khi không còn thấy banner quyết định ngay.
  const [peSub, setPeSub] = useState<"ke-hoach" | "chi-tiet">("ke-hoach");

  const sheet = VISIBLE_SHEETS.find((s) => s.key === sheetKey) ?? VISIBLE_SHEETS[0];
  // 01/09/2026: ĐÃ ĐẢO CHIỀU — nguồn Lịch Tải giờ là Supabase (useLichTai), không còn đọc Google
  // Sheet nữa (trước đó useSchedule(sheet.gid) đọc CSV). Xem lib/db/useLichTai.ts — cùng hình dạng
  // trả về nên chỉ đổi đúng dòng này + tham số (gid -> key, region_key trên Supabase).
  const { data, refreshing, refresh } = useLichTai(sheet.key);
  const { canOpen, canDo } = useMyRole(); // kiểm tra quyền theo vai trò -> chặn cả tầng render, không chỉ khoá tab
  // Trước đây phải làm mới 2 lần cách nhau 2.5s vì ghi vào Sheet có độ trễ lan truyền (gviz).
  // Ghi vào Supabase đọc lại được đúng ngay -> không cần trò làm mới kép nữa, nhưng vẫn giữ tên
  // refreshSoon (nhiều nơi đang gọi) để không phải sửa thêm chỗ khác trong lần đổi này.
  function refreshSoon() {
    refresh();
  }

  // Đổi vùng -> reset loại tuyến/chọn (GIỮ từ khoá tìm kiếm cho tới khi load lại web).
  useEffect(() => {
    setCategory("");
    setSelected(null);
  }, [sheetKey]);

  // Đổi mục (menu cấp 1) -> chỉ bỏ chọn (GIỮ từ khoá tìm kiếm xuyên các tab).
  useEffect(() => {
    setSelected(null);
  }, [topMenu]);

  // Đồng bộ KHO KIẾN THỨC hằng ngày (đọc sheet Sếp cấp -> CSDL Dash + trợ lý).
  // Fire-and-forget khi mở Dash; server tự giới hạn ~1 lần/ngày.
  useEffect(() => { fetch("/api/knowsync").catch(() => {}); }, []);

  // Toạ độ kho REALTIME từ MyMap (trộn đè geo.json nền) -> thêm điểm mới không cần build:geo.
  // Lặp lại mỗi GEO_REFRESH_MS (không chỉ 1 lần lúc mở) để phiên đang mở lâu vẫn tự bắt điểm mới.
  useEffect(() => {
    initLiveGeo().catch(() => {});
    const id = setInterval(() => { initLiveGeo().catch(() => {}); }, GEO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Nạp cấu hình phân quyền (roles + matrix) 1 lần khi mở Dash -> khoá menu theo vai trò.
  useEffect(() => { loadRbac(); }, []);

  // Tự tải lại trang: có bản deploy mới / rảnh ≥30' quay lại / máy ngủ rồi mở lại.
  useEffect(() => { initAutoReload(__BUILD_ID__); }, []);

  // Trợ lý AI điều hướng Dash: chuyển mục + điền sẵn vùng/tìm kiếm.
  useEffect(() => {
    return onNav((c) => {
      if (c.region) {
        const f = VISIBLE_SHEETS.find((s) => normSearch(s.label).includes(normSearch(c.region!)));
        if (f) setSheetKey(f.key);
      }
      if (c.search != null && c.search !== "") setSearch(c.search);
      if (c.view) startTransition(() => {
        // Cổng Xuất giờ nằm TRONG Lịch Tải -> mở lich-tai + sub-tab cổng.
        if (c.view === "cong-xuat") { setTopMenu("lich-tai"); setLtSub("cong"); }
        else { if (c.view === "lich-tai") setLtSub("lich"); setTopMenu(c.view!); }
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  // Cổng email (lớp ngoài) — chưa đăng nhập thì chưa vào được Dashboard.
  if (!user) return <EmailGate onEmailLogin={emailLogin} />;

  return (
    <div className="team-shell">
      <TeamSidebar active={team} onChange={setTeam} />
      <div className="team-content">
      {team === "btbd" ? (
        <Btbd />
      ) : (
    <>
      <Header user={user} onLogout={logout} />
      <NavBar active={topMenu} onChange={(m) => startTransition(() => setTopMenu(m))} />
      {((topMenu === "lich-tai" && ltSub === "lich") || topMenu === "lo-trinh" || topMenu === "tlld-tuyen") && (
        <SheetTabs activeKey={sheetKey} onChange={setSheetKey} />
      )}

      <div className="page">
        {!canOpen(topMenu) ? (
          <div className="section-card" style={{ textAlign: "center", padding: "44px 20px", marginTop: 16 }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>🔒</div>
            <p className="lead" style={{ maxWidth: 460, margin: "0 auto 14px" }}>
              Vai trò của bạn chưa có quyền xem mục <b>{TOP_MENUS.find((m) => m.key === topMenu)?.label || topMenu}</b>. Liên hệ admin để được cấp quyền ạ.
            </p>
            <button className="pl-calc" onClick={() => { const f = TOP_MENUS.find((m) => canOpen(m.key)); if (f) startTransition(() => setTopMenu(f.key)); }}>Về mục được phép →</button>
          </div>
        ) : (
        <ErrorBoundary key={topMenu}>
        <Suspense fallback={<div className="eb-reloading">⏳ Đang mở…</div>}>
        {topMenu === "tong-quan" && <Overview onNav={setTopMenu} user={user} />}
        {topMenu === "lich-tai" && (
          <>
            <div className="sub-tabs">
              <button className={ltSub === "lich" ? "active" : ""} onClick={() => setLtSub("lich")}>🚚 Lịch Tải</button>
              <button className={ltSub === "gsvt" ? "active" : ""} onClick={() => setLtSub("gsvt")}>👷 GSVT</button>
              <button className={ltSub === "cong" ? "active" : ""} onClick={() => setLtSub("cong")}>🚪 Cổng Xuất</button>
            </div>
            {ltSub === "cong" ? <CongXuat /> : ltSub === "gsvt" ? <Gsvt /> : (
              <LichTai
                data={data}
                regionLabel={sheet.label}
                regionKey={sheet.key}
                refreshing={refreshing}
                onRefresh={refresh}
                category={category}
                setCategory={setCategory}
                search={search}
                setSearch={setSearch}
                selected={selected}
                setSelected={setSelected}
                mapMode={mapMode}
                setMapMode={setMapMode}
                gid={sheet.gid}
                canEdit={canDo("lich-tai", "edit")}
                canExport={canDo("lich-tai", "export")}
                onSaved={refreshSoon}
                onSwitchRegion={(g) => { const s = VISIBLE_SHEETS.find((x) => x.gid === g); if (s) setSheetKey(s.key); }}
              />
            )}
          </>
        )}
        {topMenu === "lo-trinh" && (
          <LoTrinh
            data={data}
            regionLabel={sheet.label}
            category={category}
            setCategory={setCategory}
            mapMode={mapMode}
            setMapMode={setMapMode}
          />
        )}
        {topMenu === "tlld-tuyen" && (
          <>
            <div className="sub-tabs">
              <button className={tlldSub === "tong-quan" ? "active" : ""} onClick={() => setTlldSub("tong-quan")}>📊 Tổng Quan TLLD</button>
              <button className={tlldSub === "bao-cao" ? "active" : ""} onClick={() => setTlldSub("bao-cao")}>📄 Báo Cáo</button>
            </div>
            <TlldTuyen
              data={data}
              regionLabel={sheet.label}
              category={category}
              setCategory={setCategory}
              search={search}
              setSearch={setSearch}
              view={tlldSub}
            />
          </>
        )}
        {topMenu === "tang-cuong" && <TangCuong mapMode={mapMode} setMapMode={setMapMode} />}
        {topMenu === "san-luong" && <SanLuong />}
        {topMenu === "ds-ncc" && <DsNcc />}
        {topMenu === "plan-event" && (
          <>
            <div className="sub-tabs">
              <button className={peSub === "ke-hoach" ? "active" : ""} onClick={() => setPeSub("ke-hoach")}>📋 Kế Hoạch</button>
              <button className={peSub === "chi-tiet" ? "active" : ""} onClick={() => setPeSub("chi-tiet")}>🔍 Chi tiết & Đánh giá</button>
            </div>
            <PlanEvent view={peSub} onRequestKeHoach={() => setPeSub("ke-hoach")} />
          </>
        )}
        {topMenu === "sap-lich-tai" && (
          <SapLichTai mapMode={mapMode} setMapMode={setMapMode} />
        )}
        {topMenu === "phan-quyen" && <PhanQuyen />}
        </Suspense>
        </ErrorBoundary>
        )}
      </div>

      <QABoard />

      <footer>
        <span className="foot-user">👤 {addressOf(user)} <span className="dot-sep">·</span> {user.email} <span className="dot-sep">·</span>
          <button className="foot-logout" onClick={logout}>Đổi tài khoản</button>
        </span>
        <br />
        © M12SC <span className="dot-sep">·</span> Cụm M12 <span className="dot-sep">·</span> Trang quản lý
        Linehaul M12 <span className="dot-sep">·</span> Dữ liệu đồng bộ tự động từ Google Sheets
      </footer>
    </>
      )}
      </div>
    </div>
  );
}
