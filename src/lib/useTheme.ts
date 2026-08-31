/* ============================================================
   Chế độ SÁNG / TỐI theo brand GHN.

   Cách hoạt động: gắn/gỡ class `ghn-dark` lên thẻ <html>. Toàn bộ token màu ở
   styles/ghn-tokens.css đổi giá trị theo class này, nên không component nào
   phải biết mình đang ở chế độ nào — trừ chỗ đổi file logo (nền tối phải dùng
   logo trắng, đúng quy tắc trong brand book).

   Lựa chọn lưu ở localStorage. Chưa chọn lần nào thì theo cài đặt hệ điều hành.
   ============================================================ */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "m12-theme";
const DARK_CLASS = "ghn-dark";

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null; // trình duyệt chặn storage (chế độ ẩn danh) — không phải lỗi
  }
}

function systemTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function initialTheme(): Theme {
  return saved() ?? systemTheme();
}

/** Gắn class lên <html>. Gọi được cả ngoài React (xem main.tsx). */
export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle(DARK_CLASS, t === "dark");
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* không lưu được thì thôi, phiên này vẫn dùng bình thường */
    }
  }, [theme]);

  // Người dùng chưa tự chọn thì bám theo hệ điều hành, đổi realtime.
  useEffect(() => {
    if (saved() || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
