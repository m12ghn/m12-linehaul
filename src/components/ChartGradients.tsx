/* Gradient dùng chung cho cột biểu đồ (đậm dưới → sáng trên, tạo chiều sâu).
   Đặt <ChartGradients/> ngay sau <svg>, rồi fill={`url(#g-red)`}… */
export const ChartGradients = () => (
  <defs>
    <linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6f6f" /><stop offset="1" stopColor="#e23b3b" /></linearGradient>
    <linearGradient id="g-orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8d4f" /><stop offset="1" stopColor="#f15a24" /></linearGradient>
    <linearGradient id="g-gray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dbe2ea" /><stop offset="1" stopColor="#c2ccd8" /></linearGradient>
    <linearGradient id="g-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3cc878" /><stop offset="1" stopColor="#1faa59" /></linearGradient>
    <linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a86e0" /><stop offset="1" stopColor="#1668c7" /></linearGradient>
  </defs>
);

/** Map mã màu hex/biến → id gradient tương ứng (fallback giữ nguyên màu). */
export const gradOf = (c: string): string => {
  const m: Record<string, string> = {
    "#e23b3b": "g-red", "var(--red)": "g-red",
    "#f15a24": "g-orange", "var(--orange)": "g-orange",
    "#1faa59": "g-green", "var(--green)": "g-green",
    "#1668c7": "g-blue", "var(--blue)": "g-blue",
    "#c7d0da": "g-gray",
  };
  return m[c] ? `url(#${m[c]})` : c;
};
