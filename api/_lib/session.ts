/* ============================================================
   Phiên đăng nhập + kiểm tra quyền — bản port từ functions/api/_session.ts
   và _admin.ts sang Vercel, dữ liệu nằm ở Supabase thay vì Cloudflare KV.

   Giữ NGUYÊN thuật toán cũ để tài khoản đang có không phải đặt lại mật khẩu:
     - mật khẩu: PBKDF2-SHA256, 100_000 vòng, salt ngẫu nhiên, lưu hex
     - phiên:    "<payload_b64url>.<hmac_sha256>" ký bằng SESSION_SECRET
   Toàn bộ chạy trên Web Crypto -> tương thích cả Edge lẫn Node runtime.

   Biến môi trường:
     SESSION_SECRET   chuỗi ngẫu nhiên dài (BẮT BUỘC ở production)
     BOOTSTRAP_TOKEN  khoá dự phòng, gửi qua header x-admin-token khi bị khoá ngoài
   ============================================================ */
import { select, update, one } from "./supabase";

const enc = new TextEncoder();
const SESSION_DAYS = 30;

export interface SessionPayload {
  email: string;
  roleId: string;
  name: string;
  exp: number;
}

// ---------- tiện ích mã hoá ----------
function b64url(bytes: Uint8Array<ArrayBuffer>): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/** So sánh chuỗi theo thời gian hằng — chống dò từng ký tự qua đo thời gian. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function secret(): string {
  const s = (globalThis as any).process?.env?.SESSION_SECRET
         || (globalThis as any).process?.env?.BOOTSTRAP_TOKEN;
  if (!s) throw new Error("missing_env:SESSION_SECRET");
  return String(s);
}

// ---------- mật khẩu ----------
export const PW_RULE = "Mật khẩu tối thiểu 8 ký tự, có cả chữ và số.";
export function checkPassword(p: string): boolean {
  return typeof p === "string" && p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256,
  );
  return { salt: hex(salt.buffer), hash: hex(bits) };
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  if (!saltHex || !hashHex) return false;
  const { hash } = await hashPassword(password, saltHex);
  return safeEqual(hash, hashHex);
}

// ---------- token phiên ----------
async function hmac(input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(input))));
}

export function sessionExp(): number {
  return Date.now() + SESSION_DAYS * 86400_000;
}

export async function signSession(p: SessionPayload): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(p)));
  return payload + "." + (await hmac(payload));
}

export async function readSession(token: string): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(await hmac(payload), sig)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(payload))) as SessionPayload;
    if (!p?.email || !p?.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Đọc phiên từ header Authorization: Bearer <token>. */
export function bearer(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

export function getSession(req: Request): Promise<SessionPayload | null> {
  return readSession(bearer(req));
}

// ---------- email GHN ----------
export function isGhnEmail(email: string): boolean {
  return /@(giaohangnhanh\.vn|ghn\.(vn|com|com\.vn))$/i.test((email || "").trim());
}

// ---------- quyền ----------
export interface Actor extends SessionPayload { bootstrap?: boolean }

/** Phiên hiện tại; hỗ trợ khoá dự phòng x-admin-token để không bị khoá ngoài. */
export async function actorOf(req: Request): Promise<Actor | null> {
  const boot = (globalThis as any).process?.env?.BOOTSTRAP_TOKEN;
  const tok = req.headers.get("x-admin-token") || "";
  if (boot && tok && safeEqual(tok, String(boot))) {
    return { email: "bootstrap@local", roleId: "admin", name: "Bootstrap", exp: sessionExp(), bootstrap: true };
  }
  const s = await getSession(req);
  if (!s) return null;
  // Tài khoản có thể đã bị khoá SAU khi token được cấp -> kiểm tra lại ở DB.
  const acc = await one<{ disabled: boolean; role_id: string }>("accounts", {
    select: "disabled,role_id", filter: { email_lc: "eq." + s.email.toLowerCase() },
  });
  if (!acc || acc.disabled) return null;
  return { ...s, roleId: acc.role_id };   // vai trò lấy từ DB, không tin token
}

const permCache = new Map<string, { at: number; set: Set<string> }>();
const PERM_TTL = 60_000;

/** Xoá cache quyền — gọi ngay sau khi admin lưu ma trận, để quyền mới có hiệu lực tức thì
 *  thay vì chờ hết 60s. (Cache theo tiến trình; Vercel có nhiều instance nên instance khác
 *  vẫn chờ TTL — chấp nhận được với cấu hình đổi vài lần/tháng.) */
export function invalidatePermCache(): void {
  permCache.clear();
}

/** Vai trò này có được làm `action` trên `module` không?
 *  Cấp MODULE = có ÍT NHẤT 1 chức năng con (sub) bật `action` — khớp hệt hàm
 *  can() trong src/lib/rbac.ts, để server và client không bao giờ lệch nhau. */
export async function can(roleId: string, module: string, action: string): Promise<boolean> {
  if (roleId === "admin") return true;
  const c = permCache.get(roleId);
  let set: Set<string>;
  if (c && Date.now() - c.at < PERM_TTL) {
    set = c.set;
  } else {
    const rows = await select<{ module: string; action: string }>("role_permissions", {
      select: "module,action", filter: { role_id: "eq." + roleId, allowed: "is.true" },
    });
    set = new Set(rows.map((r) => r.module + ":" + r.action));
    permCache.set(roleId, { at: Date.now(), set });
  }
  return set.has(module + ":" + action);
}

/** Cổng chuẩn cho mọi endpoint: trả về actor hoặc Response lỗi để `return` luôn. */
export async function guard(
  req: Request, module: string, action: string,
): Promise<{ actor: Actor } | { deny: Response }> {
  const a = await actorOf(req);
  if (!a) {
    return { deny: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "content-type": "application/json; charset=utf-8" } }) };
  }
  if (!(await can(a.roleId, module, action))) {
    return { deny: new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { "content-type": "application/json; charset=utf-8" } }) };
  }
  return { actor: a };
}

/** Cập nhật mốc đăng nhập gần nhất (không chặn phản hồi nếu lỗi). */
export function markLogin(email: string): void {
  update("accounts", { email_lc: "eq." + email.toLowerCase() }, { last_login: new Date().toISOString() })
    .catch(() => {});
}
