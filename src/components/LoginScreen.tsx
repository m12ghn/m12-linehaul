import { useState } from "react";
import "../styles/login.css";

type Props = {
  /** Bấm "Đăng nhập" (ID nhân viên / tên đăng nhập + mật khẩu). */
  onSubmit?: (username: string, password: string) => void;
  /** Bấm "Đăng nhập bằng tài khoản GHN" (SSO/OAuth nội bộ). */
  onGhnLogin?: () => void;
  /** Chuỗi phiên bản ở chân trang. */
  version?: string;
};

/** Màn đăng nhập GHN·GateFlow — chỉ giao diện, đúng như thiết kế:
 *  cột trái thương hiệu, cột phải form ID/mật khẩu + đăng nhập tài khoản GHN. */
export function LoginScreen({ onSubmit, onGhnLogin, version = "v1.76.3" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="gf-login">
      <div className="gf-brand">
        <img className="gf-logo" src="/favicon-v6.png" alt="GHN" />
        {/* 07/09/2026: Sếp yêu cầu đổi lại đúng tên app thật (khớp <h1> ở Header.tsx
            của dashboard chính) thay vì tên tạm "GHN·GateFlow" lúc phác thảo. */}
        <div className="gf-brand-title">TRANG QUẢN LÝ LINEHAUL M12</div>
        <div className="gf-brand-sub">M12SC · LINEHAUL — Điều phối xe tải · Sorting center</div>
      </div>

      <div className="gf-panel">
        <form
          className="gf-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.(username, password);
          }}
        >
          <div className="gf-title">Đăng nhập hệ thống</div>

          <label className="gf-label" htmlFor="gf-user">ID nhân viên / tên đăng nhập</label>
          <input
            id="gf-user"
            className="gf-input"
            type="text"
            autoComplete="username"
            placeholder="Nhập ID / tên đăng nhập"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="gf-eye" onClick={() => setShowPw((v) => !v)}>
              {showPw ? "Ẩn" : "Hiện"}
            </button>
          </div>

          <button type="submit" className="gf-submit">Đăng nhập</button>

          <div className="gf-or">hoặc</div>

          <button type="button" className="gf-oauth" onClick={() => onGhnLogin?.()}>
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
        </form>

        <div className="gf-ver">{version} · Tài khoản gắn với kho của bạn</div>
      </div>
    </div>
  );
}
