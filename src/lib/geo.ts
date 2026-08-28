/* ============================================================
   Tra toạ độ Bưu Cục từ geo.json (sinh bởi scripts/build-geo.mjs).
   geo.json đã được key sẵn theo normalizeName().
   - Khớp tuyệt đối trước.
   - Fallback fuzzy theo độ tương đồng token (Jaccard) ngưỡng cao,
     để bắt các tên lệch nhẹ (vd thừa "04" cuối, khác cách viết).
   ============================================================ */
import { useSyncExternalStore } from "react";
import geoRaw from "../data/geo.json";
import { normalizeName } from "./normalize";

const RAW = geoRaw as unknown as Record<string, [number, number]>;
const INDEX = new Map<string, [number, number]>(Object.entries(RAW));

/** Giữ token nếu dài >1 KÝ TỰ, hoặc là 1 CHỮ SỐ đơn (vd "1"/"2" trong "Bình Thạnh 1"/"2" —
 *  số này PHÂN BIỆT 2 điểm khác nhau, lọc bỏ sẽ khiến chúng bị coi là cùng 1 chỗ). */
const keepToken = (t: string): boolean => t.length > 1 || /^\d$/.test(t);

// Chuẩn bị sẵn token-set cho từng key để fuzzy match.
const TOKENS: { key: string; set: Set<string>; coord: [number, number] }[] = [];
for (const [key, coord] of INDEX) {
  TOKENS.push({ key, set: new Set(key.split(" ").filter(keepToken)), coord });
}

/**
 * Alias thủ công cho các tên lệch nhiều giữa Sheet và KML.
 * key = tên trong Sheet (nguyên văn, đã trim), value = tên trong KML.
 */
export const ALIASES: Record<string, string> = {};

const FUZZY_THRESHOLD = 0.82;
const cache = new Map<string, [number, number] | null>();

function fuzzy(norm: string): [number, number] | undefined {
  const a = new Set(norm.split(" ").filter(keepToken));
  if (a.size < 3) return undefined; // quá ngắn -> dễ khớp sai, bỏ
  let best: [number, number] | undefined;
  let bestScore = 0;
  for (const t of TOKENS) {
    let inter = 0;
    for (const tok of a) if (t.set.has(tok)) inter++;
    const union = a.size + t.set.size - inter;
    const score = union ? inter / union : 0;
    if (score > bestScore) { bestScore = score; best = t.coord; }
  }
  return bestScore >= FUZZY_THRESHOLD ? best : undefined;
}

/** Khớp KHI mọi token của tên tra là TẬP CON của DUY NHẤT 1 điểm (hoặc ngược lại).
 *  Bắt các tên lệch do THIẾU/THỪA tiền tố–hậu tố (vd "KD Tăng Nhơn Phú" ⊂ "(HCM) KD Tăng Nhơn Phú").
 *  Chỉ nhận khi CHÍNH XÁC 1 điểm chứa đủ -> không mơ hồ, an toàn. */
function subsetMatch(norm: string): [number, number] | undefined {
  const a = norm.split(" ").filter(keepToken);
  if (a.length < 3) return undefined; // quá ngắn -> dễ trùng nhiều điểm, bỏ
  let found: [number, number] | undefined, count = 0;
  for (const t of TOKENS) {
    const sup = a.every((tok) => t.set.has(tok));          // tên tra ⊂ điểm
    const sub = a.length >= t.set.size && [...t.set].every((tok) => a.includes(tok)); // điểm ⊂ tên tra
    if (sup || sub) { found = t.coord; if (++count > 1) return undefined; }
  }
  return count === 1 ? found : undefined;
}

export function lookupCoord(name: string): [number, number] | undefined {
  const raw = (name || "").trim();
  if (!raw) return undefined;
  const aliased = ALIASES[raw] || raw;
  const key = normalizeName(aliased);
  const exact = INDEX.get(key);
  if (exact) return exact;
  if (cache.has(key)) return cache.get(key) || undefined;
  const f = subsetMatch(key) || fuzzy(key);
  cache.set(key, f || null);
  return f;
}

export let geoCount = INDEX.size;

/** Toàn bộ BC/kho trong sheet toạ độ toàn quốc (id + tên nguyên văn) — gồm cả những điểm CHƯA
 *  từng chạy tuyến nào trong Lịch Tải (nên không có trong usePlaceNames/usePlaceIds gom từ đó).
 *  Nạp qua initLiveGeo() bên dưới, dùng để BỔ SUNG gợi ý tên/mã khi Sếp gõ tìm (xem allRoutes.ts). */
