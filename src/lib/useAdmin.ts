/* ============================================================
   Quyền ADMIN nay = TÀI KHOẢN đăng nhập có vai trò "admin".
   (Bỏ cơ chế mật khẩu admin dùng chung. Vai trò lấy từ phiên đăng nhập.)
   Giữ nguyên interface useAdmin() -> { isAdmin } để các mục cũ không phải sửa.
   ============================================================ */
import { getUser, getToken } from "./useUser";

/** Token phiên (tương thích các nơi còn gọi tên cũ). */
export function getAdminTok(): string { return getToken(); }

/** Hook: tài khoản hiện tại có phải admin không. */
export function useAdmin(): { isAdmin: boolean } {
  return { isAdmin: (getUser()?.roleId || "") === "admin" };
}
