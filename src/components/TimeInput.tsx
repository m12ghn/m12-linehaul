/* Ô nhập GIỜ: vừa gõ tự do (tự định dạng "2030"->"20:30") vừa chọn từ danh sách
   giờ gợi ý (mỗi 30 phút). Linh hoạt hơn input type="time". */
import { useId } from "react";

// Danh sách giờ gợi ý: cả ngày, mỗi 30 phút.
const TIMES: string[] = [];
for (let h = 0; h < 24; h++) for (const m of [0, 30]) TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

/** Chuẩn hoá chuỗi giờ người dùng gõ -> "HH:MM" (chấp nhận 2030, 8h30, 8.30, 20:5...). */
export function normTime(s: string): string {
  let t = (s || "").trim().toLowerCase().replace(/[h.\s]+/g, ":").replace(/:+/g, ":").replace(/:$/, "");
  if (!t) return "";
  if (/^\d{3,4}$/.test(t)) { t = t.padStart(4, "0"); t = t.slice(0, 2) + ":" + t.slice(2); }
  const m = t.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!m) return s.trim();
  const h = Math.min(23, parseInt(m[1] || "0", 10) || 0);
  const mn = Math.min(59, parseInt(m[2] || "0", 10) || 0);
  return String(h).padStart(2, "0") + ":" + String(mn).padStart(2, "0");
}

export function TimeInput({
  value, onChange, className = "pl-in",
}: { value: string; onChange: (v: string) => void; className?: string }) {
  const id = useId();
  return (
    <>
      <input
        className={className}
        value={value}
        list={id}
        inputMode="numeric"
        placeholder="vd 20:30"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normTime(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter") onChange(normTime((e.target as HTMLInputElement).value)); }}
      />
      <datalist id={id}>
        {TIMES.map((t) => <option key={t} value={t} />)}
      </datalist>
    </>
  );
}
