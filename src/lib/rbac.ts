/* ============================================================
   MÔ HÌNH PHÂN QUYỀN (RBAC) — dùng CHUNG cho client + server.
   Cấp bậc:  MODULE (mục cấp 1)  ->  SUB (chức năng con)  ->  ACTION.
   - ACTION: Xem / Tạo / Sửa / Xoá / Duyệt / Xuất.
   - Matrix: role -> moduleKey -> subKey -> Record<ActionKey, boolean>.
   ============================================================ */

export type ActionKey = "view" | "create" | "edit" | "delete" | "approve" | "export";

export interface ActionDef { k: ActionKey; l: string; }
export const ACTIONS: ActionDef[] = [
  { k: "view", l: "Xem" },
  { k: "create", l: "Tạo" },
  { k: "edit", l: "Sửa" },
  { k: "delete", l: "Xoá" },
  { k: "approve", l: "Duyệt" },
  { k: "export", l: "Xuất" },
];

export interface SubDef { key: string; label: string; }
export interface ModuleDef { key: string; label: string; icon: string; subs: SubDef[]; }

/** Các module + chức năng con — KHỚP các mục trên Dash. */
export const MODULES: ModuleDef[] = [
  { key: "tong-quan", label: "Tổng Quan", icon: "home", subs: [
    { key: "health", label: "Sức khoẻ cụm" },
    { key: "alerts", label: "Cảnh báo lãng phí / vượt tải" },
    { key: "ask", label: "Hỏi nhanh (AI)" },
  ]},
  { key: "lich-tai", label: "Lịch Tải", icon: "truck", subs: [
    { key: "lich", label: "Lịch tải tuyến" },
    { key: "gsvt", label: "GSVT · lịch trực" },
    { key: "cong", label: "Cổng Xuất" },
    { key: "veh", label: "Biển số & SĐT tài xế" },
    { key: "excel", label: "Xuất Excel lịch" },
  ]},
  { key: "tlld-tuyen", label: "TLLD Tuyến", icon: "trending-up", subs: [
    { key: "table", label: "Bảng TLLD tuyến" },
    { key: "ai", label: "Nhận định AI" },
    { key: "exclude", label: "Loại trừ tuyến" },
  ]},
  { key: "tang-cuong", label: "Vùng HCM", icon: "building", subs: [
    { key: "lay", label: "TC - Lấy" },
    { key: "giao", label: "TC - Giao" },
    { key: "ps", label: "TC - Phát sinh (xin xe)" },
    { key: "am", label: "TT - AM (danh bạ điểm)" },
    { key: "ncc", label: "TC - NCC" },
  ]},
  { key: "san-luong", label: "Sản Lượng", icon: "package", subs: [
    { key: "dash", label: "Dashboard sản lượng" },
    { key: "ai", label: "Phân tích AI" },
    { key: "manual", label: "Nhập tay" },
  ]},
  { key: "ds-ncc", label: "Performance NCC", icon: "contact", subs: [
    { key: "list", label: "Hồ sơ & danh sách NCC" },
    { key: "contact", label: "Liên hệ & SĐT" },
    { key: "gd", label: "Thông tin giám đốc" },
  ]},
  { key: "plan-event", label: "Plan Event", icon: "calendar", subs: [
    { key: "plan", label: "Lập kế hoạch" },
    { key: "review", label: "Đánh giá sau event" },
    { key: "fleet", label: "Dự trù xe" },
  ]},
  { key: "sap-lich-tai", label: "Trợ lý Lịch Tải", icon: "bot", subs: [
    { key: "sched", label: "Sắp lịch" },
    { key: "ghep", label: "Ghép tải" },
    { key: "teach", label: "Dạy kiến thức" },
  ]},
  { key: "cong-xuat", label: "Cổng Xuất", icon: "door", subs: [
    { key: "board", label: "Bảng cổng xuất" },
    { key: "assign", label: "Gán biển số" },
  ]},
  { key: "phan-quyen", label: "Phân quyền", icon: "shield", subs: [
    { key: "accounts", label: "Tài khoản nhân sự" },
    { key: "depts", label: "Danh mục Bộ phận" },
    { key: "matrix", label: "Ma trận Quyền" },
    { key: "roles", label: "Vai trò (Roles)" },
  ]},
];

export interface RoleDef { id: string; name: string; code: string; system?: boolean; locked?: boolean; }

/**
 * Thứ tự hiển thị vai trò (theo cấp bậc user yêu cầu):
 * Admin → Phó Phòng → Quản lý → Nhân viên → Trưởng nhóm → Quản lý Cụm.
 * Dùng cho MỌI chỗ liệt kê vai trò (danh sách Roles, dropdown gán tài khoản)
 * để đồng nhất, không phụ thuộc thứ tự lưu trong KV.
 */
export const ROLE_ORDER = ["admin", "deputy", "manager", "staff", "leader", "cluster"];

/** Sắp xếp danh sách vai trò theo ROLE_ORDER (role lạ xếp cuối, giữ nguyên tương đối). */
export function sortRoles<T extends { id: string }>(list: T[]): T[] {
  const idx = (id: string) => { const i = ROLE_ORDER.indexOf(id); return i === -1 ? ROLE_ORDER.length : i; };
  return [...list].sort((a, b) => idx(a.id) - idx(b.id));
}

