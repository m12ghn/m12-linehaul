/* ============================================================
   Mục PHÂN QUYỀN — Vai trò (Roles) + Ma trận quyền chi tiết (module -> chức năng con -> hành động).
   - Đọc/ghi qua src/lib/usePermissions (KV /api/roles). Chỉ ADMIN mới lưu được.
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MODULES, ACTIONS, countPerms, sortRoles,
  type ActionKey, type PermMatrix, type RoleDef,
} from "../lib/rbac";
import { usePermissions, saveRbac } from "../lib/usePermissions";
import { useAdmin } from "../lib/useAdmin";
import { adminHeaders, forceReauth } from "../lib/useUser";
import { AccountsTab } from "../components/AccountsTab";

interface AccLite { email: string; name: string; roleId: string; disabled?: boolean; }

type Tab = "accounts" | "roles";
const TABS: { key: Tab; label: string }[] = [
  { key: "roles", label: "Vai trò & Quyền" },
  { key: "accounts", label: "Tài khoản nhân sự" },
];

function clone(m: PermMatrix): PermMatrix { return JSON.parse(JSON.stringify(m)); }

export function PhanQuyen() {
  const { roles: rawRoles, matrix } = usePermissions();
  const { isAdmin } = useAdmin();
  // Luôn hiển thị vai trò theo cấp bậc (Admin → Phó Phòng → Quản lý → Nhân viên → …).
  const roles = useMemo(() => sortRoles(rawRoles), [rawRoles]);
  const [tab, setTab] = useState<Tab>("roles");
  const [accs, setAccs] = useState<AccLite[]>([]);
  const [addFor, setAddFor] = useState<string | null>(null); // roleId đang mở form thêm người
  const [newM, setNewM] = useState({ email: "", name: "" });
  const [editRole, setEditRole] = useState<RoleDef | null>(null);
  const [draft, setDraft] = useState<PermMatrix | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "lich-tai": true });
  const [toast, setToast] = useState("");

  function flash(msg: string) { setToast(msg); window.setTimeout(() => setToast(""), 2600); }

  function openEdit(r: RoleDef) {
    if (!isAdmin) { flash("Chỉ Quản trị viên mới được sửa quyền. Đăng nhập tài khoản admin trước ạ."); return; }
    setEditRole(r);
    setDraft(clone(matrix));
  }
  function toggleExpand(mk: string) { setExpanded((e) => ({ ...e, [mk]: !e[mk] })); }
  function toggleCell(mk: string, sk: string, act: ActionKey) {
    if (!editRole) return;
    setDraft((d) => {
      const n = clone(d!); n[editRole.id][mk][sk][act] = !n[editRole.id][mk][sk][act]; return n;
    });
  }
  function toggleAll(mk: string, act: ActionKey) {
    if (!editRole) return;
    setDraft((d) => {
      const n = clone(d!);
      const subs = MODULES.find((m) => m.key === mk)!.subs;
      const all = subs.every((s) => n[editRole.id][mk][s.key][act]);
      subs.forEach((s) => { n[editRole.id][mk][s.key][act] = !all; });
      return n;
    });
  }
  async function save() {
    if (!editRole || !draft) return;
    const ok = await saveRbac(roles, draft);
    flash(ok ? `Đã lưu quyền cho "${editRole.name}"` : "Lưu thất bại — kiểm tra quyền Admin / kết nối.");
    if (ok) { setEditRole(null); setDraft(null); }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of roles) c[r.id] = countPerms(matrix, r.id).on;
    return c;
  }, [roles, matrix]);

  // Tải DS tài khoản (admin) để hiển thị "ai thuộc nhóm nào" dưới từng vai trò.
  async function reloadAccs() {
    try {
      const r = await fetch("/api/accounts", { headers: adminHeaders() });
      if (r.status === 401) { forceReauth(); return; }
      const d = await r.json();
      if (d?.ok) setAccs(d.accounts || []);
    } catch { /* bỏ qua */ }
  }
  useEffect(() => {
    if (!isAdmin) { setAccs([]); return; }
    reloadAccs();
  }, [isAdmin]);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Thêm 1 người vào 1 vai trò: tạo tài khoản (đăng nhập bằng Google, không cần mật khẩu)
  // hoặc chuyển người đã có sang vai trò này.
  async function addMember(roleId: string) {
    const email = newM.email.trim().toLowerCase();
    const name = newM.name.trim();
    if (!EMAIL_RE.test(email)) { flash("Email chưa hợp lệ."); return; }
    const exists = accs.find((a) => a.email.toLowerCase() === email);
    // Gửi lại toàn bộ danh sách (server giữ nguyên mật khẩu cũ theo email) + dòng mới/đổi vai trò.
    const rows = accs.map((a) => ({ email: a.email, name: a.name, roleId: a.email.toLowerCase() === email ? roleId : a.roleId, disabled: a.disabled }));
    if (!exists) rows.push({ email, name: name || email.split("@")[0], roleId, disabled: false });
    try {
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ action: "save", accounts: rows }),
      });
      if (r.status === 401) { forceReauth(); return; }
      const d = await r.json();
      if (d?.ok) { setAccs(d.accounts || []); setAddFor(null); setNewM({ email: "", name: "" }); flash(exists ? `Đã chuyển ${email} sang nhóm này.` : `Đã thêm ${email}.`); }
      else flash(d?.error === "need_active_admin" ? "Phải còn ít nhất 1 Admin đang bật." : "Thêm thất bại.");
    } catch { flash("Lỗi kết nối khi thêm."); }
  }

  // Xoá 1 người khỏi hệ thống (khỏi nhóm quyền).
  async function removeMember(email: string, roleName: string) {
    if (!window.confirm(`Xoá "${email}" khỏi nhóm ${roleName}?\nTài khoản sẽ bị xoá khỏi hệ thống (không đăng nhập được nữa).`)) return;
    try {
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ action: "delete", email }),
      });
      if (r.status === 401) { forceReauth(); return; }
      const d = await r.json();
      if (d?.ok) { flash(`Đã xoá ${email}.`); reloadAccs(); }
      else flash(d?.error === "need_active_admin" ? "Phải còn ít nhất 1 Admin đang bật." : "Xoá thất bại.");
    } catch { flash("Lỗi kết nối khi xoá."); }
  }

  // Gom tài khoản theo roleId.
  const membersByRole = useMemo(() => {
    const m: Record<string, AccLite[]> = {};
    for (const a of accs) (m[a.roleId] ??= []).push(a);
    return m;
  }, [accs]);

  return (
    <div className="pq">
      <div className="pq-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={"pq-tab" + (tab === t.key ? " on" : "")} onClick={() => setTab(t.key)}>
            {t.label}{t.key === "roles" && <span className="cnt">{roles.length}</span>}
          </button>
        ))}
      </div>

      {tab === "accounts" ? (
        <AccountsTab roles={roles} isAdmin={isAdmin} flash={flash} />
      ) : (
        <div className="pq-card">
          <div className="rolehead">
            <div className="rh-t">🛡️ Vai trò (Roles) — {roles.length}</div>
          </div>
          {isAdmin && (
            <div className="pe-d" style={{ padding: "8px 18px 0", fontSize: 13.5 }}>
              Danh sách người dưới mỗi vai trò lấy realtime từ “Tài khoản nhân sự”. Muốn đổi nhóm cho ai → mở tab <b>Tài khoản nhân sự</b>, chỉnh cột vai trò rồi bấm 💾 Lưu.
            </div>
          )}
          {roles.map((r) => {
            const mem = membersByRole[r.id] ?? [];
            return (
              <div key={r.id} className="role-row">
                <div className="rr-main">
                  <div className="rr-name">
                    {r.name}
                    {r.system && <span className="pq-badge sys">hệ thống</span>}
                    {r.locked && <span className="pq-badge lock">tạm khoá</span>}
                  </div>
                  <div className="rr-meta">🔑 {counts[r.id] ?? 0} quyền chi tiết{isAdmin && <> · 👤 {mem.length} người</>}</div>
                  {isAdmin && (
                    <div className="rr-members">
                      {mem.length === 0 && <span className="rr-empty">— chưa có tài khoản nào —</span>}
                      {mem.map((a) => (
                        <span key={a.email} className={"rr-chip" + (a.disabled ? " off" : "")} title={a.email}>
                          {a.name || a.email}{a.disabled && " (khoá)"}
                          <button className="rr-x" title={`Xoá ${a.email}`} onClick={() => removeMember(a.email, r.name)}>×</button>
                        </span>
                      ))}
                      {addFor === r.id ? (
                        <span className="rr-addform">
                          <input className="pl-in" style={{ width: 190 }} placeholder="email@giaohangnhanh.vn" value={newM.email}
                            onChange={(e) => setNewM({ ...newM, email: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && addMember(r.id)} autoFocus />
                          <input className="pl-in" style={{ width: 130 }} placeholder="Tên" value={newM.name}
                            onChange={(e) => setNewM({ ...newM, name: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && addMember(r.id)} />
                          <button className="lnk" onClick={() => addMember(r.id)}>Thêm</button>
                          <button className="lnk" onClick={() => { setAddFor(null); setNewM({ email: "", name: "" }); }}>Huỷ</button>
                        </span>
                      ) : (
                        <button className="rr-add" onClick={() => { setAddFor(r.id); setNewM({ email: "", name: "" }); }}>+ Thêm người</button>
                      )}
                    </div>
                  )}
                </div>
                <div className="rr-act">
                  <button className="btn-violet sm" disabled={!isAdmin} onClick={() => openEdit(r)}>Sửa quyền</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editRole && draft && (
        <div className="pq-backdrop" onClick={() => { setEditRole(null); setDraft(null); }}>
          <div className="pq-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pqm-h">
              <div>
                <div className="pqm-t">Ma trận quyền · {editRole.name}</div>
                <div className="pqm-s">Bấm tên module để mở chức năng con. Thay đổi áp dụng cho mọi tài khoản thuộc vai trò này.</div>
              </div>
            </div>
            <div className="pqm-body">
              <table className="matrix">
                <thead>
                  <tr>
                    <th className="mod">Module</th>
                    {ACTIONS.map((a) => <th key={a.k}>{a.l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => {
                    const exp = !!expanded[m.key];
                    return (
                      <Fragment key={m.key}>
                        <tr className="modrow">
                          <td className="mod" onClick={() => toggleExpand(m.key)}>
                            <span className={"caret" + (exp ? " open" : "")}>▸</span>{m.label}
                          </td>
                          {ACTIONS.map((a) => {
                            const vals = m.subs.map((s) => draft[editRole.id][m.key][s.key][a.k]);
                            const on = vals.every(Boolean), off = vals.every((v) => !v);
                            const st = on ? " on" : off ? "" : " some";
                            return <td key={a.k}><span className={"cb" + st} onClick={() => toggleAll(m.key, a.k)} /></td>;
                          })}
                        </tr>
                        {exp && m.subs.map((s) => (
                          <tr key={m.key + s.key} className="subrow">
                            <td className="mod"><span className="subdot" />{s.label}</td>
                            {ACTIONS.map((a) => (
                              <td key={a.k}><span className={"cb" + (draft[editRole.id][m.key][s.key][a.k] ? " on" : "")} onClick={() => toggleCell(m.key, s.key, a.k)} /></td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pqm-f">
              <span className="pqm-s">Đang bật {countPerms(draft, editRole.id).on} / {countPerms(draft, editRole.id).total} quyền chi tiết</span>
              <span style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => { setEditRole(null); setDraft(null); }}>Huỷ</button>
              <button className="btn-violet" onClick={save}>Lưu quyền</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="pq-toast">{toast}</div>}
    </div>
  );
}
