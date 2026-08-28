/* ============================================================
   VAI TRÒ & MA TRẬN QUYỀN — port từ functions/api/roles.ts (KV "rbac:v1").

   GET  /api/roles                                  -> { roles, matrix }
   POST /api/roles { action:"save", roles, matrix } -> { ok }   (cần phan-quyen:edit)

   HÌNH DẠNG TRẢ VỀ GIỮ NGUYÊN BLOB CŨ:
       matrix[roleId][module][sub] = { view, create, edit, delete, approve, export }
   để src/lib/usePermissions.ts + views/PhanQuyen.tsx chạy y như cũ, KHÔNG phải sửa.
   Bên dưới thì lưu dạng BẢNG (role_permissions) — truy vấn được bằng SQL, và lớp API
   dùng chính bảng đó để chặn quyền ở server (api/_lib/session.ts -> guard).

   Nói cách khác: client vẫn thấy JSON, database thấy quan hệ. Chuyển đổi ở đây.
   ============================================================ */
import { select, insert, remove, json } from "./_lib/supabase";
import { guard, invalidatePermCache } from "./_lib/session";

export const config = { runtime: "edge" };

const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
type Action = (typeof ACTIONS)[number];

interface RoleRow { id: string; label: string; sort: number; system: boolean }
interface PermRow { role_id: string; module: string; sub: string; action: Action; allowed: boolean }
interface ModRow { module: string; sub: string }

type SubPerm = Record<Action, boolean>;
type Matrix = Record<string, Record<string, Record<string, SubPerm>>>;

const emptyPerm = (): SubPerm =>
  ({ view: false, create: false, edit: false, delete: false, approve: false, export: false });

/** Bảng -> blob JSON. Ô nào chưa có dòng trong DB thì mặc định false (không vỡ khi thêm module mới). */
function toMatrix(roles: RoleRow[], mods: ModRow[], perms: PermRow[]): Matrix {
  const mx: Matrix = {};
  for (const r of roles) {
    mx[r.id] = {};
    for (const m of mods) {
      (mx[r.id][m.module] ||= {})[m.sub] = emptyPerm();
    }
  }
  for (const p of perms) {
    const cell = mx[p.role_id]?.[p.module]?.[p.sub];
    if (cell && ACTIONS.includes(p.action)) cell[p.action] = !!p.allowed;
  }
  return mx;
}

/** Blob JSON -> các dòng bảng. CHỈ ghi ô `true` (ô false = không có dòng) -> bảng gọn. */
function toRows(matrix: Matrix): PermRow[] {
  const out: PermRow[] = [];
  for (const [roleId, mods] of Object.entries(matrix || {})) {
    for (const [mod, subs] of Object.entries(mods || {})) {
      for (const [sub, perm] of Object.entries(subs || {})) {
        for (const a of ACTIONS) {
          if ((perm as any)?.[a]) {
            out.push({ role_id: roleId, module: mod, sub, action: a, allowed: true });
          }
        }
      }
    }
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    // ĐỌC MỞ (không cần đăng nhập) — giữ đúng hành vi bản cũ: client cần ma trận
    // ngay lúc dựng khung để khoá menu, trước cả khi biết người dùng là ai.
    // Ma trận là cấu hình quyền, không chứa dữ liệu nhạy cảm.
    if (req.method === "GET") {
      const [roles, mods, perms] = await Promise.all([
        select<RoleRow>("roles", { select: "id,label,sort,system", order: "sort.asc" }),
        select<ModRow>("perm_modules", { select: "module,sub", order: "sort.asc" }),
        select<PermRow>("role_permissions", { select: "role_id,module,sub,action,allowed", filter: { allowed: "is.true" } }),
      ]);
      return json({ ok: true, roles, matrix: toMatrix(roles, mods, perms) });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const g = await guard(req, "phan-quyen", "edit");
    if ("deny" in g) return g.deny;

    const b: any = await req.json().catch(() => ({}));
    if (b?.action !== "save") return json({ error: "bad_request" }, 400);

    // 1. Cập nhật danh sách vai trò (thêm mới / đổi nhãn). KHÔNG xoá vai trò hệ thống.
    const nextRoles: RoleRow[] = Array.isArray(b.roles) ? b.roles : [];
    if (nextRoles.length) {
      const clean = nextRoles
        .filter((r) => r?.id && /^[a-z0-9_-]{2,30}$/i.test(String(r.id)))
        .map((r, i) => ({
          id: String(r.id), label: String(r.label || r.id).slice(0, 60),
          sort: Number(r.sort) || i + 1, system: !!r.system,
        }));
      if (clean.length) {
        await fetchUpsert("roles", clean, "id", g.actor.email);
      }
    }

    // 2. Ghi lại ma trận: xoá sạch rồi chèn các ô `true`.
    //    An toàn vì luôn ghi TOÀN BỘ ma trận trong 1 lần lưu (client gửi cả bảng),
    //    và role_permissions là bảng cấu hình nhỏ (~vài trăm dòng).
    const rows = toRows(b.matrix || {});
    if (rows.length > 5000) return json({ error: "too_large" }, 413);

    await remove("role_permissions", { role_id: "not.is.null" }, g.actor.email);
    if (rows.length) await insert("role_permissions", rows, g.actor.email);

    // Đảm bảo admin không bao giờ tự khoá mình ra ngoài mục Phân quyền.
    await insert("role_permissions", ACTIONS.map((a) => ({
      role_id: "admin", module: "phan-quyen", sub: "matrix", action: a, allowed: true,
    })), g.actor.email).catch(() => { /* đã có dòng -> bỏ qua */ });

    invalidatePermCache();
    return json({ ok: true, rows: rows.length });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}

/** upsert nhỏ dùng riêng ở đây (roles có khoá text, không cần helper chung). */
async function fetchUpsert(table: string, rows: any[], onConflict: string, actor: string): Promise<void> {
  const env = (globalThis as any).process?.env || {};
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      "content-profile": env.SUPABASE_SCHEMA || "m12",
      "x-actor": actor,
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error("roles_upsert_failed:" + r.status + ":" + (await r.text()).slice(0, 200));
}
