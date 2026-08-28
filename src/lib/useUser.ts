/* Người dùng đăng nhập THẬT bằng email + mật khẩu (mỗi tài khoản 1 mật khẩu + 1 vai trò).
   Đăng nhập gọi /api/auth -> nhận token phiên (ký HMAC ở server) + vai trò.
   Lưu localStorage để lần sau khỏi nhập lại. Email @ghn -> xưng "Sếp <tên>". */
import { useState } from "react";

export interface AppUser {
  email: string;
  name: string;   // tên hiển thị
  ghn: boolean;   // email nội bộ GHN -> gọi "Sếp"
  roleId: string; // vai trò (admin/manager/staff/cluster/leader/...)
  token: string;  // token phiên để gửi kèm request cần quyền
}

// Bump khoá phiên -> ĐĂNG XUẤT toàn bộ phiên cũ (2026-07-15: chuyển sang đăng nhập OTP email).
const KEY = "m12.user5";

export function isGhn(email: string): boolean {
  // GHN đang đổi domain email: chấp nhận cả @giaohangnhanh.vn (mới) lẫn @ghn.* (cũ).
  return /@(giaohangnhanh\.vn|ghn\.(vn|com|com\.vn))$/i.test((email || "").trim());
}

/** Đoán tên từ email: lấy đoạn đầu trước dấu chấm/gạch/số rồi viết hoa chữ đầu. */
export function guessName(email: string): string {
  const local = (email.split("@")[0] || "").trim();
  const seg = local.split(/[._\-]/).filter(Boolean)[0] || local;
  const clean = seg.replace(/[0-9]+/g, "").replace(/[^a-zA-ZÀ-ỹ]/g, "");
  if (!clean) return "bạn";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

// ---- Bóc TÊN RIÊNG kiểu Việt từ email GHN ----
const ONSETS = ["ngh", "ng", "nh", "ch", "gh", "kh", "ph", "th", "tr", "b", "c", "d", "g", "h", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "x"];
const CODAS = ["ng", "nh", "ch", "c", "m", "n", "p", "t"];
const isVowel = (c: string) => "aeiouy".includes(c);
const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
const stripDia = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");

/** nguyên âm cuối có cho phép phụ âm cuối (coda) không. */
function allowsCoda(nuc: string): boolean {
  if (nuc === "y") return false;
  if (nuc.length === 1) return true;
  const last = nuc[nuc.length - 1], prev = nuc[nuc.length - 2];
  if (last === "i" || last === "y") return nuc.endsWith("uy");
  if (last === "o") return !(prev === "a" || prev === "e");
  if (last === "u") return !(prev === "a" || prev === "e" || prev === "i" || prev === "u");
  return true;
}

export function ghnGivenName(local: string): string {
  const s = stripDia((local || "").toLowerCase()).replace(/[^a-z]/g, "");
  if (!s) return "";
  let on = "";
  for (const o of ONSETS) { if (s.startsWith(o)) { on = o; break; } }
  let i = on.length, nuc = "";
  while (i < s.length && isVowel(s[i])) { nuc += s[i]; i++; }
  if (!nuc) return cap(s);
  let coda = "";
  if (allowsCoda(nuc)) { for (const c of CODAS) { if (s.startsWith(c, i)) { coda = c; break; } } }
  if (coda && s.length - (i + coda.length) < 2 && s.length - i >= 2) coda = "";
  return cap(on + nuc + coda);
}

/** Gợi ý tên hiển thị: CHỈ email GHN mới gợi ý (lấy tên riêng); email khác -> rỗng. */
export function suggestName(email: string): string {
  if (!isGhn(email)) return "";
  return ghnGivenName((email.split("@")[0] || "").trim());
}

/** Xưng hô đầy đủ: GHN -> "Sếp Thọ", ngoài -> "Thọ". */
export function addressOf(u: AppUser | null): string {
  if (!u) return "Sếp";
  return u.ghn ? `Sếp ${u.name}` : u.name;
}

function read(): AppUser | null {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
let cached: AppUser | null = read();

/** Đọc user hiện tại không qua hook (cho component cần xưng hô / vai trò). */
export function getUser(): AppUser | null { return cached || read(); }

/** Token phiên hiện tại (rỗng nếu chưa đăng nhập). */
export function getToken(): string { return getUser()?.token || ""; }

/** Header xác thực cho API cần quyền: gửi token phiên (Bearer). */
export function adminHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: "Bearer " + t } : {};
}

const REAUTH_MSG_KEY = "m12.reauth-msg";

