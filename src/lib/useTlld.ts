/* Hook tải dữ liệu TLLD (cache module) + tự làm mới realtime + làm mới thủ công. */
import { useCallback, useEffect, useState } from "react";
import { loadTlld, loadTlldForCodes, type TlldIndex } from "./tlld";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";

let cached: TlldIndex | null = null;

export function useTlld() {
  const [index, setIndex] = useState<TlldIndex | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (showSpin = true, force = false) => {
    if (showSpin) setLoading(true);
    setError(null);
    try {
      const idx = await loadTlld(undefined, force);
      cached = idx;
      setIndex(idx);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mở/quay lại trang -> LÀM MỚI NGAY (chỉ hiện vòng xoay lần đầu chưa có cache).
    run(!cached);
    // Tự làm mới ngầm theo nhịp realtime (bỏ qua khi tab ẩn, làm mới lại khi quay lại).
    return startPoll(() => run(false), REFRESH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { index, loading, error, refresh: () => run(true, true) };
}

/** Biến thể LỌC THEO VÙNG của useTlld() ở trên — dùng cho khung "🩺 Sức khoẻ vận hành TLLD"
 *  (TlldSucKhoe), vốn phải đổi số theo tab vùng Lịch Tải đang chọn (Sếp yêu cầu 01/09), KHÁC
 *  useTlld() ở trên (giữ TOÀN CỤM — dùng cho tra cứu theo mã tuyến ở khắp nơi khác + tab
 *  "Báo Cáo" cố ý xem toàn cụm, không đụng tới).
 *  `allowedCodes = null` -> chưa có danh sách tuyến (vd. đang tải Lịch Tải vùng) -> chưa tải TLLD. */
export function useTlldRegion(allowedCodes: Set<string> | null) {
  const [index, setIndex] = useState<TlldIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Khoá ổn định theo NỘI DUNG tập mã tuyến (không theo identity Set) để useEffect chỉ chạy lại
  // khi danh sách tuyến THẬT SỰ đổi (vd. đổi vùng), không phải mỗi lần cha re-render tạo Set mới.
  const key = allowedCodes ? [...allowedCodes].sort().join(",") : "";

  const run = useCallback(async (showSpin = true, force = false) => {
    if (!allowedCodes || allowedCodes.size === 0) { setIndex(null); setLoading(false); return; }
    if (showSpin) setLoading(true);
    setError(null);
    try {
      const idx = await loadTlldForCodes(allowedCodes, undefined, force);
      setIndex(idx);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    run(true);
    return startPoll(() => run(false), REFRESH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { index, loading, error };
}
