/* Hook tải dữ liệu cổng xuất (realtime, poll 60s) + cache module. */
import { useEffect, useState } from "react";
import { loadCongXuat, type CongXuatData } from "./congxuat";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";

let cache: CongXuatData | null = null;

export function useCongXuat() {
  const [data, setData] = useState<CongXuatData | null>(cache);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setRefreshing(true);
      try {
        const res = await loadCongXuat();
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
