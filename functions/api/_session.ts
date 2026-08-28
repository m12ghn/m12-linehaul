/* ============================================================
   Xác thực TÀI KHOẢN (đăng nhập thật) — dùng chung cho auth/accounts/_admin.
   - Mật khẩu: KHÔNG lưu thô. Băm PBKDF2-SHA256 (100k vòng) + salt ngẫu nhiên.
   - Phiên: token gọn dạng "<payload_b64url>.<hmac>" ký bằng HMAC-SHA256 với
     secret = env.SESSION_SECRET (dự phòng env.ADMIN_TOKEN để chạy ngay khi
     chưa cấu hình secret riêng). Payload chứa { email, roleId, name, exp }.
   - Tài khoản lưu KV key "accounts:v1": { accounts: Account[] }.
   File tiền tố "_" -> KHÔNG phải route, chỉ để import.
   ============================================================ */

export interface Account {
  id: string;
  email: string;
  name: string;
  roleId: string;
  salt: string;   // hex
  hash: string;   // hex (PBKDF2)
  disabled?: boolean;
}
export interface SessionPayload {
  email: string;
  roleId: string;
  name: string;
  exp: number;    // epoch ms hết hạn
}

const ACC_KEY = "accounts:v2";
const PBKDF2_ITERS = 100_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

/** Tài khoản seed lần đầu (theo cột "Quyền" người dùng cung cấp). Mật khẩu mặc định đổi trong UI.
   Quyền -> roleId: Admin=admin, Phó Phòng=deputy, Quản lý=manager, Trưởng nhóm=leader, Nhân viên=staff.
   (Lý Kiến Vinh trùng email với Phạm Hồng Thái -> chưa seed, chờ email riêng.) */
export const DEFAULT_PASSWORD = "M12@2026";
export const SEED_ACCOUNTS: { email: string; name: string; roleId: string }[] = [
  { email: "thovdt@giaohangnhanh.vn", name: "Võ Dương Trường Thọ", roleId: "admin" },
  { email: "langnv@giaohangnhanh.vn", name: "Nguyễn Văn Làng", roleId: "admin" },
  { email: "viethq@giaohangnhanh.vn", name: "Huỳnh Quốc Việt", roleId: "deputy" },
  { email: "dunghm@giaohangnhanh.vn", name: "Huỳnh Minh Dũng", roleId: "deputy" },
  { email: "taint@giaohangnhanh.vn", name: "Nguyễn Tấn Tài", roleId: "admin" },
  { email: "huynq@giaohangnhanh.vn", name: "Nguyễn Quang Huy", roleId: "manager" },
  { email: "duyenntm@giaohangnhanh.vn", name: "Nguyễn Thị Mỹ Duyên", roleId: "manager" },
  { email: "nhinm@giaohangnhanh.vn", name: "Nguyễn Minh Nhí", roleId: "manager" },
  { email: "linhth1@giaohangnhanh.vn", name: "Tăng Hoàng Linh", roleId: "manager" },
  { email: "cuongha@giaohangnhanh.vn", name: "Huỳnh Anh Cường", roleId: "manager" },
  { email: "tuanlq@giaohangnhanh.vn", name: "Lê Quang Tuấn", roleId: "manager" },
  { email: "duypt@giaohangnhanh.vn", name: "Phạm Thanh Duy", roleId: "manager" },
  { email: "hiennt@giaohangnhanh.vn", name: "Nguyễn Thế Hiển", roleId: "manager" },
  { email: "taitq@giaohangnhanh.vn", name: "Tạ Quốc Tài", roleId: "manager" },
  { email: "nhidn@giaohangnhanh.vn", name: "Đàm Ngọc Nhi", roleId: "manager" },
  { email: "khuongph@giaohangnhanh.vn", name: "Phạm Hữu Khương", roleId: "manager" },
  { email: "phuongntb1@giaohangnhanh.vn", name: "Nguyễn Thị Bích Phượng", roleId: "manager" },
  { email: "bachht@giaohangnhanh.vn", name: "Huỳnh Thanh Bạch", roleId: "manager" },
  { email: "tuhlc@giaohangnhanh.vn", name: "Huỳnh Lê Cẩm Tú", roleId: "manager" },
  { email: "huypn@giaohangnhanh.vn", name: "Phạm Ngọc Huy", roleId: "manager" },
  { email: "khanghh10@giaohangnhanh.vn", name: "Huỳnh Hữu Kháng", roleId: "manager" },
  { email: "hant2@giaohangnhanh.vn", name: "Nguyễn Thị Hà", roleId: "manager" },
  { email: "hongthai06072001@gmail.com", name: "Phạm Hồng Thái", roleId: "staff" },
  { email: "nguyenvanhien22012002@gmail.com", name: "Nguyễn Văn Hiền", roleId: "staff" },
  { email: "tainguyenhuu06062001@gmail.com", name: "Nguyễn Hữu Tài", roleId: "staff" },
];

