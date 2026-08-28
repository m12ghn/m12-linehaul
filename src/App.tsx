import { useEffect, useState, lazy, Suspense, startTransition } from "react";
import { Header } from "./components/Header";
import { NavBar } from "./components/NavBar";
import { SheetTabs } from "./components/SheetTabs";
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
// MỚI (đảo chiều): màn nhập liệu đọc/ghi thẳng Supabase — xem src/views/LichTaiNhap.tsx.
const LichTaiNhap = lazy(() => import("./views/LichTaiNhap").then((m) => ({ default: m.LichTaiNhap })));
import { QABoard } from "./components/QABoard";
import { EmailGate } from "./components/EmailGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSchedule } from "./lib/useSchedule";
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
  const [topMenu, setTopMenu] = useState<TopMenu>("tong-quan");
  const [sheetKey, setSheetKey] = useState<string>(VISIBLE_SHEETS[0].key);
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"auto" | "mymap">("auto");
  // sub-tab trong Lịch Tải: Lịch tải (đọc Sheet, bản cũ) | Nhập liệu (Supabase, bản mới) | GSVT | Cổng xuất.
  // Giữ CẢ HAI trong giai đoạn chuyển đổi để đối chiếu số liệu 2 nguồn trước khi bỏ hẳn nhánh Sheet.
  const [ltSub, setLtSub] = useState<"lich" | "nhap" | "gsvt" | "cong">("lich");
  const [tlldSub, setTlldSub] = useState<"tong-quan" | "bao-cao">("tong-quan"); // sub-tab trong TLLD Tuyến: Tổng Quan | Báo Cáo
  // sub-tab trong Plan Event: Kế Hoạch (quyết định hằng ngày) | Chi tiết & Đánh giá (kiểm chứng/tra cứu).
  // CỐ Ý dùng useState thường (không usePersistentState) — luôn reset về "ke-hoach" mỗi lần vào lại
  // trang, tránh kẹt ở tab "Chi tiết" từ lần xem trước khi không còn thấy banner quyết định ngay.
  const [peSub, setPeSub] = useState<"ke-hoach" | "chi-tiet">("ke-hoach");

  const sheet = VISIBLE_SHEETS.find((s) => s.key === sheetKey) ?? VISIBLE_SHEETS[0];
  const { data, refreshing, refresh } = useSchedule(sheet.gid);
  const { canOpen, canDo } = useMyRole(); // kiểm tra quyền theo vai trò -> chặn cả tầng render, không chỉ khoá tab
  // Sau khi sửa Lịch Tải trên dash (ghi ngược vào Sheet): làm mới ngay + làm mới lại lần nữa sau ~2.5s
  // (gviz có độ trễ lan truyền ngắn sau khi ghi, gọi lại 1 lần cho chắc ăn thấy đúng giá trị mới).
  function refreshSoon() {
    refresh();
    setTimeout(refresh, 2500);
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
              <button className={ltSub === "nhap" ? "active" : ""} onClick={() => setLtSub("nhap")}>✏️ Nhập liệu</button>
              <button className={ltSub === "gsvt" ? "active" : ""} onClick={() => setLtSub("gsvt")}>👷 GSVT</button>
              <button className={ltSub === "cong" ? "active" : ""} onClick={() => setLtSub("cong")}>🚪 Cổng Xuất</button>
            </div>
            {ltSub === "cong" ? <CongXuat /> : ltSub === "gsvt" ? <Gsvt /> : ltSub === "nhap" ? (
              <LichTaiNhap
                canEdit={canDo("lich-tai", "edit")}
                canExport={canDo("lich-tai", "export")}
              />
            ) : (
              <LichTai
                data={data}
                regionLabel={sheet.label}
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
                canEdit={user?.roleId === "admin"}
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
        © M12SC <span className="dot-sep">·</span> Cụm M12 <span className="dot-sep">·</span> Lịch tải
        Miền Nam <span className="dot-sep">·</span> Dữ liệu đồng bộ tự động từ Google Sheets
      </footer>
    </>
  );
}
