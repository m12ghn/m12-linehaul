import { VISIBLE_SHEETS } from "../config";

/** Thanh menu cấp 2 — các vùng (tab sheet) HIỂN THỊ (bỏ vùng ẩn như Nội Vùng HCM). */
export function SheetTabs({
  activeKey,
  onChange,
}: {
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="subnav">
      <div className="subnav-inner">
        {VISIBLE_SHEETS.map((s) => (
          <button
            key={s.key}
            className={"region-btn" + (s.key === activeKey ? " active" : "")}
            onClick={() => onChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