export interface ExtraPlace { id: string; name: string }
let extraPlaces: ExtraPlace[] = [];
export function getExtraPlaces(): ExtraPlace[] {
  return extraPlaces;
}

// Bộ lắng nghe cho biết INDEX vừa được nạp/trộn lại (module-level, không phải React state) -> để
// component nào tra toạ độ trong useMemo có thể ĂN THEO qua useGeoVersion() thay vì bị "đông cứng"
// mãi mãi ở lần lookupCoord() đầu tiên (trước khi initLiveGeo() kịp chạy xong).
let version = 0;
const listeners = new Set<() => void>();
function notifyGeoChanged() { version++; listeners.forEach((fn) => fn()); }
function subscribeGeo(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
function getGeoVersion(): number { return version; }

/** Hook: trả số phiên bản geo hiện tại, tự re-render khi initLiveGeo() nạp/trộn xong dữ liệu mới.
 *  Dùng làm dependency phụ cho useMemo(() => lookupCoord(name), [name, geoVersion]) để kết quả tra
 *  toạ độ tự cập nhật ngay khi MyMap có điểm mới, không cần Sếp gõ lại tên hay tải lại trang. */
export function useGeoVersion(): number {
  return useSyncExternalStore(subscribeGeo, getGeoVersion, getGeoVersion);
}

/** Nạp toạ độ REALTIME từ sheet toạ độ kho/BC chính thức (qua /api/geo) rồi TRỘN ĐÈ lên geo.json
 *  tĩnh. Gọi lúc mở app + lặp lại mỗi GEO_REFRESH_MS (xem App.tsx) -> thêm/sửa điểm trên sheet là
 *  dùng được trong vài phút, KHÔNG cần chạy lại build:geo + deploy. Lỗi mạng -> giữ nguyên dữ
 *  liệu đang có (geo.json nền hoặc lần nạp live gần nhất). (Trước dùng MyMap/KML — đã bỏ vì bị
 *  Google chặn 403 không sửa được, xem functions/api/geo.ts.)
 *
 *  QUAN TRỌNG: nhiều nơi gọi hàm này CÙNG LÚC (poll định kỳ ở App.tsx + planSchedule() gọi trước
 *  khi tính lịch, xem bên dưới) — TRẢ VỀ CHUNG 1 promise đang chạy dở thay vì bỏ qua ngay (như bản
 *  cũ), để ai gọi cũng CHỜ ĐƯỢC kết quả thật thay vì đôi khi ăn "0" giả. Sếp phát hiện 2026-08-23:
 *  tính CÙNG 1 lộ trình 2 lần cho ra 2 kết quả khác nhau — do lần tính đầu chạy TRƯỚC khi sheet toạ
 *  độ toàn quốc kịp nạp xong, phải fuzzy-match tạm ra 1 điểm gần đúng tên (vd "Bình Trị Đông 2"
 *  thay vì đúng "KD Bình Trị Đông"), lần tính sau (khi đã nạp xong) mới ra đúng toạ độ thật. */
let fetchPromise: Promise<number> | null = null;
export function initLiveGeo(): Promise<number> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const r = await fetch("/api/geo");
      const d = await r.json();
      if (!d?.ok || !d.geo) return 0;
      let added = 0, changed = false;
      for (const [key, coord] of Object.entries(d.geo as Record<string, [number, number]>)) {
        const prev = INDEX.get(key);
        const isNew = !prev;
        if (isNew || prev[0] !== coord[0] || prev[1] !== coord[1]) changed = true;
        INDEX.set(key, coord); // đè bản mới nhất từ MyMap
        if (isNew) { TOKENS.push({ key, set: new Set(key.split(" ").filter((t) => t.length > 1)), coord }); added++; }
      }
      if (Array.isArray(d.places) && d.places.length !== extraPlaces.length) {
        extraPlaces = d.places;
        changed = true;
      } else if (Array.isArray(d.places)) {
        extraPlaces = d.places; // cùng số lượng vẫn có thể đổi tên/id -> luôn cập nhật bản mới nhất
      }
      if (changed) {
        cache.clear(); // fuzzy cache cũ có thể sai sau khi có thêm/đổi điểm
        geoCount = INDEX.size;
        notifyGeoChanged();
      }
      return added;
    } catch { return 0; }
    finally { fetchPromise = null; }
  })();
  return fetchPromise;
}

/** Khoảng cách đường chim bay (km) giữa 2 toạ độ — công thức Haversine. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