/** Đổi tên miền công ty: @ghn.vn -> @giaohangnhanh.vn (GHN đang đổi email). */
export const OLD_DOMAIN = "@ghn.vn";
export const NEW_DOMAIN = "@giaohangnhanh.vn";

/** Email nội bộ GHN hợp lệ = đúng 2 đuôi (theo yêu cầu): @ghn.vn HOẶC @giaohangnhanh.vn. */
export function isGhnMail(email: string): boolean {
  return /@(ghn\.vn|giaohangnhanh\.vn)$/i.test((email || "").trim());
}
/** Quy về 1 danh tính: @ghn.vn -> @giaohangnhanh.vn (2 đuôi = cùng 1 người). */
export function canonicalGhnEmail(email: string): string {
  const e = (email || "").trim().toLowerCase();
  return e.endsWith(OLD_DOMAIN) ? e.slice(0, -OLD_DOMAIN.length) + NEW_DOMAIN : e;
}
/** Đoán tên hiển thị tạm từ email (admin có thể sửa lại sau). */
export function guessNameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "").replace(/[0-9]+/g, "").replace(/[._-]+/g, " ").trim();
  if (!local) return email.split("@")[0] || "Nhân viên";
  return local.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ---------- tiện ích byte/hex/base64url ----------
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function b64urlFromBytes(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesFromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();

// ---------- băm mật khẩu ----------
export function randomSaltHex(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERS, hash: "SHA-256" },
    key, 256,
  );
  return bytesToHex(new Uint8Array(bits));
}
/** So sánh chuỗi kiểu hằng thời gian (chống dò timing). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifyPassword(password: string, acc: Account): Promise<boolean> {
  if (!acc?.salt || !acc?.hash) return false;
  const h = await hashPassword(password, acc.salt);
  return safeEqual(h, acc.hash);
}
export async function makeCredential(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomSaltHex();
  const hash = await hashPassword(password, salt);
  return { salt, hash };
}

// ---------- phiên (HMAC) ----------
function secretOf(env: any): string {
  return String(env?.SESSION_SECRET || env?.ADMIN_TOKEN || "m12-dev-secret");
}
async function hmacHex(msg: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return bytesToHex(new Uint8Array(sig));
}
export async function signSession(payload: SessionPayload, env: any): Promise<string> {
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const sig = await hmacHex(body, secretOf(env));
  return body + "." + sig;
}
export async function verifySession(token: string, env: any): Promise<SessionPayload | null> {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expect = await hmacHex(body, secretOf(env));
  if (!sig || !safeEqual(sig, expect)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(body))) as SessionPayload;
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
export function sessionExp(): number {
  return Date.now() + SESSION_TTL_MS;
}
/** Đọc token phiên từ request (Authorization: Bearer ... hoặc header x-session). */
export function readToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return (request.headers.get("x-session") || "").trim();
}
export async function getSession(request: Request, env: any): Promise<SessionPayload | null> {
  return verifySession(readToken(request), env);
}

// ---------- lưu trữ tài khoản ----------
export async function getAccounts(env: any): Promise<Account[]> {
  if (!env?.QA_KV) return [];
  const raw = await env.QA_KV.get(ACC_KEY);
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return Array.isArray(d?.accounts) ? d.accounts : [];
  } catch {
    return [];
  }
}
export async function putAccounts(env: any, accounts: Account[]): Promise<void> {
  if (!env?.QA_KV) return;
  await env.QA_KV.put(ACC_KEY, JSON.stringify({ accounts, at: Date.now() }));
}
/**
 * Đổi domain email @ghn.vn -> @giaohangnhanh.vn cho các tài khoản đã lưu.
 * GIỮ NGUYÊN mật khẩu (salt/hash), vai trò, trạng thái khoá — chỉ đổi phần đuôi email.
 * Nếu tài khoản domain mới đã tồn tại thì bỏ bản domain cũ (tránh trùng).
 */
export function migrateEmailDomain(accounts: Account[]): { accounts: Account[]; changed: boolean } {
  const existing = new Set(accounts.map((a) => a.email.toLowerCase()));
  const out: Account[] = [];
  let changed = false;
  for (const a of accounts) {
    const email = a.email.toLowerCase();
    if (email.endsWith(OLD_DOMAIN)) {
      const next = email.slice(0, -OLD_DOMAIN.length) + NEW_DOMAIN;
      if (existing.has(next)) { changed = true; continue; } // bản domain mới đã có -> bỏ bản cũ
      out.push({ ...a, id: next, email: next });
      existing.add(next);
      changed = true;
    } else {
      out.push(a);
    }
  }
  return { accounts: out, changed };
}

