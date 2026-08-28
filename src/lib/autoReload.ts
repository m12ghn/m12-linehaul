/* ============================================================
   TỰ ĐỘNG TẢI LẠI TRANG (kiểu F5) — an toàn, KHÔNG lặp vô hạn.
   Reload khi:
   1) Người dùng RỜI trang ≥30' rồi QUAY LẠI (đổi tab / mở lại cửa sổ).
   2) RẢNH ≥30' rồi thao tác lại.
   3) Máy NGỦ/treo ≥30' rồi mở lại (đồng hồ nhảy).
   4) Có bản DEPLOY MỚI (so /version.json) — CÓ CHỐT CHẶN: mỗi phiên chỉ thử
      reload 1 lần cho 1 mã bản; nếu reload xong vẫn lệch (cache) thì DỪNG,
      tránh vòng lặp "đang tải" mãi.
   Giữ nội dung đang gõ: không reload khi ô nhập đang có chữ.
   ============================================================ */
const IDLE_MS = 30 * 60 * 1000; // 30 phút
const TRY_KEY = "ar.triedId";   // mã bản đã thử reload (sessionStorage, sống qua reload)

export function initAutoReload(buildId: string): void {
  let lastActive = Date.now();
  let tick = Date.now();
  let hiddenAt = 0;
  let reloading = false;

  const ss = {
    get: () => { try { return sessionStorage.getItem(TRY_KEY) || ""; } catch { return ""; } },
    set: (v: string) => { try { sessionStorage.setItem(TRY_KEY, v); } catch { /* bỏ qua */ } },
    clear: () => { try { sessionStorage.removeItem(TRY_KEY); } catch { /* bỏ qua */ } },
  };

  const isTyping = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) && !!(el as HTMLInputElement).value;
  };

  const reload = () => {
    if (reloading || isTyping()) return;
    reloading = true;
    location.reload();
  };

  // (4) Bản mới? — CÓ CHỐT CHẶN chống lặp.
  async function checkVersion() {
    try {
      const r = await fetch("/version.json?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json().catch(() => null)) as { id?: string } | null;
      const sid = d?.id;
      if (!sid) return;
      if (sid === buildId) { ss.clear(); return; }   // đã là bản mới nhất -> ổn
      if (ss.get() === sid) return;                    // đã thử reload cho bản này mà vẫn lệch -> DỪNG (cache), không lặp
      ss.set(sid);                                     // đánh dấu ĐÃ THỬ (sống qua reload) rồi mới reload
      reload();
    } catch { /* mạng lỗi -> thử nhịp sau */ }
  }

  // (2) Thao tác lại sau khi rảnh ≥30'.
  const onActivity = () => {
    const now = Date.now();
    if (now - lastActive >= IDLE_MS && !document.hidden) { reload(); return; }
    lastActive = now;
  };
  ["mousedown", "keydown", "touchstart", "scroll", "mousemove"].forEach((e) =>
    window.addEventListener(e, onActivity, { passive: true }));

  // (1) Quay lại tab: rời ≥30' -> reload; rời ngắn -> chỉ kiểm bản mới.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    lastActive = Date.now();
    if (hiddenAt && Date.now() - hiddenAt >= IDLE_MS) { reload(); return; }
    checkVersion();
  });

  // (3) Nhịp nền 60s: bắt máy ngủ/treo ≥30' (đồng hồ nhảy) + dò bản mới.
  window.setInterval(() => {
    const now = Date.now();
    if (now - tick >= IDLE_MS) { reload(); return; }
    tick = now;
    if (!document.hidden) checkVersion();
  }, 60 * 1000);

  // Kiểm 1 lần lúc mở (đã có chốt chặn -> không lặp).
  checkVersion();
}
