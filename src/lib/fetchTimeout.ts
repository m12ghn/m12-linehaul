/* ============================================================
   fetch() có GIỚI HẠN THỜI GIAN — trước đây các loader (sheet.ts, tlld.ts, fleet.ts,
   dieuChinhNcc.ts...) gọi fetch() trần không có timeout: nếu Google trả về CHẬM (treo,
   không lỗi hẳn — ví dụ đang redirect qua trang đăng nhập tạm thời) thì mỗi lượt thử có
   thể chờ rất lâu trước khi rơi xuống nguồn dự phòng/retry tiếp, cộng dồn thành "load lâu"
   dù cuối cùng vẫn ra dữ liệu đúng. Hàm này CẮT SỚM 1 lượt fetch nếu quá `timeoutMs`, coi
   như lỗi tạm thời để withRetry()/vòng lặp nguồn dự phòng xử lý tiếp như bình thường.
   ============================================================ */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const outer = init.signal;
  // Nếu caller đã có signal riêng (huỷ do unmount/đổi trang) -> huỷ theo caller LUÔN, không đợi timeout.
  const onOuterAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", onOuterAbort);
  }
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    // Timeout của TA phát ra AbortError giống hệt huỷ thật (unmount/đổi trang) — nếu để nguyên,
    // withRetry() sẽ tưởng là "huỷ chủ động" và dừng thử lại ngay (sai ý). Đổi thành lỗi thường để
    // withRetry()/vòng lặp nguồn dự phòng coi đây là lỗi tạm thời và thử tiếp như bình thường.
    if (timedOut) throw new Error(`Timeout sau ${timeoutMs}ms: ${url}`);
    throw e; // caller huỷ thật -> giữ nguyên AbortError để dừng ngay, không thử lại vô ích
  } finally {
    clearTimeout(t);
    if (outer) outer.removeEventListener("abort", onOuterAbort);
  }
}
