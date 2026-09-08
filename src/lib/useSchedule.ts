/* ============================================================
   Hook: tải dữ liệu 1 vùng (gid) + tự đồng bộ định kỳ + làm mới tay.

   ⚠ 01/09/2026: KHÔNG còn ai gọi hook này nữa — App.tsx và GhepTai.tsx đã đổi
   sang src/lib/db/useLichTai.ts (đọc Supabase thay vì Sheet). Giữ nguyên file
   này lại (không xoá) để còn so sánh/rollback nếu cần trong giai đoạn đầu sau
   khi đổi; xoá hẳn khi đã chắc ăn không cần nữa.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadSheet } from "./sheet";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";
import type { SheetData } from "../types";

const EMPTY: SheetData = {
  routes: [], categories: [], lastSync: null, loading: true, error: null, missingGeo: [],
};

export function useSchedule(gid: string) {
  const [data, setData] = useState<SheetData>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const gidRef = useRef(gid);
  gidRef.current = gid;

  const run = useCallback(
    async (manual: boolean) => {
      const myGid = gidRef.current;
      const ctrl = new AbortController();
      if (manual) setRefreshing(true);
      else setData((d) => ({ ...d, loading: d.routes.length === 0, error: null }));
      try {
        const res = await loadSheet(myGid, ctrl.signal, manual);
        if (gidRef.current !== myGid) return; // đã đổi vùng -> bỏ
        setData({
          routes: res.routes,
          categories: res.categories,
          missingGeo: res.missingGeo,
          lastSync: Date.now(),
          loading: false,
          error: null,
        });
      } catch (e: unknown) {
        if (gidRef.current !== myGid) return;
        const msg = e instanceof Error ? e.message : String(e);
        setData((d) => ({ ...d, loading: false, error: msg }));
      } finally {
        if (gidRef.current === myGid) setRefreshing(false);
      }
    },
    []
  );

  // Đổi vùng -> reset + tải lại; lập lịch tự đồng bộ.
  useEffect(() => {
    setData(EMPTY);
    run(false);
    return startPoll(() => run(false), REFRESH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const refresh = useCallback(() => run(true), [run]);
  return { data, refreshing, refresh };
}
