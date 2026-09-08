import { VISIBLE_SHEETS } from "../config";

/** Thanh menu cấp 2 — các vùng (tab sheet) HIỂN THỊ (bỏ vùng ẩn như Nội Vùng HCM).
 *  `leadingTab` (thêm 08/09): 1 nút PHỤ đặt TRƯỚC danh sách vùng — dùng cho tab "🌐 Toàn hub
 *  LM12SC" riêng của TLLD Tuyến. Cố ý dùng state/onClick RIÊNG (không đụng activeKey/onChange
 *  của các vùng Sheet thật — Lịch Tải/Lộ Trình vẫn cần đúng 1 trong VISIBLE_SHEETS để tải dữ
 *  liệu, không thể trỏ vào 1 "vùng" không có Sheet thật). Khi leadingTab.active thì KHÔNG có
 *  nút vùng nào hiện "active" (đang xem gộp toàn hub, không phải 1 vùng riêng lẻ). */
export function SheetTabs({
  activeKey,
  onChange,
  leadingTab,
}: {
  activeKey: string;
  onChange: (key: string) => void;
  leadingTab?: { label: string; active: boolean; onClick: () => void };
}) {
  return (
    <div className="subnav">
      <div className="subnav-inner">
        {leadingTab && (
          <button
            className={"region-btn" + (leadingTab.active ? " active" : "")}
            onClick={leadingTab.onClick}
          >
            {leadingTab.label}
          </button>
        )}
        {VISIBLE_SHEETS.map((s) => (
          <button
            key={s.key}
            className={"region-btn" + (!leadingTab?.active && s.key === activeKey ? " active" : "")}
            onClick={() => onChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
