/* ============================================================
   Gộp danh sách ngày (YYYY-MM-DD) thành các KỲ theo Ngày / Tuần / Tháng
   cho báo cáo "Tổng TLLD của Cụm". Quy ước TUẦN (đã thống nhất với Sếp):
   CN (Chủ Nhật) -> T7, vd Tuần "12/7–18/7" = CN 12/7 đến T7 18/7.
   Tháng/Ngày tính theo lịch chuẩn (calendar month / calendar day).
   ============================================================ */

export type Granularity = "ngay" | "tuan" | "thang" | "d14" | "d30" | "d60";

/** Granularity nào dùng bucket LĂN (N ngày liên tiếp tính lùi từ hôm nay), không theo lịch. */
const ROLLING_DAYS: Partial<Record<Granularity, number>> = { d14: 14, d30: 30, d60: 60 };

export interface Period {
  key: string; // khoá duy nhất (ngày: chính nó; tuần: ngày CN; tháng: "YYYY-MM")
  label: string; // nhãn đầy đủ, vd "12/7–18/7", "Tháng 7/2026", "19/07"
  shortLabel: string; // nhãn gọn cho trục biểu đồ
  start: string; // ISO ngày bắt đầu kỳ
  end: string; // ISO ngày kết thúc kỳ (bao gồm)
  dates: string[]; // các ngày THẬT có dữ liệu rơi vào kỳ này (tăng dần)
  running: boolean; // kỳ CHƯA kết thúc tính tới hôm nay (đang chạy dở, chưa đủ để so sánh chắc chắn)
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function isoOfDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function dowOf(iso: string): number {
  return new Date(iso + "T00:00:00").getDay(); // 0=CN...6=T7
}
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Ngày CHỦ NHẬT bắt đầu tuần chứa `iso` (quy ước CN -> T7). */
export function sundayOf(iso: string): string {
  return addDaysISO(iso, -dowOf(iso));
}
export function weekLabel(sunIso: string): string {
  return `${ddmm(sunIso)}–${ddmm(addDaysISO(sunIso, 6))}`;
}

/** Số tuần ISO-8601 chuẩn (neo vào ngày Thứ Năm của tuần chứa `iso`) — vd 4/8/2026 (Thứ Ba) -> 32.
 *  Dùng ĐƯỢC trực tiếp với tuần CN->T7 của dự án: Thứ Năm luôn nằm trong cả 2 cách chia tuần
 *  (CN->T7 và Thứ Hai->CN chuẩn ISO) nên số tuần ra đúng dù dự án neo tuần theo CN, không theo T2. */
export function isoWeekNumber(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const dayNum = (d.getDay() + 6) % 7; // Thứ Hai=0 ... Chủ Nhật=6
  d.setDate(d.getDate() - dayNum + 3); // -> Thứ Năm của tuần chứa iso
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `Tháng ${Number(m)}/${y}`;
}

/** Gộp `dates` thành các kỳ LĂN N-ngày liên tiếp, tính lùi từ HÔM NAY (không theo lịch tuần/tháng
 *  như "tuan"/"thang" — vd 14/30/60 ngày không có mốc lịch chuẩn để neo). Kỳ 0 = N ngày gần nhất
 *  tính tới hôm nay, kỳ -1 = N ngày liền trước đó, v.v. — luôn khớp lại từ hôm nay dù dữ liệu đổi. */
function buildRollingPeriods(dates: string[], days: number, todayIso: string): Period[] {
  const bucketOfDate = (d: string) => Math.floor(daysBetweenISO(todayIso, d) / days);
  const buckets = new Map<number, string[]>();
  for (const d of dates) {
    const k = bucketOfDate(d);
    const arr = buckets.get(k);
    if (arr) arr.push(d); else buckets.set(k, [d]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b - a) // xa nhất -> gần nhất (bucket lớn = xa quá khứ)
    .map(([k, ds]) => {
      const end = addDaysISO(todayIso, -(k * days));
      const start = addDaysISO(end, -(days - 1));
      return { key: String(k), label: `${ddmm(start)}–${ddmm(end)}`, shortLabel: `${ddmm(start)}–${ddmm(end)}`, start, end, dates: ds, running: end >= todayIso };
    });
}
function daysBetweenISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad), db = Date.UTC(by, bm - 1, bd);
  return Math.round((da - db) / 86400000);
}

/** Gộp `dates` (đã có dữ liệu thật) thành các kỳ theo `granularity`, tăng dần theo thời gian. */
export function buildPeriods(dates: string[], granularity: Granularity): Period[] {
  if (!dates.length) return [];
  const todayIso = isoOfDate(new Date());

  if (granularity === "ngay") {
    return dates.map((d) => ({
      key: d, label: ddmm(d), shortLabel: ddmm(d),
      start: d, end: d, dates: [d],
      running: d >= todayIso,
    }));
  }

  const rollingDays = ROLLING_DAYS[granularity];
  if (rollingDays) return buildRollingPeriods(dates, rollingDays, todayIso);

  const buckets = new Map<string, string[]>();
  const bucketOf = granularity === "tuan" ? sundayOf : monthKeyOf;
  for (const d of dates) {
    const k = bucketOf(d);
    const arr = buckets.get(k);
    if (arr) arr.push(d); else buckets.set(k, [d]);
  }

  if (granularity === "tuan") {
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([sun, ds]) => {
        const end = addDaysISO(sun, 6);
        const wn = isoWeekNumber(addDaysISO(sun, 4)); // Thứ Năm của tuần CN->T7 này
        return { key: sun, label: `Tuần ${wn} · ${weekLabel(sun)}`, shortLabel: `T${wn}`, start: sun, end, dates: ds, running: end >= todayIso };
      });
  }

  // thang
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, ds]) => {
      const [y, m] = key.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const start = `${key}-01`, end = `${key}-${pad2(lastDay)}`;
      return { key, label: monthLabel(key), shortLabel: `T${m}/${String(y).slice(2)}`, start, end, dates: ds, running: end >= todayIso };
    });
}

export const GRAN_LABEL: Record<Granularity, string> = { ngay: "Ngày", tuan: "Tuần", thang: "Tháng", d14: "14 Ngày", d30: "30 Ngày", d60: "60 Ngày" };
export const GRAN_UNIT: Record<Granularity, string> = { ngay: "ngày trước", tuan: "tuần trước", thang: "tháng trước", d14: "kỳ 14 ngày trước", d30: "kỳ 30 ngày trước", d60: "kỳ 60 ngày trước" };
