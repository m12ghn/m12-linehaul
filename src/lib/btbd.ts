/* ============================================================
   BẢO TRÌ BẢO DƯỠNG (BTBD) — đọc trực tiếp Google Sheet (3 tab: "Data xe",
   "Data BTBD", "Lịch sử Bảo dưỡng - sửa chữa"), KHÔNG qua DB riêng.

   07/09/2026, Sếp chốt (qua AskUserQuestion) bỏ hẳn app tách biệt cũ (repo
   GitHub linhnd1-code/btbd_dashboard — backend FastAPI + Postgres riêng, định
   deploy Render), gộp thẳng vào dashboard M12 này, đọc y hệt kiểu Lịch
   Tải/TLLD hồi còn đọc Sheet trực tiếp (trước khi có Supabase).

   MVP ĐỢT 1 (Sếp chốt phạm vi qua AskUserQuestion) — 5 mục lõi: Tổng quan
   (KPI + cảnh báo), Danh sách xe, Hạn giấy tờ, Lịch bảo dưỡng theo ODO, Nhật
   ký bảo dưỡng-sửa chữa. Các mục nâng cao của app cũ (Health Score, Smart
   Alerts, So sánh xe, Báo cáo, Cảnh báo cứu hộ, Kế hoạch đăng kiểm, quét biển
   số bằng OCR, quản lý người dùng/duyệt tài khoản...) CHƯA làm — cố ý để dành
   làm dần sau khi Sếp yêu cầu tiếp, KHÔNG tự bổ sung khi chưa được hỏi.

   TOÀN BỘ logic tính toán bên dưới (ngưỡng ngày/km, cách xếp trạng thái cảnh
   báo, công thức KPI...) SAO CHÉP Y HỆT app cũ (backend/services/fleet_service.py
   + models/app_settings.py) — không tự nghĩ công thức mới, giữ đúng số Sếp
   đã quen dùng. App cũ cho Admin chỉnh ngưỡng qua màn Cài đặt (lưu DB); bản
   Sheet-only này CHƯA có màn chỉnh (ngoài phạm vi 5 mục MVP đợt 1) nên để
   hằng số cố định = đúng giá trị mặc định cũ — làm màn Cài đặt sau nếu cần.

   Đọc theo TÊN tab (không cần gid, xem csvSourcesByNameFrom() ở config.ts) vì
   backend cũ cũng định danh tab bằng tên. CỘT ĐỌC THEO VỊ TRÍ (không theo tên
   tiêu đề, không dùng findCol() như các loader Lịch Tải khác) — bám ĐÚNG cách
   backend cũ đọc (sheet_sync.py, comment gốc: "cấu trúc cột trong Sheet không
   đổi, chỉ số dòng dữ liệu tăng theo thời gian").

   ⚠ LƯU Ý QUAN TRỌNG: sandbox viết code này KHÔNG fetch được Google Sheets
   trực tiếp (egress chặn docs.google.com) nên CHƯA tự kiểm chứng được vị trí
   cột/định dạng ngày thật trên sheet khớp 100% với mapping bên dưới (mapping
   lấy từ đúng code Python đã chạy thật của backend cũ, nhưng cách Sheets xuất
   CSV có thể format ngày tháng khác cách Python đọc file .xlsx bằng openpyxl).
   Sếp cần mở thử "Bảo Trì Bảo Dưỡng" trên dashboard sau khi patch này lên,
   coi số/ngày tháng có đúng không — báo lại ngay nếu cột nào lệch để sửa.
   ============================================================ */
import { parseCSV } from "./csv";
import { fetchWithTimeout } from "./fetchTimeout";
import {
  BTBD_SHEET_ID,
  BTBD_TAB_VEHICLES,
  BTBD_TAB_STATUS,
  BTBD_TAB_RECORDS,
  csvSourcesByNameFrom,
} from "../config";

// ── Ngưỡng cảnh báo — GIỐNG HỆT giá trị mặc định của AppSettings ở app cũ. ──
export const EXPIRY_ALERT_WINDOW_DAYS = 30;
export const DUE_THRESHOLD_KM = 1000;
export const UPCOMING_THRESHOLD_KM = 5000;

