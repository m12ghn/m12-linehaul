/* Bọc 1 khối biểu đồ: khi cuộn TỚI mới chạy hiệu ứng (fade-up + bật animation
   các cột bên trong). className truyền thẳng nên Reveal CHÍNH LÀ phần tử đó
   (giữ nguyên layout grid/flex của cha). */
import type { CSSProperties, ReactNode } from "react";
import { useInView } from "../lib/useInView";

export function Reveal({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`${className} reveal${inView ? " in" : ""}`.trim()} style={style}>
      {children}
    </div>
  );
}
