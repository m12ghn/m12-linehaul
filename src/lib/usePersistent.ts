import { useEffect, useRef, useState } from "react";

/**
 * useState nhưng tự lưu vào sessionStorage — dữ liệu giữ nguyên khi chuyển menu
 * và chỉ mất khi đóng tab/thoát trang. Dùng cho các form người dùng đã điền.
 */
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const k = "m12:" + key;
  const [val, setVal] = useState<T>(() => {
    try {
      const s = sessionStorage.getItem(k);
      return s != null ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    // bỏ qua lần đầu để không ghi đè vô ích
    if (first.current) { first.current = false; return; }
    try {
      sessionStorage.setItem(k, JSON.stringify(val));
    } catch {
      /* hết dung lượng / private mode — bỏ qua */
    }
  }, [k, val]);
  return [val, setVal];
}

/**
 * Như usePersistentState nhưng lưu vào localStorage (SỐNG QUA nhiều phiên/đóng tab) —
 * dùng cho dữ liệu Sếp tự điền tay và cần giữ lại nhiều ngày (Owner, Deadline chốt xe...),
 * KHÔNG phải nháp tạm trong 1 lần xem như sessionStorage ở trên.
 */
export function usePersistentLocal<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const k = "m12:" + key;
  const [val, setVal] = useState<T>(() => {
    try {
      const s = localStorage.getItem(k);
      return s != null ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try {
      localStorage.setItem(k, JSON.stringify(val));
    } catch {
      /* hết dung lượng / private mode — bỏ qua */
    }
  }, [k, val]);
  return [val, setVal];
}
