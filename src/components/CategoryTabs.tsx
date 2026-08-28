import { CATEGORY_LABELS } from "../config";
import type { Route } from "../types";

/** Thanh menu cấp 3 — các "Loại tuyến" (chỉ hiện khi vùng có phân loại). */
export function CategoryTabs({
  categories,
  routes,
  active,
  onChange,
}: {
  categories: string[];
  routes: Route[];
  active: string; // "" = tất cả
  onChange: (c: string) => void;
}) {
  if (categories.length <= 1) return null;
  const count = (cat: string) =>
    cat ? routes.filter((r) => r.category === cat).length : routes.length;
  return (
    <div className="cat-bar">
      <button
        className={"cat-chip" + (active === "" ? " active" : "")}
        onClick={() => onChange("")}
      >
        Tất cả<span className="n">{count("")}</span>
      </button>
      {categories.map((c) => (
        <button
          key={c}
          className={"cat-chip" + (active === c ? " active" : "")}
          onClick={() => onChange(c)}
        >
          {CATEGORY_LABELS[c] || c}
          <span className="n">{count(c)}</span>
        </button>
      ))}
    </div>
  );
}
