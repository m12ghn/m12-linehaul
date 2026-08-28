/* ============================================================
   STORE + HOOK phân quyền (giống mẫu useAdmin: store cấp module + pub/sub).
   - Tải roles + matrix từ /api/roles 1 lần khi mở Dash; lỗi mạng -> dùng mặc định.
   - Ghi (chỉ admin) qua /api/roles {action:"save"} kèm header x-admin-token.
   - useMyRole(): vai trò của TÀI KHOẢN đang đăng nhập để KHOÁ MENU.
     (Bản đầu: admin -> "admin"; còn lại -> "manager" để GIỮ nguyên quyền xem
      mọi menu vận hành như hiện tại, chỉ khoá "Phân quyền" cho admin. Khi có
      bảng account->role thì sửa DUY NHẤT hàm resolveMyRole bên dưới.)
   ============================================================ */
import { useEffect, useState } from "react";
import {
  MODULES, DEFAULT_ROLES, buildDefaultMatrix, normalizeMatrix, moduleAllowed, canSub as canSubPerm,
  type RoleDef, type PermMatrix, type ActionKey,
} from "./rbac";
import { adminHeaders, forceReauth, getUser } from "./useUser";

let roles: RoleDef[] = DEFAULT_ROLES;
let matrix: PermMatrix = buildDefaultMatrix();
let loaded = false;
let loading = false;

const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function getRoles(): RoleDef[] { return roles; }
export function getMatrix(): PermMatrix { return matrix; }

/** Tải cấu hình quyền từ server (gọi 1 lần lúc mở Dash). */
export async function loadRbac(force = false): Promise<void> {
  if ((loaded || loading) && !force) return;
  loading = true;
  try {
    const r = await fetch("/api/roles");
    const d = await r.json();
    if (d?.roles?.length) roles = d.roles;
    matrix = normalizeMatrix(d?.matrix, roles);
  } catch {
    matrix = buildDefaultMatrix(roles); // offline / chưa có KV -> mặc định
  } finally {
    loaded = true;
    loading = false;
    notify();
  }
}

/** Lưu toàn bộ roles + matrix (admin). Trả true nếu OK. */
export async function saveRbac(nextRoles: RoleDef[], nextMatrix: PermMatrix): Promise<boolean> {
  try {
    const r = await fetch("/api/roles", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action: "save", roles: nextRoles, matrix: nextMatrix }),
    });
    // Client đã qua cửa isAdmin để gọi được hàm này -> 401 nghĩa là phiên hết hạn/không hợp lệ,
    // không phải thiếu quyền -> đưa về đăng nhập lại thay vì báo lỗi mơ hồ.
    if (r.status === 401) { forceReauth(); return false; }
    const d = await r.json();
    if (d?.ok) {
      roles = nextRoles;
      matrix = normalizeMatrix(nextMatrix, nextRoles);
      notify();
      return true;
    }
  } catch { /* mạng lỗi */ }
  return false;
}

/** Hook: theo dõi roles + matrix; tự tải lần đầu. */
export function usePermissions() {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((x) => x + 1);
    subs.add(cb);
    if (!loaded) loadRbac();
    return () => { subs.delete(cb); };
  }, []);
  return { roles, matrix, loaded };
}

/** Vai trò của tài khoản đang đăng nhập (lấy từ phiên). */
function resolveMyRole(): string {
  return getUser()?.roleId || "staff"; // chưa đăng nhập/không rõ -> hạn chế nhất
}

/** Hook trả vai trò hiện tại + tiện ích canOpen/canSub đã bind sẵn. */
export function useMyRole() {
  const { matrix: mx } = usePermissions();
  const role = resolveMyRole();
  return {
    role,
    canOpen: (moduleKey: string) => {
      // Menu chưa được mô hình hoá trong ma trận -> không quản, cho mở (chống khoá nhầm).
      if (!MODULES.some((m) => m.key === moduleKey)) return true;
      // Vai trò chưa có trong ma trận (tài khoản cũ / role lạ) -> KHÔNG khoá để tránh
      // khoá nhầm toàn bộ; admin cấu hình quyền cho role đó thì mới áp.
      if (!mx?.[role]) return true;
      return moduleAllowed(mx, role, moduleKey);
    },
    /** Kiểm tra 1 chức năng con (vd "contact"/"gd" ở Performance NCC) có bị khoá riêng không. */
    canSub: (moduleKey: string, subKey: string, act: ActionKey = "view") => {
      if (!mx?.[role]) return true;
      return canSubPerm(mx, role, moduleKey, subKey, act);
    },
  };
}