export interface BtbdVehicle {
  plateNumber: string;
  status: string;
  loadCapacity: string;
  brand: string;
  vehicleModel: string;
  manufactureYear: number | null;
  managerUnit: string;
  fleetTeam: string;
  inspectionExpiry: string;
  roadFeeExpiry: string;
  registrationExpiry: string;
  civilInsuranceExpiry: string;
  physicalInsuranceExpiry: string;
  decalExpiry: string;
  odo: number | null;
}

export interface BtbdStatus {
  plateNumber: string;
  status: string;
  brand: string;
  managerUnit: string;
  currentOdo: number | null;
  nextMaintenanceOdo: number | null;
  remainingOdo: number | null;
  alertStatus: string;
  note: string;
}

export interface BtbdRecord {
  plateNumber: string;
  vehicleInfo: string;
  odo: number | null;
  entryDate: string; // chuỗi thô từ Sheet — KHÔNG parse Date (định dạng thật chưa kiểm chứng được)
  workType: string;
  maintenanceCategory: string;
  detail: string;
  garage: string;
  exitDate: string;
  totalHours: number | null;
  note: string;
  cost: number | null;
  managingDepartment: string;
  area: string;
  week: string;
  complianceCheck: string;
}

export interface BtbdData {
  vehicles: BtbdVehicle[];
  statuses: BtbdStatus[];
  records: BtbdRecord[];
  lastSync: number;
}

async function fetchFrom(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const url of sources) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetchWithTimeout(url + sep + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

const s = (v: string | undefined): string => (v || "").trim();
const n = (v: string | undefined): number | null => {
  const t = (v || "").replace(/[,.](?=\d{3}(\D|$))/g, "").trim();
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};

function parseVehicles(rows: string[][]): BtbdVehicle[] {
  const out: BtbdVehicle[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 39 || !s(r[1])) continue;
    out.push({
      status: s(r[0]),
      plateNumber: s(r[1]),
      loadCapacity: s(r[2]),
      brand: s(r[3]),
      vehicleModel: s(r[4]),
      manufactureYear: n(r[5]),
      managerUnit: s(r[6]),
      fleetTeam: s(r[7]),
      inspectionExpiry: s(r[32]),
      roadFeeExpiry: s(r[33]),
      registrationExpiry: s(r[34]),
      civilInsuranceExpiry: s(r[35]),
      physicalInsuranceExpiry: s(r[36]),
      decalExpiry: s(r[37]),
      odo: n(r[38]),
    });
  }
  return out;
}

function parseStatuses(rows: string[][]): BtbdStatus[] {
  const out: BtbdStatus[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 21 || !s(r[1])) continue;
    out.push({
      status: s(r[0]),
      plateNumber: s(r[1]),
      brand: s(r[3]),
      managerUnit: s(r[5]),
      currentOdo: n(r[7]),
      nextMaintenanceOdo: r.length > 13 ? n(r[13]) : null,
      remainingOdo: r.length > 14 ? n(r[14]) : null,
      alertStatus: r.length > 15 ? s(r[15]) : "",
      note: r.length > 21 ? s(r[21]) : "",
    });
  }
  return out;
}

function parseRecords(rows: string[][]): BtbdRecord[] {
  const out: BtbdRecord[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 20 || !s(r[0])) continue;
    out.push({
      plateNumber: s(r[0]),
      vehicleInfo: s(r[1]),
      odo: n(r[3]),
      entryDate: s(r[5]),
      workType: s(r[6]),
      maintenanceCategory: s(r[7]),
      detail: s(r[8]),
      garage: s(r[9]),
      exitDate: s(r[11]),
      totalHours: n(r[12]),
      note: s(r[13]),
      cost: n(r[14]),
      managingDepartment: s(r[15]),
      area: s(r[16]),
      week: s(r[17]),
      complianceCheck: s(r[19]),
    });
  }
  return out;
}

// 60s — dữ liệu BTBD nhập tay trên Sheet, không cần realtime sát như Lịch Tải (đúng REFRESH_MS chung).
const BTBD_TTL = 60000;
let cache: { at: number; data: BtbdData } | null = null;
let inflight: Promise<BtbdData> | null = null;

