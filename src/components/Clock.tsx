import { useEffect, useState } from "react";

const WD = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** Đồng hồ realtime: Thứ, dd/mm/yyyy HH:MM:SS */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const d = now;
  return (
    <b>
      {WD[d.getDay()]}, {p2(d.getDate())}/{p2(d.getMonth() + 1)}/{d.getFullYear()}{" "}
      {p2(d.getHours())}:{p2(d.getMinutes())}:{p2(d.getSeconds())}
    </b>
  );
}