const PW_WIPE_FLAG = "migrated:pw-default-wipe-v1";

/** Seed tài khoản mẫu nếu KV chưa có + đổi domain + xoá mật khẩu mặc định. Trả về danh sách hiện hành. */
export async function ensureSeeded(env: any): Promise<Account[]> {
  let cur = await getAccounts(env);
  if (cur.length === 0) {
    // Seed danh sách nhân sự với vai trò định sẵn, NHƯNG chưa có mật khẩu
    // -> mỗi người tự đăng ký (OTP) đặt mật khẩu riêng, giữ nguyên vai trò.
    const seeded: Account[] = SEED_ACCOUNTS.map((s) => ({
      id: s.email.toLowerCase(), email: s.email.toLowerCase(), name: s.name, roleId: s.roleId, salt: "", hash: "",
    }));
    await putAccounts(env, seeded);
    await env.QA_KV.put(PW_WIPE_FLAG, "1");
    return seeded;
  }
  const mig = migrateEmailDomain(cur);
  if (mig.changed) { await putAccounts(env, mig.accounts); cur = mig.accounts; }

  // MỘT LẦN: xoá mật khẩu mặc định (M12@2026) của các tài khoản seed cũ
  // -> buộc chủ tài khoản tự đặt mật khẩu qua Đăng ký (giữ nguyên vai trò).
  if (env?.QA_KV && !(await env.QA_KV.get(PW_WIPE_FLAG))) {
    let changed = false;
    for (const a of cur) {
      if (a.salt && a.hash && (await verifyPassword(DEFAULT_PASSWORD, a))) {
        a.salt = ""; a.hash = ""; changed = true;
      }
    }
    if (changed) await putAccounts(env, cur);
    await env.QA_KV.put(PW_WIPE_FLAG, "1");
  }
  return cur;
}
export function findAccount(accounts: Account[], email: string): Account | undefined {
  const e = (email || "").trim().toLowerCase();
  return accounts.find((a) => a.email.toLowerCase() === e);
}
/** Loại bỏ trường nhạy cảm trước khi trả cho client. */
export function publicAccount(a: Account) {
  return { id: a.id, email: a.email, name: a.name, roleId: a.roleId, disabled: !!a.disabled, hasPassword: !!(a.salt && a.hash) };
}

// ============================================================
//  CHÍNH SÁCH MẬT KHẨU: ≥8 ký tự, ≥1 số, ≥1 ký tự đặc biệt.
// ============================================================
export const PW_MIN = 8;
export const PW_RULE = "Mật khẩu tối thiểu 8 ký tự, có ít nhất 1 số và 1 ký tự đặc biệt.";
export function checkPassword(pw: string): boolean {
  if (!pw || pw.length < PW_MIN) return false;
  if (!/[0-9]/.test(pw)) return false;
  if (!/[^A-Za-z0-9]/.test(pw)) return false;
  return true;
}

// ============================================================
//  CHỐNG DÒ MẬT KHẨU (brute-force): khoá tạm 1 email khi thử sai nhiều lần.
//  Lưu KV key "loginfail:<email>" = { n, until }. Sai >=MAX -> khoá LOCK_MS.
// ============================================================
const FAIL_MAX = 5;               // số lần sai tối đa trước khi khoá
const FAIL_WINDOW_MS = 15 * 60 * 1000; // cửa sổ đếm sai / thời gian khoá
const failKey = (email: string) => "loginfail:" + email.trim().toLowerCase();

/** Trả về số ms còn bị khoá (0 nếu không khoá). */
export async function loginLockedMs(env: any, email: string): Promise<number> {
  if (!env?.QA_KV) return 0;
  const raw = await env.QA_KV.get(failKey(email));
  if (!raw) return 0;
  try {
    const d = JSON.parse(raw);
    if (d?.until && d.until > nowMs()) return d.until - nowMs();
  } catch { /* bỏ qua */ }
  return 0;
}
/** Ghi nhận 1 lần đăng nhập SAI; khoá nếu vượt ngưỡng. */
export async function recordLoginFail(env: any, email: string): Promise<void> {
  if (!env?.QA_KV) return;
  const k = failKey(email);
  let n = 0;
  try { const raw = await env.QA_KV.get(k); if (raw) n = JSON.parse(raw)?.n || 0; } catch { /* bỏ qua */ }
  n += 1;
  const until = n >= FAIL_MAX ? nowMs() + FAIL_WINDOW_MS : 0;
  await env.QA_KV.put(k, JSON.stringify({ n, until }), { expirationTtl: Math.ceil(FAIL_WINDOW_MS / 1000) });
}
/** Xoá bộ đếm sai (khi đăng nhập thành công). */
export async function clearLoginFail(env: any, email: string): Promise<void> {
  if (!env?.QA_KV) return;
  await env.QA_KV.delete(failKey(email));
}
// nowMs tách riêng để dễ test; Cloudflare có Date.now().
function nowMs(): number { return Date.now(); }