export async function loadBtbd(signal?: AbortSignal, force = false): Promise<BtbdData> {
  if (!force) {
    if (cache && Date.now() - cache.at < BTBD_TTL) return cache.data;
    if (inflight) return inflight;
  }
  const run = loadBtbdUncached(signal).then((data) => {
    cache = { at: Date.now(), data };
    return data;
  });
  inflight = run;
  try {
    return await run;
  } finally {
    inflight = null;
  }
}

async function loadBtbdUncached(signal?: AbortSignal): Promise<BtbdData> {
  const [vTxt, sTxt, rTxt] = await Promise.all([
    fetchFrom(csvSourcesByNameFrom(BTBD_SHEET_ID, BTBD_TAB_VEHICLES), signal),
    fetchFrom(csvSourcesByNameFrom(BTBD_SHEET_ID, BTBD_TAB_STATUS), signal),
    fetchFrom(csvSourcesByNameFrom(BTBD_SHEET_ID, BTBD_TAB_RECORDS), signal),
  ]);
  const vehicles = vTxt ? parseVehicles(parseCSV(vTxt)) : [];
  const statuses = sTxt ? parseStatuses(parseCSV(sTxt)) : [];
  const records = rTxt ? parseRecords(parseCSV(rTxt)) : [];
  return { vehicles, statuses, records, lastSync: Date.now() };
}

// ── Tính toán (sao chép logic từ fleet_service.py — xem đầu file) ──

const DOC_EXPIRY_FIELDS: { field: keyof BtbdVehicle; label: string }[] = [
  { field: "inspectionExpiry", label: "Hạn đăng kiểm" },
  { field: "roadFeeExpiry", label: "Hạn phí đường bộ" },
  { field: "registrationExpiry", label: "Hạn giấy đăng ký" },
  { field: "civilInsuranceExpiry", label: "Hạn BH dân sự" },
  { field: "physicalInsuranceExpiry", label: "Hạn BH vật chất" },
  { field: "decalExpiry", label: "Hạn phù hiệu" },
];

/**
 * Số ngày còn lại tới hạn. Chấp nhận "YYYY-MM-DD..." hoặc "D/M/YYYY..." (khớp 2 định dạng
 * _days_remaining() của app cũ hay gặp nhất). Giá trị không parse được (vd "hết hạn") coi như
 * ĐÃ QUÁ HẠN (-1) — ĐÚNG hành vi app cũ, không phải bug.
 */
export function daysRemaining(raw: string, today = new Date()): number | null {
  if (!raw) return null;
  const t = raw.trim();
  let d: Date | null = null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
  else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]); // D/M/YYYY (quy ước VN, khớp cách app cũ đọc Excel)
  }
  if (!d || Number.isNaN(d.getTime())) return -1;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((d.getTime() - t0) / 86400000);
}

export type DocStatus = "expired" | "soon" | "ok";
export function docStatus(days: number | null, windowDays = EXPIRY_ALERT_WINDOW_DAYS): DocStatus {
  if (days == null) return "ok";
  if (days < 0) return "expired";
  if (days <= windowDays) return "soon";
  return "ok";
}

export type ScheduleStatus = "overdue" | "due" | "upcoming" | "ok";
export function scheduleStatus(
  remainingOdo: number | null,
  alertStatus: string,
  dueKm = DUE_THRESHOLD_KM,
  upcomingKm = UPCOMING_THRESHOLD_KM
): ScheduleStatus {
  if (remainingOdo != null && remainingOdo < 0) return "overdue";
  if (alertStatus === "Đến kỳ BD" || (remainingOdo != null && remainingOdo <= dueKm)) return "due";
  if (remainingOdo != null && remainingOdo <= upcomingKm) return "upcoming";
  return "ok";
}

export interface DocRow {
  plateNumber: string;
  managerUnit: string;
  brand: string;
  docType: string;
  expiryRaw: string;
  daysRemaining: number | null;
  docStatus: DocStatus;
}
export function computeDocuments(vehicles: BtbdVehicle[]): DocRow[] {
  const rows: DocRow[] = [];
  for (const v of vehicles) {
    for (const { field, label } of DOC_EXPIRY_FIELDS) {
      const raw = v[field] as string;
      if (!raw) continue;
      const days = daysRemaining(raw);
      rows.push({
        plateNumber: v.plateNumber,
        managerUnit: v.managerUnit,
        brand: v.brand,
        docType: label,
        expiryRaw: raw,
        daysRemaining: days,
        docStatus: docStatus(days),
      });
    }
  }
  rows.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
  return rows;
}

