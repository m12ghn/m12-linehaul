/* Dropdown GỢI Ý tên (mã tuyến / bưu cục) hiển thị ngay dưới ô tìm kiếm.
   Dùng chung cho mọi ô "tìm tên tuyến": đặt trong 1 phần tử position:relative
   (vd .search-box), truyền value + danh sách names + cờ show (theo focus). */
import { useMemo } from "react";
import { expandAliases } from "../lib/normalize";

const strip = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

export function SuggestDrop({
  value, names, show, onPick, max = 8,
}: {
  value: string;
  names: string[];
  show: boolean;
  onPick: (n: string) => void;
  max?: number;
}) {
  const matches = useMemo(() => {
    const q = strip((value || "").trim());
    if (!q) return [];
    // Mở rộng viết tắt kho (HCM20 -> "ho chi minh 20"…) rồi khớp theo token, không phân biệt dấu.
    const toks = expandAliases(q).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const n of names) {
      const ns = strip(n);
      if (toks.every((t) => ns.includes(t))) { out.push(n); if (out.length >= max) break; }
    }
    // đã gõ trùng khít 1 tên duy nhất -> không cần gợi ý nữa
    if (out.length === 1 && strip(out[0]) === q) return [];
    return out;
  }, [value, names, max]);

  if (!show || !matches.length) return null;
  return (
    <div className="ac-list" role="listbox">
      {matches.map((n) => (
        <div
          key={n}
          className="ac-item"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => { e.preventDefault(); onPick(n); }}
        >
          {/(^|\s)(kho|bưu ?cục|b\.?c)\b/i.test(n) ? "🏠 " : "🚚 "}{n}
        </div>
      ))}
    </div>
  );
}
