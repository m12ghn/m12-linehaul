/* Gradient dùng chung cho cột biểu đồ (đậm dưới → sáng trên, tạo chiều sâu).
   Đặt <ChartGradients/> ngay sau <svg>, rồi fill={`url(#g-red)`}… */
export const ChartGradients = () => (
  <defs>
    <linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-danger)" /><stop offset="1" stopColor="var(--color-danger)" /></linearGradient>
    <linearGradient id="g-orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" /><stop offset="1" stopColor="var(--chart-1)" /></linearGradient>
    <linearGradient id="g-gray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-grid)" /><stop offset="1" stopColor="var(--chart-axis)" /></linearGradient>
    <linearGradient id="g-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-success)" /><stop offset="1" stopColor="var(--color-success)" /></linearGradient>
    <linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-6)" /><stop offset="1" stopColor="var(--chart-2)" /></linearGradient>
  </defs>
);

/** Map mã màu hex/biến → id gradient tương ứng (fallback giữ nguyên màu). */
export const gradOf = (c: string): string => {
  const m: Record<string, string> = {
    "var(--color-danger)": "g-red", "var(--red)": "g-red",
    "var(--chart-1)": "g-orange", "var(--orange)": "g-orange",
    "var(--color-success)": "g-green", "var(--green)": "g-green",
    "var(--chart-2)": "g-blue", "var(--blue)": "g-blue",
    "var(--chart-other)": "g-gray",
  };
  return m[c] ? `url(#${m[c]})` : c;
};
