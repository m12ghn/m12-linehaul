import { useState } from "react";
import { periodKey, todayIso, type XtcRec } from "../lib/xinTangCuong";
import { XinTcCompare } from "./XinTcCompare";
import { XinTcEventCompare } from "./XinTcEventCompare";

type Tab = "thang" | "tuan" | "event";
const TABS: { key: Tab; label: string }[] = [
  { key: "thang", label: "📅 Theo Tháng" },
  { key: "tuan", label: "🗓️ Theo Tuần" },
  { key: "event", label: "🎯 Theo Event" },
];

/**
 * SO SÁNH — 3 góc nhìn ĐỘC LẬP với bộ lọc kỳ ở trên (luôn bám hôm nay):
 *  - Theo Tháng: tháng hiện tại vs tháng liền trước (căn theo ngày đã trôi qua).
 *  - Theo Tuần: tuần hiện tại (T2→CN) vs tuần liền trước.
 *  - Theo Event: 3 mốc cố định trong tháng (ngày 7 / 15 / 25) so ĐÚNG NGÀY với tháng trước
 *    (vd 7/7 vs 6/6, 15/7 vs 15/6, 25/7 vs 25/6) — theo dõi sức nóng event lặp lại theo tháng.
 */
export function XinTcCompareTabs({ recs }: { recs: XtcRec[] }) {
  const [tab, setTab] = useState<Tab>("thang");
  const monthSel = periodKey(todayIso(), "thang");
  const weekSel = periodKey(todayIso(), "tuan");

  return (
    <div>
      <div className="xtc-seg" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === "thang" && <XinTcCompare recs={recs} gran="thang" sel={monthSel} />}
      {tab === "tuan" && <XinTcCompare recs={recs} gran="tuan" sel={weekSel} />}
      {tab === "event" && <XinTcEventCompare recs={recs} monthSel={monthSel} />}
    </div>
  );
}
