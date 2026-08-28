/* ============================================================
   Hook thay thế src/lib/useSchedule.ts — nguồn dữ liệu là Supabase, không phải Sheet.
   Giữ nguyên hình dạng trả về { data, refreshing, refresh } để App.tsx đổi 1 dòng import.

   Khác biệt so với bản Sheet:
     - Sau khi SỬA thì gọi thẳng refresh() được ngay, không cần "làm mới 2 lần"
       để chờ gviz lan truyền (xem refreshSoon() trong App.tsx cũ).
     - Poll thưa hơn: DB trả dữ liệu đã đúng ngay khi ghi xong, 60s chỉ để bắt
       thay đổi của NGƯỜI KHÁC.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadRegion, type DbSheetData } from "./lichTaiApi";
import { startPoll } from "../poll";
import { REFRESH_MS } from "../../config";

const EMPTY: DbSheetData = {
  routes: [], categories: [], lastSync: null, loading: true, error: null, missingGeo: [],
};

export function useLichTai(regionKey: string) {
  const [data, setData] = useState<DbSheetData>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const keyRef = useRef(regionKey);
  keyRef.current = regionKey;

  const run = useCallback(async (manual: boolean) => {
    const mine = keyRef.current;
    const ctrl = new AbortController();
    if (manual) setRefreshing(true);
    else setData((d) => ({ ...d, loading: d.routes.length === 0, error: null }));
    try {
      const res = await loadRegion(mine, ctrl.signal);
      if (keyRef.current !== mine) return;      // đã đổi vùng -> bỏ kết quả cũ
      setData(res);
    } catch (e: unknown) {
      if (keyRef.current !== mine) return;
      setData((d) => ({ ...d, loading: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (keyRef.current === mine) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setData(EMPTY);
    run(false);
    return startPoll(() => run(false), REFRESH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  const refresh = useCallback(() => run(true), [run]);
  return { data, refreshing, refresh };
}
