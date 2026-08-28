/* ============================================================
   "Nav bus" nhẹ: cho trợ lý AI điều hướng toàn Dash từ khung chat.
   App đăng ký 1 handler (onNav); trợ lý gọi navTo({view, search, region})
   -> App chuyển mục + điền sẵn tìm kiếm/vùng. Tránh phải xuyên props nhiều tầng.
   ============================================================ */
import type { TopMenu } from "../types";

export interface NavCmd {
  view?: TopMenu;     // mục cần mở (tong-quan, lich-tai, tlld-tuyen, …)
  search?: string;    // từ khoá điền sẵn (mã tuyến / bưu cục)
  region?: string;    // tên vùng (khớp theo nhãn SHEETS)
}

let handler: ((c: NavCmd) => void) | null = null;

/** App gọi 1 lần để nhận lệnh điều hướng. Trả hàm huỷ đăng ký. */
export function onNav(fn: (c: NavCmd) => void): () => void {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

/** Trợ lý gọi để điều hướng Dash. */
export function navTo(c: NavCmd): void {
  try { handler?.(c); } catch { /* bỏ qua */ }
}

/** Lệnh GHÉP đang chờ: khung chat (Sắp Mới) đặt vào, GhepTai lấy ra khi mở tab. */
export interface GhepPayload { bc?: string; kg?: number; loai?: string; region?: string; kho?: string; }
let pendingGhep: GhepPayload | null = null;
export function setPendingGhep(c: GhepPayload | null): void { pendingGhep = c; }
export function takePendingGhep(): GhepPayload | null { const c = pendingGhep; pendingGhep = null; return c; }

/** Sub-tab đang chờ của "Vùng HCM" (TangCuong.tsx): nơi khác gọi navTo({view:"tang-cuong"})
   kèm setPendingTcSub(...) TRƯỚC khi điều hướng -> TangCuong tự đọc lúc mount để mở đúng
   sub-tab (không lift state lên App.tsx vì chỉ TangCuong dùng, theo đúng pattern pendingGhep). */
export type TcSub = "list" | "ncc" | "xintc" | "ttam";
let pendingTcSub: TcSub | null = null;
export function setPendingTcSub(v: TcSub): void { pendingTcSub = v; }
export function takePendingTcSub(): TcSub | null { const v = pendingTcSub; pendingTcSub = null; return v; }