// ============================================================
//  ĐĂNG NHẬP GOOGLE: xác thực ID token (JWT) do Google Identity Services cấp.
//  Dùng endpoint tokeninfo của Google (Google tự kiểm chữ ký + hạn) rồi ta
//  kiểm thêm aud (client id của mình) + email_verified. Chống hacker mạo email.
// ============================================================
export interface GoogleIdentity { email: string; name: string; }
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity | null> {
  if (!idToken || !clientId) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const d: any = await r.json();
    if (String(d?.aud || "") !== clientId) return null;            // token phải phát cho app của mình
    if (String(d?.email_verified) !== "true") return null;         // email phải đã xác minh
    if (d?.exp && Number(d.exp) * 1000 < nowMs()) return null;     // còn hạn
    const email = String(d?.email || "").trim().toLowerCase();
    if (!email) return null;
    return { email, name: String(d?.name || "").trim() };
  } catch {
    return null;
  }
}

// ============================================================
//  ĐĂNG NHẬP BẰNG MÃ OTP GỬI QUA EMAIL (không cần Client ID Google).
//  - Sinh mã 6 số, LƯU HASH (SHA-256) vào KV "otp:<email>" TTL 10 phút.
//  - Gửi mã tới email qua Brevo (API HTTP). Chỉ email trong DS tài khoản mới nhận.
// ============================================================
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_TRIES = 5;
const otpKey = (email: string) => "otp:" + email.trim().toLowerCase();
const otpSentKey = (email: string) => "otpsent:" + email.trim().toLowerCase();

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return bytesToHex(new Uint8Array(d));
}
/** Mã OTP 6 chữ số (ngẫu nhiên an toàn). */
export function randomOtp(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1000000).padStart(6, "0");
}
/** Đang trong thời gian chờ gửi lại (60s) không. */
export async function otpOnCooldown(env: any, email: string): Promise<boolean> {
  if (!env?.QA_KV) return false;
  return !!(await env.QA_KV.get(otpSentKey(email)));
}
/** Lưu OTP (hash) + đánh dấu vừa gửi (cooldown 60s). */
export async function storeOtp(env: any, email: string, code: string): Promise<void> {
  const hash = await sha256hex(code);
  await env.QA_KV.put(otpKey(email), JSON.stringify({ hash, exp: nowMs() + OTP_TTL_MS, tries: 0 }), { expirationTtl: Math.ceil(OTP_TTL_MS / 1000) });
  await env.QA_KV.put(otpSentKey(email), "1", { expirationTtl: 60 });
}
export type OtpResult = "ok" | "expired" | "wrong" | "toomany" | "none";
/** Kiểm tra mã OTP người dùng nhập. */
export async function checkOtp(env: any, email: string, code: string): Promise<OtpResult> {
  if (!env?.QA_KV) return "none";
  const raw = await env.QA_KV.get(otpKey(email));
  if (!raw) return "none";
  let d: any;
  try { d = JSON.parse(raw); } catch { return "none"; }
  if (!d?.exp || d.exp < nowMs()) { await env.QA_KV.delete(otpKey(email)); return "expired"; }
  if ((d.tries || 0) >= OTP_MAX_TRIES) return "toomany";
  const hash = await sha256hex(String(code || ""));
  if (safeEqual(hash, String(d.hash || ""))) { await env.QA_KV.delete(otpKey(email)); return "ok"; }
  d.tries = (d.tries || 0) + 1;
  const ttl = Math.max(1, Math.ceil((d.exp - nowMs()) / 1000));
  await env.QA_KV.put(otpKey(email), JSON.stringify(d), { expirationTtl: ttl });
  return "wrong";
}
/** Gửi email chứa mã OTP qua Brevo. Trả false nếu chưa cấu hình / gửi lỗi. */
export async function sendOtpEmail(env: any, email: string, code: string): Promise<boolean> {
  const key = String(env?.BREVO_API_KEY || "");
  const from = String(env?.OTP_FROM_EMAIL || "");
  if (!key || !from) return false;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:460px;margin:auto">
      <h2 style="color:#6b3df0;margin:0 0 8px">Dashboard M12 · Mã đăng nhập</h2>
      <p style="color:#3a4753;font-size:14px">Mã đăng nhập của bạn là:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#111;background:#f2ecff;border-radius:10px;padding:14px;text-align:center">${code}</div>
      <p style="color:#8a97a5;font-size:12.5px;margin-top:12px">Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
    </div>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: String(env?.OTP_FROM_NAME || "Dashboard M12") },
        to: [{ email }],
        subject: "Mã đăng nhập Dashboard M12",
        htmlContent: html,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
