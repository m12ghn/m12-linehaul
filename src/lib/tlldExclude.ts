/* ============================================================
   LOẠI TRỪ tuyến khỏi báo cáo tổng quan TLLD / Sức khoẻ cụm / Cảnh báo / Tổng TLLD Cụm:
   - Nội thành CK 1 & CK 2  -> mã "SG_CK1_*" / "SG_CK2_*" (nhận theo tiền tố, chắc chắn).
   - Cả vùng NỘI VÙNG HCM   -> nạp đúng tab vùng đó, lấy toàn bộ mã tuyến của nó.
   (Nội Vùng dùng tiền tố XA_* nhưng TRÙNG với XA_GXT_* ở vùng khác -> phải đọc sheet, không đoán.)
   - Tuyến NỘI BỘ (mã có token "NB" riêng, vd "NB_250_01", "FW_NB_05", "GHN_TC_NB")
     -> chung kho, không phải tuyến vận chuyển thật -> TLLD không phản ánh đúng, loại luôn
     (đã chốt với Sếp — xem thêm ghi chú tương tự ở src/lib/nccFixedCapacity.ts).
   - Hub "HCM01" (trên sheet TLLD, xem src/lib/tlld.ts TlldRoute.hub) -> KHÔNG thuộc Cụm M12,
     là hub/cụm khác dùng chung workbook TLLD (đã chốt với Sếp 2026-07-20).
   - Loại tuyến "01_FW_20" (trên Lịch Tải, bất kỳ vùng nào) -> CŨNG không thuộc M12, dù đôi khi
     nằm trong hub khác HCM01 trên sheet TLLD -> loại theo TÊN TUYẾN riêng, không dựa vào hub
     (đã chốt với Sếp 2026-07-20, ĐỒNG BỘ với EXCLUDED_CATEGORIES ở nccFixedCapacity.ts).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { normCode } from "./tlld";
import { loadFwRouteNames } from "./nccFixedCapacity";
import { useTlld } from "./useTlld";

const CK_RE = /^SG_CK[12]_/; // CK1 / CK2 nội thành
// "NB" phải là 1 TOKEN riêng (chặn bởi đầu/cuối chuỗi hoặc dấu "_") -> khớp NB_250_01 (đầu),
// FW_NB_05 (giữa), GHN_TC_NB (cuối) nhưng KHÔNG khớp nhầm token dài hơn kiểu "...LCNB..."/"NBC...".
const NB_RE = /(^|_)NB(_|$)/;

let cache: Set<string> | null = null;

/** Set mã tuyến (normCode) thuộc vùng Nội Vùng HCM.
 *  Tab "noi-vung-hcm" (gid 961518640) đã đổi cấu trúc, KHÔNG còn dữ liệu tuyến (API v4 trả 404,
 *  fallback gviz/export cũng lỗi vì bị chặn đăng nhập — CÙNG nguyên nhân đã sửa ở
 *  nccFixedCapacity.ts, Sếp báo Dash "load mãi" 2026-08-25). Trước đây hàm này CỐ gọi loadSheet()
 *  mỗi lần mount TLLD rồi mới bắt lỗi -> tốn 3 lần thử lại (gviz/export) mỗi lần, góp phần làm chậm/
 *  kẹt tải trang. Bỏ hẳn fetch, trả Set rỗng ngay — nghĩa là loại trừ theo NỘI VÙNG HCM khỏi báo cáo
 *  TLLD tạm thời KHÔNG hoạt động nữa (chỉ còn loại theo tiền tố CK1/CK2 + NB + 01_FW_20 + hub HCM01
 *  ở isExcluded()); cần Sếp xác nhận lại cách nhận diện tuyến Nội Vùng HCM mới nếu vẫn cần loại trừ. */
async function loadNoiVungCodes(): Promise<Set<string>> {
  if (cache) return cache;
  cache = new Set();
  return cache;
}

let fwCache: Set<string> | null = null;
/** Set mã tuyến (normCode) gắn Loại tuyến "01_FW_20" — xem loadFwRouteNames(). */
async function loadFwCodes(signal?: AbortSignal): Promise<Set<string>> {
  if (fwCache) return fwCache;
  const names = await loadFwRouteNames(signal);
  const s = new Set<string>();
  for (const n of names) { const k = normCode(n); if (k) s.add(k); }
  fwCache = s;
  return s;
}

/** Tuyến này có bị loại khỏi báo cáo tổng quan không? (dùng với Set gộp từ hook useExcludedSet). */
export function isExcluded(code: string, excluded: Set<string>): boolean {
  return CK_RE.test(code) || NB_RE.test(code) || excluded.has(code);
}

/** Hook: trả về Set mã LOẠI TRỪ đã gộp (Nội Vùng + 01_FW_20 + hub HCM01) để dùng với isExcluded(code, set). */
export function useExcludedSet(): Set<string> {
  const [nv, setNv] = useState<Set<string>>(cache || new Set());
  const [fw, setFw] = useState<Set<string>>(fwCache || new Set());
  const { index } = useTlld();
  useEffect(() => {
    let alive = true;
    loadNoiVungCodes().then((s) => { if (alive) setNv(s); }).catch(() => {});
    loadFwCodes().then((s) => { if (alive) setFw(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const merged = new Set([...nv, ...fw]);
    if (index) for (const [code, r] of index.byCode) if (r.hub === "HCM01") merged.add(code);
    return merged;
  }, [nv, fw, index]);
}
