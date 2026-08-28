import { useState } from "react";
// import { useSchedule } from "../lib/useSchedule"; // nếu cần dữ liệu Sheet realtime

/** <Mô tả ngắn view làm gì>. */
export function TenView() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="section-card">
      <h2>Tiêu đề view</h2>
      {loading ? <p>Đang tải…</p> : <p>Nội dung view.</p>}
    </div>
  );
}
