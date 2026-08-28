import { useEffect, useState } from "react";

/**
 * Hiển thị tổng lượt truy cập (lưu ở Cloudflare KV qua /api/visits).
 * Mỗi phiên trình duyệt chỉ tính 1 lượt (cờ sessionStorage); các lần sau chỉ đọc.
 */
export function VisitCounter() {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const counted = sessionStorage.getItem("m12:visited") === "1";
    const method = counted ? "GET" : "POST";
    fetch("/api/visits", { method })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!counted) sessionStorage.setItem("m12:visited", "1");
        if (typeof d?.total === "number") setTotal(d.total);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (total == null) return null;
  return (
    <div className="visit-badge" title="Tổng lượt truy cập dashboard">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span>{total.toLocaleString("vi-VN")} lượt truy cập</span>
    </div>
  );
}