export interface ScheduleRow {
  plateNumber: string;
  status: string;
  brand: string;
  managerUnit: string;
  currentOdo: number | null;
  nextMaintenanceOdo: number | null;
  remainingOdo: number | null;
  alertStatus: string;
  scheduleStatus: ScheduleStatus;
  note: string;
}
export function computeSchedule(statuses: BtbdStatus[]): ScheduleRow[] {
  const rows: ScheduleRow[] = statuses.map((r) => ({ ...r, scheduleStatus: scheduleStatus(r.remainingOdo, r.alertStatus) }));
  rows.sort((a, b) => (a.remainingOdo ?? Infinity) - (b.remainingOdo ?? Infinity));
  return rows;
}

export interface FleetStats {
  totalVehicles: number;
  activeVehicles: number;
  totalRecords: number;
  totalCost: number;
  complianceRate: number;
  dueForMaintenance: number;
  expiringDocuments: number;
  costByArea: { label: string; count: number; totalCost: number }[];
  costByGarage: { label: string; count: number; totalCost: number }[];
}
export function computeStats(data: BtbdData): FleetStats {
  const { vehicles, statuses, records } = data;
  const totalVehicles = vehicles.length;
  const activeVehicles = vehicles.filter((v) => v.status === "Hoạt động").length;
  const totalRecords = records.length;
  const totalCost = records.reduce((a, r) => a + (r.cost || 0), 0);
  const checked = records.filter((r) => r.complianceCheck);
  const correct = checked.filter((r) => r.complianceCheck === "Đúng định mức").length;
  const complianceRate = checked.length ? Math.round((correct / checked.length) * 1000) / 10 : 0;
  const dueForMaintenance = statuses.filter(
    (st) => st.alertStatus === "Đến kỳ BD" || (st.remainingOdo != null && st.remainingOdo <= DUE_THRESHOLD_KM)
  ).length;
  const expiringDocuments = vehicles.filter((v) =>
    DOC_EXPIRY_FIELDS.some(({ field }) => {
      const raw = v[field] as string;
      if (!raw) return false;
      const d = daysRemaining(raw);
      return d != null && d <= EXPIRY_ALERT_WINDOW_DAYS;
    })
  ).length;
  const breakdown = (key: "area" | "garage") => {
    const m = new Map<string, { count: number; totalCost: number }>();
    for (const r of records) {
      const label = key === "area" ? r.area : r.garage;
      if (!label) continue;
      const cur = m.get(label) || { count: 0, totalCost: 0 };
      cur.count++;
      cur.totalCost += r.cost || 0;
      m.set(label, cur);
    }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.totalCost - a.totalCost);
  };
  return {
    totalVehicles,
    activeVehicles,
    totalRecords,
    totalCost,
    complianceRate,
    dueForMaintenance,
    expiringDocuments,
    costByArea: breakdown("area"),
    costByGarage: breakdown("garage"),
  };
}

export interface AlertsData {
  maintenanceDue: BtbdStatus[];
  documentExpiring: { plateNumber: string; managerUnit: string; docType: string; expiryRaw: string; daysRemaining: number | null }[];
}
export function computeAlerts(data: BtbdData, limit = 20): AlertsData {
  const maintenanceDue = [...data.statuses]
    .filter((st) => st.remainingOdo != null)
    .sort((a, b) => (a.remainingOdo as number) - (b.remainingOdo as number))
    .slice(0, limit);
  const documentExpiring: AlertsData["documentExpiring"] = [];
  for (const v of data.vehicles) {
    for (const { field, label } of DOC_EXPIRY_FIELDS) {
      const raw = v[field] as string;
      if (!raw) continue;
      const days = daysRemaining(raw);
      if (days != null && days <= EXPIRY_ALERT_WINDOW_DAYS) {
        documentExpiring.push({ plateNumber: v.plateNumber, managerUnit: v.managerUnit, docType: label, expiryRaw: raw, daysRemaining: days });
      }
    }
  }
  documentExpiring.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
  return { maintenanceDue, documentExpiring: documentExpiring.slice(0, limit) };
}
