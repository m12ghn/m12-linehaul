import { useState } from "react";
import "../styles/login.css";
import { popReauthMsg } from "../lib/useUser";

type Props = {
  /** Đăng nhập bằng email GHN + mật khẩu (POST /api/auth action:"login"). */
  onLogin: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Chuỗi phiên bản ở chân trang. */
  version?: string;
};

const ERR_MSG: Record<string, string> = {
  missing: "Sếp nhập đủ email và mật khẩu giúp em.",
  invalid: "Email hoặc mật khẩu chưa đúng.",
  locked: "Nhập sai quá nhiều lần, tài khoản tạm khoá vài phút, Sếp thử lại sau giúp em.",
  no_kv: "Hệ thống tài khoản chưa sẵn sàng, báo admin giúp em.",
  network: "Lỗi kết nối, Sếp thử lại giúp em.",
};

/** Màn đăng nhập chính thức GHN·GateFlow — cột trái thương hiệu, cột phải form
 *  email + mật khẩu (07/09/2026: thay cho cổng chỉ-cần-email EmailGate cũ, mỗi
 *  tài khoản giờ bắt buộc có mật khẩu riêng — đặt/đổi ở mục Phân quyền → Tài khoản
 *  nhân sự). Đăng nhập bằng tài khoản GHN (SSO nội bộ) CHƯA kết nối — Sếp sẽ nối
 *  sau, nên nút này chỉ báo "Chưa hỗ trợ", không gọi API nào. */
export function LoginScreen({ onLogin, version = "v1.76.3" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(() => popReauthMsg());
  const [ssoNote, setSsoNote] = useState(false);

  async function submit() {
    const email = username.trim();
    if (!email || !password) { setErr(ERR_MSG.missing); return; }
    setBusy(true); setErr("");
    const res = await onLogin(email, password);
    setBusy(false);
    if (!res.ok) setErr(ERR_MSG[res.error || "invalid"] || ERR_MSG.invalid);
  }

  return (
    <div className="gf-login">
      <div className="gf-brand">
        <img className="gf-logo" src="/favicon-v6.png" alt="GHN" />
        <div className="gf-brand-title">TRANG QUẢN LÝ LINEHAUL M12</div>
        <div className="gf-brand-sub">M12SC · LINEHAUL — Điều phối xe tải · Sorting center</div>
      </div>

      <div className="gf-panel">
        <form
          className="gf-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="gf-title">Đăng nhập hệ thống</div>

          <label className="gf-label" htmlFor="gf-user">Email GHN</label>
          <input
            id="gf-user"
            className="gf-input"
            type="email"
            autoComplete="username"
            placeholder="ten.nv@ghn.vn"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setErr(""); }}
          />

          <label className="gf-label" htmlFor="gf-pw">Mật khẩu</label>
          <div className="gf-pw">
            <input
              id="gf-pw"
              className="gf-input"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button type="button" className="gf-eye" onClick={() => setShowPw((v) => !v)}>
              {showPw ? "Ẩn" : "Hiện"}
            </button>
          </div>

          <button type="submit" className="gf-submit" disabled={busy}>
            {busy ? "Đang vào…" : "Đăng nhập"}
          </button>

          {err && <div className="gf-err">{err}</div>}

          <div className="gf-or">hoặc</div>

          <button type="button" className="gf-oauth" onClick={() => setSsoNote(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2.6 4.4 5.9v5.6c0 4.7 3.2 9.1 7.6 10.2 4.4-1.1 7.6-5.5 7.6-10.2V5.9L12 2.6Z"
                stroke="#e2453b"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
            Đăng nhập bằng tài khoản GHN
          </button>

          <div className="gf-oauth-note">Dành cho quản lý &amp; nhân viên GHN</div>
          <div className="gf-pwnote">Chưa có mật khẩu? Liên hệ admin để được cấp trong mục Phân quyền.</div>
        </form>

        <div className="gf-ver">{version} · Tài khoản gắn với kho của bạn</div>
      </div>

      {ssoNote && (
        <div className="gf-modal-backdrop" onClick={() => setSsoNote(false)}>
          <div className="gf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="gf-modal-title">Chưa hỗ trợ</div>
            <div className="gf-modal-body">
              Đăng nhập bằng tài khoản GHN (SSO nội bộ) đang được kết nối, chưa dùng được lúc này.
              Sếp đăng nhập bằng email GHN + mật khẩu giúp em.
            </div>
            <button className="gf-modal-close" onClick={() => setSsoNote(false)}>Đã hiểu</button>
          </div>
        </div>
      )}
    </div>
  );
}
