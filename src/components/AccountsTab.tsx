/* ============================================================
   Tab "Tài khoản nhân sự" trong mục Phân quyền.
   - Đọc/ghi qua /api/accounts (chỉ ADMIN). Mỗi tài khoản: email + tên + vai trò + mật khẩu riêng.
   - Mật khẩu không bao giờ hiển thị; chỉ đặt mới / đặt lại.
   ============================================================ */
import { useEffect, useState } from "react";
import type { RoleDef } from "../lib/rbac";
import { adminHeaders, forceReauth } from "../lib/useUser";

interface Acc { id: string; email: string; name: string; roleId: string; disabled?: boolean; hasPassword?: boolean; }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Chính sách mật khẩu (khớp server): ≥8 ký tự, ≥1 số, ≥1 ký tự đặc biệt. */
const PW_OK = (pw: string) => pw.length >= 8 && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
const PW_RULE = "Mật khẩu tối thiểu 8 ký tự, có ít nhất 1 số và 1 ký tự đặc biệt.";

export function AccountsTab({ roles, isAdmin, flash }: { roles: RoleDef[]; isAdmin: boolean; flash: (m: string) => void }) {
  const [rows, setRows] = useState<Acc[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [nw, setNw] = useState({ email: "", name: "", roleId: "staff", password: "" });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");

  const roleLabel = (id: string) => {
    const r = roles.find((x) => x.id === id);
    return r ? r.name : id;
  };

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/accounts", { headers: adminHeaders() });
      const d = await r.json();
      if (d?.ok) { setRows(d.accounts || []); setDirty(false); }
      // isAdmin phía client đã đúng (mới vào được component này) nhưng server từ chối
      // -> phiên đăng nhập hết hạn/không hợp lệ, KHÔNG PHẢI thiếu quyền. Đưa về đăng nhập lại.
      else if (r.status === 401) forceReauth();
      else flash("Không tải được danh sách tài khoản.");
    } catch { flash("Lỗi kết nối khi tải tài khoản."); }
    setLoading(false);
  }
  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin]);

  function editRow(email: string, patch: Partial<Acc>) {
    setRows((rs) => rs.map((r) => (r.email === email ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  async function persist(accounts: (Acc & { newPassword?: string })[], okMsg: string) {
    try {
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ action: "save", accounts }),
      });
      if (r.status === 401) { forceReauth(); return false; }
      const d = await r.json();
      if (d?.ok) { setRows(d.accounts || []); setDirty(false); flash(okMsg); return true; }
      const map: Record<string, string> = {
        need_active_admin: "Phải còn ít nhất 1 tài khoản Admin đang hoạt động.",
        need_password: "Tài khoản mới cần đặt mật khẩu.",
        weak_password: "Mật khẩu tối thiểu 6 ký tự.",
      };
      flash(map[d?.error] || "Lưu thất bại.");
    } catch { flash("Lỗi kết nối khi lưu."); }
    return false;
  }

  function saveAll() { persist(rows, "Đã lưu danh sách tài khoản."); }

  async function addNew() {
    const email = nw.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { flash("Email chưa hợp lệ."); return; }
    if (rows.some((r) => r.email.toLowerCase() === email)) { flash("Email đã tồn tại."); return; }
    if (nw.password && !PW_OK(nw.password)) { flash(PW_RULE); return; }
    const next = [...rows, { id: email, email, name: nw.name.trim(), roleId: nw.roleId, ...(nw.password ? { newPassword: nw.password } : {}) }];
    const ok = await persist(next, `Đã thêm tài khoản ${email}.`);
    if (ok) setNw({ email: "", name: "", roleId: "staff", password: "" });
  }

  async function doReset(email: string) {
    if (!PW_OK(resetPw)) { flash(PW_RULE); return; }
    try {
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ action: "reset-password", email, newPassword: resetPw }),
      });
      if (r.status === 401) { forceReauth(); return; }
      const d = await r.json();
      if (d?.ok) { flash(`Đã đặt lại mật khẩu cho ${email}.`); setResetFor(null); setResetPw(""); }
      else flash("Đặt lại mật khẩu thất bại.");
    } catch { flash("Lỗi kết nối."); }
  }

  async function del(email: string) {
    try {
      const r = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ action: "delete", email }),
      });
      if (r.status === 401) { forceReauth(); return; }
      const d = await r.json();
      if (d?.ok) { flash(`Đã xoá ${email}.`); load(); }
      else flash(d?.error === "need_active_admin" ? "Phải còn ít nhất 1 Admin hoạt động." : "Xoá thất bại.");
    } catch { flash("Lỗi kết nối."); }
  }

  if (!isAdmin) {
    return (
      <div className="pq-card pq-empty">
        <div className="pe-ic">🔒</div>
        <div className="pe-t">Tài khoản nhân sự</div>
        <div className="pe-d">Cần quyền admin để quản lý tài khoản.</div>
      </div>
    );
  }

  return (
    <div className="pq-card">
      <div className="rolehead">
        <div className="rh-t">👥 Tài khoản nhân sự — {rows.length}</div>
        <button className="btn-violet" disabled={!dirty} onClick={saveAll}>💾 Lưu thay đổi</button>
      </div>

      {loading ? <div className="pe-d" style={{ padding: 16 }}>Đang tải…</div> : (
        <div className="acc-table">
          {rows.map((r) => (
            <div key={r.email} className="acc-row">
              <div className="acc-cell acc-email" title={r.email}>
                {r.email}
                <span className="acc-tag" title={r.hasPassword ? "Có mật khẩu dự phòng" : "Chỉ đăng nhập bằng Google"}>{r.hasPassword ? "🔑" : "🅶"}</span>
              </div>
              <input className="pl-in acc-name" value={r.name} placeholder="Tên" onChange={(e) => editRow(r.email, { name: e.target.value })} />
              <select className="pl-in acc-role" value={r.roleId} onChange={(e) => editRow(r.email, { roleId: e.target.value })}>
                {roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.id)}</option>)}
              </select>
              <label className="acc-dis" title="Tạm khoá đăng nhập">
                <input type="checkbox" checked={!r.disabled} onChange={(e) => editRow(r.email, { disabled: !e.target.checked })} /> Bật
              </label>
              {resetFor === r.email ? (
                <span className="acc-act">
                  <input className="pl-in" type="text" placeholder="MK mới (≥8, có số & ký tự đặc biệt)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} style={{ width: 240 }} />
                  <button className="lnk" onClick={() => doReset(r.email)}>OK</button>
                  <button className="lnk" onClick={() => { setResetFor(null); setResetPw(""); }}>Huỷ</button>
                </span>
              ) : (
                <span className="acc-act">
                  <button className="lnk" onClick={() => { setResetFor(r.email); setResetPw(""); }}>Đặt lại MK</button>
                  <button className="lnk lnk-del" onClick={() => del(r.email)}>Xoá</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="acc-new">
        <div className="rh-t" style={{ fontSize: 15 }}>➕ Thêm tài khoản</div>
        <div className="acc-newform">
          <label className="acc-fld">
            <span className="acc-fld-lb">Email</span>
            <input className="pl-in" placeholder="email@giaohangnhanh.vn" value={nw.email} onChange={(e) => setNw({ ...nw, email: e.target.value })} />
          </label>
          <label className="acc-fld">
            <span className="acc-fld-lb">Tên hiển thị</span>
            <input className="pl-in" placeholder="Nguyễn Văn A" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
          </label>
          <label className="acc-fld">
            <span className="acc-fld-lb">Vai trò</span>
            <select className="pl-in" value={nw.roleId} onChange={(e) => setNw({ ...nw, roleId: e.target.value })}>
              {roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.id)}</option>)}
            </select>
          </label>
          <label className="acc-fld">
            <span className="acc-fld-lb">Mật khẩu <span className="acc-fld-hint">(bỏ trống nếu dùng Google)</span></span>
            <input className="pl-in" type="text" placeholder="≥8 ký tự, có số & ký tự đặc biệt" value={nw.password} onChange={(e) => setNw({ ...nw, password: e.target.value })} />
          </label>
          <button className="btn-violet acc-addbtn" onClick={addNew}>➕ Thêm tài khoản</button>
        </div>
        <div className="pe-d" style={{ marginTop: 6, fontSize: 13.5 }}>
          Ưu tiên đăng nhập bằng <b>Google</b> (không cần mật khẩu). Nếu đặt mật khẩu: {PW_RULE} Mật khẩu được băm ở máy chủ, không lưu thô. Đổi vai trò/tên xong nhớ bấm “Lưu thay đổi”.
        </div>
      </div>
    </div>
  );
}
