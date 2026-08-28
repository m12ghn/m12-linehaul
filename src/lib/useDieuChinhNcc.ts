/* Hook tải "Báo cáo Điều chỉnh" (tab Điều chỉnh - Báo NCC) — realtime, poll 60s. */
import { useEffect, useState } from "react";
import { loadDieuChinhNcc, type DieuChinhData } from "./dieuChinhNcc";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";

let cache: DieuChinhData | null = null;

export function useDieuChinhNcc() {
  const [data, setData] = useState<DieuChinhData | null>(cache);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setRefreshing(true);
      try {
        const res = await loadDieuChinhNcc();
        if (!alive) return;
        cache = res;
        setData(res);
      } catch {
        /* giữ dữ liệu cũ */
      } finally {
        if (alive) setRefreshing(false);
      }
    };
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  return { data, refreshing };
}
