/* ============================================================
   "BC xin tăng cường" — đọc tab ticket xin xe TC (workbook chính).
   Cột: D=tên BC (chọn sẵn) · E=tên BC khi chọn "Khác" · F=Lộ trình ·
   J=Số lượng kiện · K=Thể tích cần · L=Ngày mong muốn (dd/mm hh:mm) · N=Trạng thái.
   Bỏ dòng Trạng thái "Hủy - Nhập sai". Realtime.
   DEDUPE (2026-07-19, sửa lại 2026-07-20, sửa lại lần nữa 2026-07-30 theo yêu cầu Sếp):
   cùng BC + cùng Số lượng kiện + cùng Thể tích cần, VÀ các lần gửi liên tiếp cách nhau
   <= XTC_DEDUPE_WINDOW_MIN phút (gộp theo "phiên" — session, xem dedupeXtc()) -> 1 BC gửi
   ticket TRÙNG (bấm gửi 2 lần / mạng lag / gửi lại để sửa) chứ KHÔNG phải 2 yêu cầu xe
   riêng biệt. "Cùng BC + cùng kiện + cùng thể tích" mà cách nhau NHIỀU GIỜ trong ngày là
   2 NHU CẦU THẬT KHÁC NHAU (vd sáng xin 1 xe, tối phát sinh thêm 1 xe khác) — trùng
   kiện/thể tích lúc đó chỉ là ngẫu nhiên, KHÔNG được gộp.
   ⚠️ BÀI HỌC (đã xảy ra 2 lần, đều do gộp theo "cùng ngày" chung chung thay vì theo
   KHOẢNG CÁCH THỜI GIAN THẬT giữa các lần gửi):
   - 2026-07-20: bản đầu chỉ so ngày NỘP (không có ngày mong muốn) -> gộp nhầm 19 yêu cầu
     thật (2 lần gửi cách nhau 16 tiếng, trùng kiện/thể tích ngẫu nhiên). Đã vá tạm bằng
     cách thêm "ngày mong muốn" vào khoá.
   - 2026-07-30: kiểm lại trên data thật (2564 dòng) phát hiện nếu gộp theo đúng NGÀY NỘP
     (không cần giờ) như đề xuất ban đầu thì gộp THÊM 189 nhóm/248 dòng — nhưng ~36% các
     cặp bị gộp thêm đó cách nhau HƠN 3 TIẾNG (có cặp tới 22 tiếng), rõ ràng là các lần
     xin xe khác nhau trong ngày chứ không phải gửi trùng. -> Bỏ hẳn cách gộp "theo ngày",
     thay bằng gộp "theo phiên" dựa đúng vào KHOẢNG CÁCH PHÚT giữa 2 lần gửi liên tiếp
     (kiểm chứng với cửa sổ 60 phút: chỉ 103 phiên/118 dòng bị gộp, và trong đó chỉ 3
     phiên có ngày-mong-muốn lệch nhau — cả 3 đều là gửi sát nhau quanh nửa đêm, dễ hiểu
     là BC sửa lại giờ mong muốn của CÙNG 1 nhu cầu chứ không phải 2 nhu cầu khác nhau).
   Giữ lại bản ĐÃ ĐÁP ỨNG nếu phiên có ít nhất 1 bản "Có xe" (xem pickBestOfSession()),
   không thì giữ bản Timestamp mới nhất trong phiên — logic ưu tiên này giữ nguyên như
   bản 2026-07-20, không đổi.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { withRetry } from "./retry";
import { SHEET_ID, XIN_TC_GID, sheetCsvSources } from "../config";

export interface XtcRec {
  date: string;        // ISO yyyy-mm-dd (ngày NỘP, từ Timestamp)
  bc: string;          // tên bưu cục (đã bỏ tiền tố "Khác:")
  loTrinh: string;     // cột F
  soLuongKien: string; // cột J — cùng BC+kiện+thể tích+gần giờ nhau = nhận diện ticket TRÙNG (xem dedupeXtc())
  theTich: string;     // cột K
  desiredDay: string;  // "dd/mm" từ cột "Ngày mong muốn" (bỏ giờ) — chỉ để hiển thị, KHÔNG còn nằm trong khoá so trùng (xem lịch sử dedupeXtc())
  trangThai: string;   // cột N
  coXe: boolean | null; // true=Có xe, false=Không có xe, null=hủy/khác
  huy: boolean;        // trạng thái Hủy (trừ "Nhập sai" đã loại)
  ts: string;          // Timestamp gốc (dd/mm/yyyy hh:mm:ss) — dùng để chọn bản GẦN NHẤT khi dedupe
}
export interface XtcData { recs: XtcRec[]; ok: boolean; lastSync: number; }

/** "31/03/26" | "31/03/2026" -> "2026-03-31". */
function parseDMY(s: string): string {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** "Ngày mong muốn" dạng "dd/mm hh:mm" (KHÔNG có năm) -> "dd/mm" (bỏ giờ, dùng so trùng). */
function parseDesiredDay(s: string): string {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}` : "";
}

/** Lấy tên BC sạch: bỏ tiền tố "Khác:" ; nếu D rỗng thì dùng E. */
function cleanBc(d: string, e: string): string {
  let name = (d || "").trim().replace(/^kh[áa]c\s*:?\s*/i, "").trim();
  if (!name) name = (e || "").trim().replace(/^kh[áa]c\s*:?\s*/i, "").trim();
  return name;
}

async function fetchFirstOnce(signal?: AbortSignal): Promise<string> {
  for (const base of sheetCsvSources(SHEET_ID, XIN_TC_GID)) {
    const res = await fetch(base + (base.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store", signal });
    if (res.ok) {
      const t = await res.text();
      if (t.trim().length > 5 && !/^\s*<!doctype html|requires you to sign in|Unauthorized/i.test(t.slice(0, 200))) return t;
    }
  }
  throw new Error("Không tải được BC xin tăng cường");
}

/** Tải CSV xin tăng cường — tự thử lại khi Google lỗi tạm thời; hết lượt vẫn lỗi -> null. */
async function fetchFirst(signal?: AbortSignal): Promise<string | null> {
  try {
    return await withRetry(() => fetchFirstOnce(signal));
  } catch {
    return null;
  }
}

export async function loadXinTc(signal?: AbortSignal): Promise<XtcData> {
  const text = await fetchFirst(signal);
  if (!text) return { recs: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { recs: [], ok: false, lastSync: Date.now() };
  const H = rows[0];
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
  // Dò cột theo tiêu đề; fallback về vị trí cố định nếu không thấy.
  const cD = findCol(H, ["warehouse"]) >= 0 ? findCol(H, ["warehouse"]) : 3;
  const cE = findCol(H, ["nhap ten bc", "nhập tên bc"]) >= 0 ? findCol(H, ["nhap ten bc", "nhập tên bc"]) : 4;
  const cF = findCol(H, ["lo trinh", "lộ trình"]) >= 0 ? findCol(H, ["lo trinh", "lộ trình"]) : 5;
  const cJ = findCol(H, ["so luong kien", "số lượng kiện"]) >= 0 ? findCol(H, ["so luong kien", "số lượng kiện"]) : 9;
  const cK = findCol(H, ["the tich", "thể tích"]) >= 0 ? findCol(H, ["the tich", "thể tích"]) : 10;
  const cL = findCol(H, ["ngay mong muon", "ngày mong muốn"]) >= 0 ? findCol(H, ["ngay mong muon", "ngày mong muốn"]) : 11;
  const cN = findCol(H, ["trang thai", "trạng thái"]) >= 0 ? findCol(H, ["trang thai", "trạng thái"]) : 13;
  // Timestamp (A) — luôn có (tự sinh) để làm ngày lượt xin -> KHÔNG mất lượt xin.
  const cTs = (() => { const c = findCol(H, ["timestamp", "thoi gian", "thời gian"]); return c >= 0 ? c : 0; })();

  const recs: XtcRec[] = [];
  for (const r of rows.slice(1)) {
    const trangThai = g(r, cN);
    if (/nh[ậa]p\s*sai/i.test(trangThai)) continue; // bỏ "Hủy - Nhập sai"
    const bc = cleanBc(g(r, cD), g(r, cE));
    if (!bc) continue;
    // NGÀY của lượt xin = ngày trong cột Timestamp (A) — lấy ngày/tháng/năm, BỎ giờ.
    // Timestamp luôn có (tự sinh) -> mọi lượt xin đều hiển thị, không mất data.
    const date = parseDMY(g(r, cTs));
    if (!date) continue;
    // Phân loại theo TRẠNG THÁI (cột N), KHÔNG phụ thuộc cột "Ngày" (O):
    //   "Không có xe" HOẶC "Hủy - BC không đợi tải" -> false (KHÔNG đáp ứng)
    //   "Có xe" (khớp đúng, không lẫn phần "Không có xe")                   -> true  (đáp ứng được)
    //   còn lại (RỖNG/chưa cập nhật, "BC đã book xe", hủy lý do khác…)      -> null  (chờ/khác — không
    //     tính vào tỷ lệ đáp ứng, xem rateOf()/denom ở XinTcPanel.tsx đã có sẵn cơ chế loại trừ null)
    // ("Hủy - Nhập sai" đã bị loại ở trên, không tính.)
    // FIX 2026-08-08: bản trước coi MỌI giá trị khác "Không có xe" là true (kể cả RỖNG — ticket vừa
    // gửi, ĐANG CHỜ xử lý) -> tỷ lệ đáp ứng bị thổi phồng (vd thực tế 3/8 "Có xe" hiện thành ảo cao
    // hơn hẳn vì 5 dòng rỗng cũng bị tính là "đáp ứng"). Đã kiểm chứng bằng data thật trên Sheet
    // (2983 dòng): "Có xe" 2235 · "Không có xe" 410 · "" 6 · "BC đã book xe" 2 · hủy khác 1.
    const khongCoXe = /kh[ôo]ng\s*c[óo]\s*xe/i.test(trangThai) || /kh[ôo]ng\s*đợi\s*t/i.test(trangThai);
    const coXe = khongCoXe ? false : /^c[óo]\s*xe\b/i.test(trangThai) ? true : null;
    recs.push({ date, bc, loTrinh: g(r, cF), soLuongKien: g(r, cJ), theTich: g(r, cK), desiredDay: parseDesiredDay(g(r, cL)), trangThai, coXe, huy: /h[ủu]y/i.test(trangThai), ts: g(r, cTs) });
  }
  return { recs: dedupeXtc(recs), ok: true, lastSync: Date.now() };
}

/** Timestamp "dd/mm/yyyy hh:mm:ss" -> mili-giây, dùng để đo khoảng cách phút giữa 2 lần gửi. */
function tsToMs(ts: string): number {
  const m = (ts || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

/** Cửa sổ gộp phiên (phút) — 2 lần gửi liên tiếp cách nhau trong khoảng này mới coi là
 *  CÙNG 1 yêu cầu bị gửi trùng. Chốt 2026-07-30 sau khi kiểm trên data thật: 60 phút đủ
 *  rộng để bắt các lần "gửi lại vì trùng/mạng lag" nhưng không gộp nhầm 2 nhu cầu thật
 *  phát sinh cách nhau vài giờ trong ngày. */
const XTC_DEDUPE_WINDOW_MIN = 60;

/** Trong 1 phiên trùng: ưu tiên giữ bản "Có xe" (như đã chốt 2026-07-20); nếu cả phiên đều
 *  Có xe hoặc đều Không có xe thì giữ bản Timestamp mới nhất trong phiên. */
function pickBestOfSession(session: XtcRec[]): XtcRec {
  const okOnes = session.filter((r) => r.coXe === true);
  const pool = okOnes.length ? okOnes : session;
  return pool.reduce((best, r) => (tsToMs(r.ts) >= tsToMs(best.ts) ? r : best));
}

/** Gộp ticket TRÙNG (xem lịch sử đầy đủ ở comment đầu file): cùng BC + cùng Số lượng kiện +
 *  cùng Thể tích cần, VÀ khoảng cách tới lần gửi liền trước trong cùng khoá <= XTC_DEDUPE_WINDOW_MIN
 *  phút -> 1 yêu cầu bị gửi trùng. Gộp theo PHIÊN (session), không phải theo "cùng ngày": sắp các
 *  bản ghi cùng khoá theo Timestamp tăng dần, bản kế tiếp cách bản liền trước <= cửa sổ thì nhập
 *  cùng phiên (nối chuỗi — cả phiên có thể dài hơn cửa sổ nếu gửi liên tục), hết phiên (gap > cửa
 *  sổ) thì tách phiên mới. Mỗi phiên chỉ giữ 1 bản đại diện (xem pickBestOfSession()). */
function dedupeXtc(recs: XtcRec[]): XtcRec[] {
  const byKey = new Map<string, XtcRec[]>();
  let seq = 0;
  for (const r of recs) {
    // Kiện + thể tích ĐỀU rỗng -> không đủ căn cứ so trùng, mỗi dòng giữ riêng (tránh gộp nhầm).
    const key = (!r.soLuongKien && !r.theTich) ? `__uniq__${seq++}` : [r.bc, r.soLuongKien, r.theTich].join("||");
    const arr = byKey.get(key);
    if (arr) arr.push(r); else byKey.set(key, [r]);
  }
  const out: XtcRec[] = [];
  for (const arr of byKey.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    const sorted = [...arr].sort((a, b) => tsToMs(a.ts) - tsToMs(b.ts));
    let session: XtcRec[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const gapMin = (tsToMs(sorted[i].ts) - tsToMs(session[session.length - 1].ts)) / 60000;
      if (gapMin <= XTC_DEDUPE_WINDOW_MIN) {
        session.push(sorted[i]);
      } else {
        out.push(pickBestOfSession(session));
        session = [sorted[i]];
      }
    }
    out.push(pickBestOfSession(session));
  }
  return out;
}

/* ---------- Gom số liệu theo kỳ ---------- */
export type Gran = "ngay" | "tuan" | "thang";

/** Khoá kỳ của 1 ngày ISO theo độ chia. tuan = thứ Hai đầu tuần. */
export function periodKey(iso: string, gran: Gran): string {
  if (!iso) return "";
  if (gran === "thang") return iso.slice(0, 7); // yyyy-mm
  if (gran === "ngay") return iso;
  // tuần: lùi về thứ Hai
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = thứ Hai
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Nhãn kỳ đẹp để hiển thị. */
export function periodLabel(key: string, gran: Gran): string {
  if (!key) return "—";
  if (gran === "thang") { const [y, m] = key.split("-"); return `Tháng ${m}/${y}`; }
  const [y, m, d] = key.split("-");
  if (gran === "ngay") return `${d}/${m}/${y}`;
  // tuần: từ thứ Hai (key) -> Chủ Nhật
  const start = new Date(key + "T00:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const dm = (x: Date) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
  return `Tuần ${dm(start)}–${dm(end)}/${y}`;
}

export interface XtcStats {
  total: number; coXe: number; khongXe: number; huy: number;
  rate: number | null; // tỷ lệ đáp ứng = coXe / (coXe + khongXe)
  // LƯU Ý: mỗi bản ghi (dòng form) = 1 XE xin. 1 bưu cục có thể xin NHIỀU xe/ngày.
  bcCount: number;      // số bưu cục RIÊNG (distinct) đã xin trong kỳ
  avgXePerBc: number;   // TB số xe / bưu cục trong kỳ
  maxXeDay: number;     // 1 bưu cục xin NHIỀU nhất mấy xe trong 1 NGÀY
  maxXeDayBc: string;   // bưu cục lập kỷ lục đó
  multiXeDays: number;  // số lượt (bưu cục × ngày) xin ≥ 2 xe
  topBc: { bc: string; n: number; coXe: number; khongXe: number; rate: number | null; maxDay: number }[];
}

/** Sinh danh sách kỳ TỪ HÔM NAY đổ về (KHÔNG phụ thuộc dữ liệu) — tránh ngày rác
 *  như "30/12/2099" nhảy lên đầu & bị chọn mặc định. ngay=N ngày gần nhất,
 *  tuan=N tuần (mốc thứ Hai), thang=N tháng gần nhất. Phần tử [0] = kỳ hiện tại. */
export function recentPeriods(gran: Gran, count: number, today = new Date()): string[] {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out: string[] = [];
  if (gran === "thang") {
    let y = today.getFullYear(), m = today.getMonth(); // 0-based
    for (let i = 0; i < count; i++) { out.push(`${y}-${String(m + 1).padStart(2, "0")}`); if (--m < 0) { m = 11; y--; } }
  } else if (gran === "ngay") {
    const d = new Date(today);
    for (let i = 0; i < count; i++) { out.push(ymd(d)); d.setDate(d.getDate() - 1); }
  } else { // tuan: lùi về thứ Hai rồi nhảy lùi 7 ngày
    const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    for (let i = 0; i < count; i++) { out.push(ymd(d)); d.setDate(d.getDate() - 7); }
  }
  return out;
}

export interface DayBar { key: string; label: string; total: number; coXe: number; khongXe: number; }

/** Chuỗi theo NGÀY của N ngày GẦN NHẤT (kết thúc hôm nay), bất kể tháng — dùng
 *  cho biểu đồ đường xu hướng. label = "dd/mm". Trả cũ -> mới. */
export function lastNDays(recs: XtcRec[], n: number, today = new Date()): DayBar[] {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days: string[] = [];
  const d = new Date(today);
  for (let i = 0; i < n; i++) { days.push(ymd(d)); d.setDate(d.getDate() - 1); }
  days.reverse();
  const map = new Map<string, DayBar>();
  for (const k of days) map.set(k, { key: k, label: `${k.slice(8)}/${k.slice(5, 7)}`, total: 0, coXe: 0, khongXe: 0 });
  for (const r of recs) {
    const b = map.get(r.date);
    if (!b) continue;
    b.total++;
    if (r.coXe === true) b.coXe++; else if (r.coXe === false) b.khongXe++;
  }
  return days.map((k) => map.get(k)!);
}

/** Chuỗi theo NGÀY để vẽ biểu đồ cho kỳ đang chọn (zero-fill các ngày trống).
 *  thang -> mỗi ngày trong tháng; tuan -> 7 ngày T2..CN; ngay -> rỗng (1 ngày không cần biểu đồ). */
export function seriesByDay(recs: XtcRec[], gran: Gran, sel: string): DayBar[] {
  if (!sel || gran === "ngay") return [];
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days: string[] = [];
  if (gran === "thang") {
    const [y, m] = sel.split("-").map(Number);
    const n = new Date(y, m, 0).getDate(); // số ngày trong tháng
    for (let d = 1; d <= n; d++) days.push(`${sel}-${String(d).padStart(2, "0")}`);
  } else { // tuan: sel là thứ Hai
    const start = new Date(sel + "T00:00:00");
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(ymd(d)); }
  }
  const map = new Map<string, DayBar>();
  for (const k of days) map.set(k, { key: k, label: k.slice(8), total: 0, coXe: 0, khongXe: 0 }); // label = "dd"
  for (const r of recs) {
    const b = map.get(r.date);
    if (!b) continue;
    b.total++;
    if (r.coXe === true) b.coXe++; else if (r.coXe === false) b.khongXe++;
  }
  return days.map((k) => map.get(k)!);
}

/** Tính KPI + top BC cho 1 tập bản ghi (đã lọc theo kỳ). topN lớn -> trả đủ để tìm kiếm. */
export function statsOf(recs: XtcRec[], topN = 9999): XtcStats {
  let coXe = 0, khongXe = 0, huy = 0;
  // Mỗi bản ghi = 1 XE. Gom theo bưu cục + theo (bưu cục × NGÀY) để đo "nhiều xe/ngày".
  const byBc = new Map<string, { n: number; coXe: number; khongXe: number; maxDay: number }>();
  const byBcDay = new Map<string, number>(); // "bc||ngày" -> số xe ngày đó
  for (const r of recs) {
    if (r.coXe === true) coXe++; else if (r.coXe === false) khongXe++;
    if (r.huy) huy++;
    let b = byBc.get(r.bc);
    if (!b) { b = { n: 0, coXe: 0, khongXe: 0, maxDay: 0 }; byBc.set(r.bc, b); }
    b.n++; if (r.coXe === true) b.coXe++; else if (r.coXe === false) b.khongXe++;
    if (r.date) { const k = r.bc + "||" + r.date; byBcDay.set(k, (byBcDay.get(k) || 0) + 1); }
  }
  // Kỷ lục xe/ngày của mỗi bưu cục + số lượt ≥2 xe/ngày.
  let maxXeDay = 0, maxXeDayBc = "", multiXeDays = 0;
  for (const [k, v] of byBcDay) {
    if (v >= 2) multiXeDays++;
    const bc = k.slice(0, k.indexOf("||"));
    const rec = byBc.get(bc); if (rec && v > rec.maxDay) rec.maxDay = v;
    if (v > maxXeDay) { maxXeDay = v; maxXeDayBc = bc; }
  }
  const denom = coXe + khongXe;
  const topBc = [...byBc.entries()]
    .map(([bc, v]) => ({ bc, n: v.n, coXe: v.coXe, khongXe: v.khongXe, rate: (v.coXe + v.khongXe) ? v.coXe / (v.coXe + v.khongXe) : null, maxDay: v.maxDay }))
    .sort((a, b) => b.n - a.n)
    .slice(0, topN);
  return {
    total: recs.length, coXe, khongXe, huy, rate: denom ? coXe / denom : null,
    bcCount: byBc.size, avgXePerBc: byBc.size ? recs.length / byBc.size : 0,
    maxXeDay, maxXeDayBc, multiXeDays, topBc,
  };
}

/* ---------- So sánh CÙNG KỲ (kỳ này vs kỳ liền trước) ---------- */
/** Kỳ liền trước: tháng trước / tuần trước / cùng thứ tuần trước (với ngày). */
function prevKeyOf(sel: string, gran: Gran): string {
  if (gran === "thang") {
    let [y, m] = sel.split("-").map(Number);
    m--; if (m < 1) { m = 12; y--; }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const d = new Date(sel + "T00:00:00");
  d.setDate(d.getDate() - 7); // tuần trước / cùng thứ tuần trước
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CmpBar { label: string; date: string; cur: number; prev: number; weekend: boolean; beyond: boolean }
export interface CmpResult {
  curLabel: string; prevLabel: string;
  partial: boolean; asOf: string;              // kỳ đang diễn ra -> chỉ so tới "asOf" (cùng kỳ tính đến ngày)
  curTotal: number; prevTotal: number; changePct: number | null; changeAbs: number;
  curRate: number | null; prevRate: number | null; // tỷ lệ đáp ứng (trên vùng so sánh)
  curAvg: number; prevAvg: number;             // TB lượt/ngày (trên số ngày so sánh)
  curPeak: { label: string; val: number }; prevPeak: { label: string; val: number };
  daysUp: number; daysDown: number;            // số ngày kỳ này > / < kỳ trước
  bars: CmpBar[];
}
/**
 * So sánh CÙNG KỲ, căn theo ngày. Nếu kỳ ĐANG diễn ra (chứa hôm nay) thì chỉ so
 * phần đã trôi qua (vd T7 ngày 1–7 vs T6 ngày 1–7) để công bằng, không so nửa tháng với cả tháng.
 */
export function comparePeriods(recs: XtcRec[], gran: Gran, sel: string, today = new Date()): CmpResult | null {
  if (!sel) return null;
  const prevKey = prevKeyOf(sel, gran);
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const isCurrent = periodKey(todayIso, gran) === sel;

  let nDays: number, elapsed: number;
  let slotDate: (i: number) => Date, dayIdx: (iso: string) => number, labelOf: (i: number) => string;
  if (gran === "thang") {
    const [y, m] = sel.split("-").map(Number);
    nDays = new Date(y, m, 0).getDate();
    slotDate = (i) => new Date(y, m - 1, i + 1);
    dayIdx = (iso) => Number(iso.slice(8, 10)) - 1;
    labelOf = (i) => `${i + 1}`;
    elapsed = isCurrent ? today.getDate() : nDays;
  } else if (gran === "tuan") {
    nDays = 7;
    const mon = new Date(sel + "T00:00:00");
    slotDate = (i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; };
    dayIdx = (iso) => (new Date(iso + "T00:00:00").getDay() + 6) % 7;
    const wd = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    labelOf = (i) => wd[i];
    elapsed = isCurrent ? ((today.getDay() + 6) % 7) + 1 : 7;
  } else {
    nDays = 1; elapsed = 1;
    slotDate = () => new Date(sel + "T00:00:00");
    dayIdx = () => 0;
    labelOf = () => periodLabel(sel, "ngay");
  }

  const cur = recs.filter((r) => periodKey(r.date, gran) === sel);
  const prev = recs.filter((r) => periodKey(r.date, gran) === prevKey);
  const curCnt = new Array(nDays).fill(0), prevCnt = new Array(nDays).fill(0);
  for (const r of cur) { const i = dayIdx(r.date); if (i >= 0 && i < nDays) curCnt[i]++; }
  for (const r of prev) { const i = dayIdx(r.date); if (i >= 0 && i < nDays) prevCnt[i]++; }

  // Tỷ lệ đáp ứng trên VÙNG SO SÁNH (chỉ ngày đã trôi qua).
  const rateOf = (rs: XtcRec[]) => { let co = 0, kh = 0; for (const r of rs) { const i = dayIdx(r.date); if (i >= 0 && i < elapsed) { if (r.coXe === true) co++; else if (r.coXe === false) kh++; } } return co + kh ? co / (co + kh) : null; };

  const bars: CmpBar[] = [];
  let daysUp = 0, daysDown = 0;
  for (let i = 0; i < nDays; i++) {
    const dt = slotDate(i), we = dt.getDay() === 0 || dt.getDay() === 6, beyond = i >= elapsed;
    bars.push({ label: labelOf(i), date: `${dt.getDate()}/${dt.getMonth() + 1}`, cur: curCnt[i], prev: prevCnt[i], weekend: we, beyond });
    if (!beyond) { if (curCnt[i] > prevCnt[i]) daysUp++; else if (curCnt[i] < prevCnt[i]) daysDown++; }
  }
  const sum = (a: number[]) => a.slice(0, elapsed).reduce((x, y) => x + y, 0);
  const curTotal = sum(curCnt), prevTotal = sum(prevCnt);
  const peakOf = (cnt: number[]) => { let bi = 0, bv = -1; for (let i = 0; i < nDays; i++) if (cnt[i] > bv) { bv = cnt[i]; bi = i; } return { label: bars[bi]?.date || labelOf(bi), val: Math.max(0, bv) }; };
  return {
    curLabel: periodLabel(sel, gran), prevLabel: periodLabel(prevKey, gran),
    partial: isCurrent && elapsed < nDays,
    asOf: gran === "thang" ? `ngày ${elapsed}` : gran === "tuan" ? `${elapsed}/7 ngày` : "",
    curTotal, prevTotal, changePct: prevTotal ? (curTotal - prevTotal) / prevTotal : null, changeAbs: curTotal - prevTotal,
    curRate: rateOf(cur), prevRate: rateOf(prev),
    curAvg: curTotal / elapsed, prevAvg: prevTotal / elapsed,
    curPeak: peakOf(curCnt), prevPeak: peakOf(prevCnt),
    daysUp, daysDown, bars,
  };
}

/** Hôm nay dạng ISO — dùng chung cho các thành phần cần mốc "hiện tại". */
export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- SO SÁNH THEO EVENT: 3 mốc cố định trong tháng (ngày 7 / 15 / 25) ---------- */
/**
 * 3 "kỳ" mốc trong tháng để theo dõi xu hướng event (vd 7/7 vs 6/6, 15/7 vs 15/6…).
 * So SINGLE-DAY (đúng ngày đó), KHÔNG cộng dồn — để thấy đúng sức nóng của mốc.
 * Mốc chưa tới hôm nay -> reached=false, KHÔNG suy đoán số.
 */
export const EVENT_CHECKPOINT_DAYS = [7, 15, 25];
export interface EventCheckpoint {
  day: number; curIso: string; prevIso: string; reached: boolean;
  curTotal: number; prevTotal: number; curRate: number | null; prevRate: number | null;
}
export function eventCheckpoints(recs: XtcRec[], monthKey: string, today = new Date()): EventCheckpoint[] {
  const [y, m] = monthKey.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tIso = todayIso(today);
  let py = y, pm = m - 1; if (pm < 1) { pm = 12; py--; }

  const byDate = new Map<string, XtcRec[]>();
  for (const r of recs) { const a = byDate.get(r.date); if (a) a.push(r); else byDate.set(r.date, [r]); }
  const stat = (rs: XtcRec[]) => {
    let co = 0, kh = 0;
    for (const r of rs) { if (r.coXe === true) co++; else if (r.coXe === false) kh++; }
    return { total: rs.length, rate: co + kh ? co / (co + kh) : null };
  };

  return EVENT_CHECKPOINT_DAYS.map((day) => {
    const curIso = `${y}-${pad(m)}-${pad(day)}`;
    const prevIso = `${py}-${pad(pm)}-${pad(day)}`;
    const reached = curIso <= tIso;
    const cs = stat(reached ? byDate.get(curIso) || [] : []);
    const ps = stat(byDate.get(prevIso) || []);
    return { day, curIso, prevIso, reached, curTotal: cs.total, prevTotal: ps.total, curRate: cs.rate, prevRate: ps.rate };
  });
}

/* ============================================================
   ĐỀ XUẤT LỊCH TẢI CỐ ĐỊNH — dựa vào MẪU HÌNH xin xe THEO THỨ trong ~13 tuần
   gần nhất (đủ dài để tính "trung bình tháng" ổn định, không phải 1 tuần ăn may).
   BC xin đều 1 thứ nào đó (vd luôn xin T7+CN, hiếm khi xin ngày thường) ->
   đề xuất CỐ ĐỊNH xe các thứ đó, OFF các thứ còn lại. CHỈ dùng số liệu thật —
   BC chưa đủ tuần/lượt xin thì loại khỏi danh sách (không suy đoán).
   ============================================================ */
export const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
function dowOf(iso: string): number { return (new Date(iso + "T00:00:00").getDay() + 6) % 7; }

/** Tập hợp mốc-tuần (thứ Hai) phân biệt trong [fromIso, toIso]. */
function weeksBetween(fromIso: string, toIso: string): Set<string> {
  const out = new Set<string>();
  const d = new Date(fromIso + "T00:00:00");
  const end = new Date(toIso + "T00:00:00");
  while (d <= end) {
    out.add(periodKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, "tuan"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export interface DowPattern {
  dow: number; label: string;
  weeksWithReq: number; // số tuần (kể từ lần xin đầu) có xin vào thứ này
  freq: number;         // weeksWithReq / số tuần BC đã hoạt động — độ đều đặn 0..1
  reqCount: number;     // tổng lượt xin thứ này trong cửa sổ
  avgXe: number;        // TB xe / lần xin thứ này (khi CÓ xin)
  rate: number | null;  // tỷ lệ đáp ứng lịch sử thứ này
  status: "fixed" | "flex" | "off"; // đề xuất: cố định / linh động / không cần
}
export interface BcScheduleSuggest {
  bc: string;
  totalWeeks: number; totalReq: number; avgPerWeek: number;
  byDow: DowPattern[]; // 7 phần tử, thứ tự T2..CN
  fixedDows: number[];
  confidence: "cao" | "vừa" | "thấp";
  note: string;
}

const FIXED_TH = 0.6;  // >=60% số tuần hoạt động có xin -> đề xuất CỐ ĐỊNH
const OFF_TH = 0.15;   // <=15% -> OFF (không cần), còn lại là "linh động"
const MIN_WEEKS = 3;   // tối thiểu 3 tuần có xin mới đủ cơ sở đề xuất
const MIN_REQ = 3;     // và tối thiểu 3 lượt xin

/**
 * Đề xuất lịch cố định theo BƯU CỤC, dựa trên mẫu hình xin xe THEO THỨ trong
 * `windowDays` ngày gần nhất (mặc định 91 ~ 13 tuần). Độ đều đặn tính trên số
 * tuần BC ĐÃ HOẠT ĐỘNG (từ lần xin đầu trong cửa sổ tới nay) — không phạt BC
 * mới phát sinh gần đây bằng cách chia cho cả cửa sổ dài.
 */
export const SCHEDULE_WINDOW_DAYS = 91;

/** Khoảng ngày [từ, đến] mà buildScheduleSuggestions() đang phân tích — hiển thị cho rõ cơ sở tính. */
export function scheduleWindowRange(windowDays = SCHEDULE_WINDOW_DAYS, today = new Date()): { fromIso: string; toIso: string } {
  const toIso = todayIso(today);
  const fromD = new Date(today); fromD.setDate(fromD.getDate() - windowDays);
  return { fromIso: todayIso(fromD), toIso };
}

export function buildScheduleSuggestions(recs: XtcRec[], windowDays = SCHEDULE_WINDOW_DAYS, today = new Date()): BcScheduleSuggest[] {
  const { fromIso, toIso } = scheduleWindowRange(windowDays, today);

  const inWin = recs.filter((r) => r.date >= fromIso && r.date <= toIso);
  const byBc = new Map<string, XtcRec[]>();
  for (const r of inWin) { const a = byBc.get(r.bc); if (a) a.push(r); else byBc.set(r.bc, [r]); }

  const out: BcScheduleSuggest[] = [];
  for (const [bc, rs] of byBc) {
    if (rs.length < MIN_REQ) continue;
    const firstIso = rs.reduce((m, r) => (r.date < m ? r.date : m), rs[0].date);
    const bcWeeks = new Set(rs.map((r) => periodKey(r.date, "tuan")));
    if (bcWeeks.size < MIN_WEEKS) continue; // chưa đủ cơ sở

    const activeWeeks = weeksBetween(firstIso, toIso).size || 1;

    const byDowMap = new Map<number, XtcRec[]>();
    for (const r of rs) { const d = dowOf(r.date); const a = byDowMap.get(d); if (a) a.push(r); else byDowMap.set(d, [r]); }

    const byDow: DowPattern[] = [];
    const fixedDows: number[] = [];
    for (let d = 0; d < 7; d++) {
      const rr = byDowMap.get(d) || [];
      const weeksWithReq = new Set(rr.map((r) => periodKey(r.date, "tuan"))).size;
      const freq = weeksWithReq / activeWeeks;
      let co = 0, kh = 0;
      for (const r of rr) { if (r.coXe === true) co++; else if (r.coXe === false) kh++; }
      const status: DowPattern["status"] = freq >= FIXED_TH ? "fixed" : freq <= OFF_TH ? "off" : "flex";
      if (status === "fixed") fixedDows.push(d);
      byDow.push({ dow: d, label: DOW_LABELS[d], weeksWithReq, freq, reqCount: rr.length, avgXe: weeksWithReq ? rr.length / weeksWithReq : 0, rate: co + kh ? co / (co + kh) : null, status });
    }

    const confidence: BcScheduleSuggest["confidence"] = bcWeeks.size >= 8 && rs.length >= 10 ? "cao" : bcWeeks.size >= 5 ? "vừa" : "thấp";
    const note = (() => {
      if (!fixedDows.length) return "Xin rải rác, không có thứ nào đều đặn → giữ linh động (xin theo yêu cầu khi cần).";
      const names = fixedDows.map((d) => DOW_LABELS[d]).join(", ");
      const worstRate = Math.min(...fixedDows.map((d) => byDow[d].rate ?? 1));
      const urgent = worstRate < 0.8 ? ` Đáp ứng hiện tại chỉ ${Math.round(worstRate * 100)}% những ngày này → nên xếp lịch cố định sớm.` : "";
      return `Xin đều ${names} (≥${Math.round(FIXED_TH * 100)}% số tuần hoạt động) → đề xuất CỐ ĐỊNH xe.${urgent}`;
    })();

    out.push({ bc, totalWeeks: bcWeeks.size, totalReq: rs.length, avgPerWeek: rs.length / bcWeeks.size, byDow, fixedDows, confidence, note });
  }
  // Ưu tiên BC có đề xuất cố định lên đầu, rồi theo tổng lượt xin giảm dần.
  out.sort((a, b) => (b.fixedDows.length - a.fixedDows.length) || (b.totalReq - a.totalReq));
  return out;
}