/** Vai trò mặc định (khớp cột "Quyền" người dùng cung cấp) — đã sắp theo ROLE_ORDER. */
export const DEFAULT_ROLES: RoleDef[] = [
  { id: "admin", name: "Quản trị viên", code: "Admin", system: true },
  { id: "deputy", name: "Phó Phòng", code: "Deputy", system: true },
  { id: "manager", name: "Quản lý", code: "Manager", system: true },
  { id: "staff", name: "Nhân viên", code: "Staff", system: true },
  { id: "leader", name: "Trưởng nhóm", code: "Team Leader", system: true },
  { id: "cluster", name: "Quản lý Cụm", code: "Cluster Manager", system: true, locked: true },
];

/** Preset MODULE nào mỗi vai trò được VÀO (dựng matrix mặc định) — theo bảng đã duyệt. */
const ACCESS: Record<string, "all" | string[]> = {
  admin: "all",
  deputy: MODULES.map((m) => m.key).filter((k) => k !== "phan-quyen"),
  manager: MODULES.map((m) => m.key).filter((k) => k !== "phan-quyen"),
  leader: ["tong-quan", "lich-tai", "tlld-tuyen", "san-luong"],
  staff: ["tong-quan", "lich-tai", "san-luong"],
  cluster: ["tong-quan", "lich-tai", "tlld-tuyen", "tang-cuong", "san-luong", "ds-ncc", "plan-event", "sap-lich-tai", "cong-xuat"],
};

export type SubPerm = Record<ActionKey, boolean>;
/** role -> module -> sub -> action -> bool */
export type PermMatrix = Record<string, Record<string, Record<string, SubPerm>>>;

/** Dựng matrix mặc định theo ACCESS + cấp bậc vai trò. */
export function buildDefaultMatrix(roles: RoleDef[] = DEFAULT_ROLES): PermMatrix {
  const m: PermMatrix = {};
  for (const r of roles) {
    m[r.id] = {};
    const access = ACCESS[r.id] ?? [];
    for (const mod of MODULES) {
      m[r.id][mod.key] = {};
      const can = access === "all" || access.includes(mod.key);
      for (const sub of mod.subs) {
        // Quản lý Cụm: ở Performance NCC chỉ xem HỒ SƠ NĂNG LỰC (sub "list"),
        // khoá "contact"/"gd" (PII người liên hệ/giám đốc) — đã chốt với Sếp.
        const subCan = can && !(r.id === "cluster" && mod.key === "ds-ncc" && sub.key !== "list");
        m[r.id][mod.key][sub.key] = {
          view: subCan,
          create: subCan && (r.id === "admin" || r.id === "deputy" || r.id === "manager"),
          edit: subCan && (r.id === "admin" || r.id === "deputy" || r.id === "manager" || r.id === "cluster"),
          delete: subCan && (r.id === "admin" || r.id === "deputy"),
          approve: subCan && (r.id === "admin" || r.id === "deputy" || r.id === "manager"),
          export: subCan && r.id !== "leader",
        };
      }
    }
  }
  return m;
}

const empty: SubPerm = { view: false, create: false, edit: false, delete: false, approve: false, export: false };

/** Bù module/sub/action còn thiếu bằng false — chống lỗi khi thêm module mới (KV cũ không vỡ). */
export function normalizeMatrix(mx: PermMatrix | null | undefined, roles: RoleDef[] = DEFAULT_ROLES): PermMatrix {
  const base = buildDefaultMatrix(roles);
  if (!mx) return base;
  const out: PermMatrix = {};
  for (const r of roles) {
    out[r.id] = {};
    for (const mod of MODULES) {
      out[r.id][mod.key] = {};
      for (const sub of mod.subs) {
        const saved = mx?.[r.id]?.[mod.key]?.[sub.key];
        out[r.id][mod.key][sub.key] = saved && typeof saved === "object"
          ? { ...empty, ...saved }
          : base[r.id][mod.key][sub.key];
      }
    }
  }
  return out;
}

/** 1 chức năng con có quyền (act) không. */
export function canSub(mx: PermMatrix, role: string, mod: string, sub: string, act: ActionKey): boolean {
  return !!mx?.[role]?.[mod]?.[sub]?.[act];
}

/** Cấp MODULE có quyền (act) không = có ÍT NHẤT 1 chức năng con bật act. */
export function can(mx: PermMatrix, role: string, mod: string, act: ActionKey = "view"): boolean {
  const subs = mx?.[role]?.[mod];
  if (!subs) return false;
  return Object.values(subs).some((s) => !!s[act]);
}

/** Vai trò có được VÀO module không (có bất kỳ quyền Xem nào). */
export function moduleAllowed(mx: PermMatrix, role: string, mod: string): boolean {
  return can(mx, role, mod, "view");
}

/** Đếm số quyền chi tiết đang bật của 1 vai trò. */
export function countPerms(mx: PermMatrix, role: string): { on: number; total: number } {
  let on = 0, total = 0;
  for (const mod of MODULES) {
    for (const sub of mod.subs) {
      for (const a of ACTIONS) {
        total++;
        if (mx?.[role]?.[mod.key]?.[sub.key]?.[a.k]) on++;
      }
    }
  }
  return { on, total };
}
