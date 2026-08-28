/* ============================================================
   Lập lịch POLL realtime nhẹ nhàng:
   - BỎ QUA nhịp poll khi tab đang ẩn (document.hidden) -> không tốn CPU/mạng
     khi Dash để nền hoặc nhiều người mở rồi rời đi.
   - Khi quay lại tab -> LÀM MỚI NGAY (bù nhịp đã bỏ).
   Trả về hàm dọn dẹp (gỡ interval + listener).
   ============================================================ */
export function startPoll(run: () => void, ms: number): () => void {
  const timer = window.setInterval(() => { if (!document.hidden) run(); }, ms);
  const onVis = () => { if (!document.hidden) run(); };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}
