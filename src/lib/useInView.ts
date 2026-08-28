/* Trả về [ref, inView]: inView=true KHI phần tử cuộn vào tầm nhìn (chạy 1 lần).
   Dùng để kích hoạt hiệu ứng biểu đồ đúng lúc người dùng kéo tới.
   Dùng getBoundingClientRect + scroll listener (đáng tin hơn IntersectionObserver
   vốn hay không fire trong một số môi trường) + safety timeout chống kẹt vô hình. */
import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(revealRatio = 0.9): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null!);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    let timer = 0;
    const cleanup = () => {
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
      if (timer) window.clearTimeout(timer);
    };
    const reveal = () => { if (!done) { done = true; setInView(true); cleanup(); } };
    function check() {
      if (done) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // hiện khi mép trên đã vào ~90% chiều cao màn hình và phần tử chưa trôi hẳn lên trên
      if (r.top < vh * revealRatio && r.bottom > 0) reveal();
    }
    check(); // có thể đã nằm trong tầm nhìn ngay khi mở
    window.addEventListener("scroll", check, true); // capture: bắt cả cuộn trong khung con
    window.addEventListener("resize", check);
    timer = window.setTimeout(reveal, 10000); // an toàn: phòng kẹt vô hình (hiếm khi tới)
    return cleanup;
  }, [revealRatio]);
  return [ref, inView];
}
