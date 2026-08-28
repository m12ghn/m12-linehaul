/* ============================================================
   Thử lại thao tác bất đồng bộ khi lỗi TẠM THỜI (Google Sheets chớp nhoáng
   trả trang đăng nhập/redirect, mạng nghẽn 1 nhịp). Giúp panel TỰ HỒI PHỤC
   trong ~2s thay vì kẹt "Đang tải" tới lần poll kế (60s).
   KHÔNG thử lại khi bị huỷ (AbortError — do chuyển trang/đổi mục).
   ============================================================ */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 700): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e; // huỷ chủ động -> dừng ngay
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1))); // chờ tăng dần
    }
  }
  throw lastErr;
}
