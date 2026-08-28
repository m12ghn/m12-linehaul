/* Hook tải lịch tải tăng cường (realtime, poll 60s) + cache module. */
import { useEffect, useState } from "react";
import { loadTangCuong, type TangCuongData } from "./tangcuong";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";

const cache = new Map<string, TangCuongData>();

export function useTangCuong(sheetId: string, gid: string, kindLabel: string) {
  const key = sheetId + ":" + gid + ":" + kindLabel; // Lấy/Giao chung 1 gid -> tách cache theo kind
  const [data, setData] = useState<TangCuongData | null>(sheetId && gid ? cache.get(key) ?? null : null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!sheetId || !gid) { setData({ date: "", routes: [], ok: false, lastSync: Date.now() }); return; }
    setData(cache.get(key) ?? null);
    let alive = true;
    const run = async () => {
      setRefreshing(true);
      try {
        const res = await loadTangCuong(sheetId, gid, kindLabel);
        if (!alive) return;
        cache.set(key, res);
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
  }, [key, sheetId, gid, kindLabel]);

  return { data, refreshing };
}
