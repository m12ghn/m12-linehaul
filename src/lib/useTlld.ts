/* Hook tải dữ liệu TLLD (cache module) + tự làm mới realtime + làm mới thủ công. */
import { useCallback, useEffect, useState } from "react";
import { loadTlld, type TlldIndex } from "./tlld";
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
