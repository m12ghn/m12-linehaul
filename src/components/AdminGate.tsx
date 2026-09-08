import { getUser } from "../lib/useUser";

/** Màn chặn khu vực cần quyền admin. Quyền nay gắn theo TÀI KHOẢN đăng nhập
 *  (vai trò admin), không còn mở khoá bằng mật khẩu chung. Tài khoản không đủ
 *  quyền sẽ thấy thông báo; muốn dùng cần đăng nhập bằng tài khoản có quyền. */
export function AdminGate({ title }: { title?: string }) {
  const u = getUser();
  return (
    <div className="section-card admin-gate">
      <div className="ag-ic">🔒</div>
      <h2 style={{ marginBottom: 4 }}>Khu vực quản trị{title ? ` · ${title}` : ""}</h2>
      <p className="lead" style={{ maxWidth: 480, margin: "0 auto 12px" }}>
        Mục này cần tài khoản có <b>quyền quản trị</b>. Tài khoản của bạn{u ? <> (<b>{u.email}</b>)</> : ""} hiện chưa có quyền dùng mục này.
      </p>
      <p className="lead" style={{ maxWidth: 480, margin: "0 auto", fontSize: 14.5, color: "var(--text-muted)" }}>
        Nếu cần, liên hệ admin để được cấp vai trò phù hợp, hoặc đăng nhập bằng tài khoản có quyền.
      </p>
    </div>
  );
}
