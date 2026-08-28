import { useState } from "react";
import { popReauthMsg } from "../lib/useUser";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ERR_MSG: Record<string, string> = {
  missing: "Sếp nhập email giúp em.",
  network: "Lỗi kết nối, Sếp thử lại giúp em.",
  no_kv: "Hệ thống tài khoản chưa sẵn sàng, báo admin giúp em.",
  not_ghn: "Chỉ email nội bộ GHN (@ghn.vn hoặc @giaohangnhanh.vn) mới đăng nhập được ạ.",
  not_allowed: "Email này chưa được duyệt truy cập. Sếp liên hệ admin để được cấp quyền trong mục Phân quyền.",
  disabled: "Tài khoản đang bị khoá. Sếp liên hệ admin giúp em.",
};

/** Cổng đăng nhập NHANH: nhập email GHN đã được admin duyệt trước (mục Phân quyền) là vào —
 *  email lạ chưa có trong danh sách tài khoản sẽ bị từ chối, không tự tạo tài khoản mới. */
export function EmailGate({ onEmailLogin }: { onEmailLogin: (email: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState(() => popReauthMsg());
  const [busy, setBusy] = useState(false);

  const valid = EMAIL_RE.test(email.trim());

  async function submit() {
    if (!valid) { setErr("Email chưa hợp lệ, Sếp kiểm tra lại giúp em."); return; }
    setBusy(true); setErr("");
    const res = await onEmailLogin(email.trim());
    setBusy(false);
    if (!res.ok) setErr(ERR_MSG[res.error || "not_ghn"] || ERR_MSG.not_ghn);
  }

  return (
    <div className="emailgate">
      <div className="eg-card">
        <img src="/logo-ghn.jpg" className="eg-logo" alt="Giao Hàng Nhanh" />
        <div className="eg-title">Dashboard M12</div>
        <div className="eg-subtitle">Đăng nhập bằng email nội bộ GHN</div>

        <label className="eg-lb">Email GHN</label>
        <input
          className="pl-in eg-in"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />

        <button className="eg-btn" onClick={submit} disabled={!valid || busy}>
          {busy ? "Đang vào…" : "Vào Dashboard →"}
        </button>

        {err && <div className="eg-err">{err}</div>}

        <div className="eg-note">🔒 Chỉ tài khoản đã được admin duyệt trong mục Phân quyền mới đăng nhập được.</div>
      </div>
    </div>
  );
}