/** Phiên đăng nhập đã có (roleId admin) nhưng server từ chối (token hết hạn/không hợp lệ) —
 *  KHÁC với "không có quyền admin". Xoá phiên cũ + tải lại trang để quay về màn đăng nhập,
 *  kèm thông báo rõ ràng thay vì để Sếp thấy lỗi "cần quyền admin" khó hiểu khi đang là admin. */
export function forceReauth(msg = "Phiên đăng nhập đã hết hạn, Sếp đăng nhập lại giúp em."): void {
  cached = null;
  try { localStorage.removeItem(KEY); } catch { /* bỏ qua */ }
  try { sessionStorage.setItem(REAUTH_MSG_KEY, msg); } catch { /* bỏ qua */ }
  window.location.reload();
}

/** Đọc + xoá thông báo re-auth (hiện 1 lần trên màn đăng nhập rồi thôi). */
export function popReauthMsg(): string {
  try {
    const m = sessionStorage.getItem(REAUTH_MSG_KEY) || "";
    if (m) sessionStorage.removeItem(REAUTH_MSG_KEY);
    return m;
  } catch { return ""; }
}

export function useUser() {
  const [user, setUser] = useState<AppUser | null>(cached);

  /** Đăng nhập bằng email + mật khẩu. Trả { ok, error? }. */
  async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
    const e = email.trim().toLowerCase();
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "login", email: e, password }),
      });
      const d = await r.json();
      if (!d?.ok || !d?.token) return { ok: false, error: d?.error || "invalid" };
      const u: AppUser = { email: d.email, name: d.name, ghn: isGhn(d.email), roleId: d.roleId, token: d.token };
      cached = u;
      try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* bỏ qua */ }
      setUser(u);
      // Ghi nhận lượt đăng nhập (không chặn giao diện).
      fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, name: u.name }) }).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  /** ĐĂNG NHẬP NHANH: chỉ cần email GHN là vào (không mã, không mật khẩu). */
  async function emailLogin(email: string): Promise<{ ok: boolean; error?: string }> {
    const e = email.trim().toLowerCase();
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "quick-login", email: e }),
      });
      const d = await r.json();
      if (!d?.ok || !d?.token) return { ok: false, error: d?.error || "not_ghn" };
      const u: AppUser = { email: d.email, name: d.name, ghn: isGhn(d.email), roleId: d.roleId, token: d.token };
      cached = u;
      try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* bỏ qua */ }
      setUser(u);
      fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, name: u.name }) }).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  /** ĐĂNG NHẬP NHANH bước 1: gửi mã tới email GHN. */
  async function requestOtp(email: string): Promise<{ ok: boolean; error?: string; devCode?: string }> {
    const e = email.trim().toLowerCase();
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request-otp", email: e }),
      });
      const d = await r.json();
      return d?.ok ? { ok: true, devCode: d.devCode } : { ok: false, error: d?.error || "email_failed" };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  /** ĐĂNG NHẬP NHANH bước 2: xác mã -> vào luôn (tự tạo Nhân viên nếu mới). */
  async function verifyOtp(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
    const e = email.trim().toLowerCase();
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify-otp", email: e, code: code.trim() }),
      });
      const d = await r.json();
      if (!d?.ok || !d?.token) return { ok: false, error: d?.error || "otp_wrong" };
      const u: AppUser = { email: d.email, name: d.name, ghn: isGhn(d.email), roleId: d.roleId, token: d.token };
      cached = u;
      try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* bỏ qua */ }
      setUser(u);
      fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, name: u.name }) }).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  /** Xác mã + đặt mật khẩu (purpose: register | reset) -> tạo phiên đăng nhập. */
  async function setPassword(email: string, code: string, password: string, name = "", purpose: "register" | "reset" = "register"): Promise<{ ok: boolean; error?: string }> {
    const e = email.trim().toLowerCase();
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-password", email: e, code: code.trim(), password, name, purpose }),
      });
      const d = await r.json();
      if (!d?.ok || !d?.token) return { ok: false, error: d?.error || "otp_wrong" };
      const u: AppUser = { email: d.email, name: d.name, ghn: isGhn(d.email), roleId: d.roleId, token: d.token };
      cached = u;
      try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* bỏ qua */ }
      setUser(u);
      fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, name: u.name }) }).catch(() => {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  function logout() {
    cached = null;
    try { localStorage.removeItem(KEY); } catch { /* bỏ qua */ }
    setUser(null);
  }
  return { user, emailLogin, login, requestOtp, verifyOtp, setPassword, logout };
}
