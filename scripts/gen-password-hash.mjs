#!/usr/bin/env node
// Tạo pw_salt/pw_hash cho bảng `accounts` — dùng ĐÚNG thuật toán trong api/_lib/session.ts
// (PBKDF2-HMAC-SHA256, 100.000 vòng, salt ngẫu nhiên 16 byte, hash 256-bit, mã hex).
//
// Chạy trên máy của Sếp (KHÔNG chạy trên máy người khác, không paste mật khẩu vào chat):
//   node scripts/gen-password-hash.mjs "MatKhauMoi123"
//
// Script chỉ in ra pw_salt/pw_hash (không lưu gì, không gửi đi đâu) kèm sẵn câu lệnh
// UPDATE để dán thẳng vào Supabase SQL Editor.

import crypto from "node:crypto";

const password = process.argv[2];
const email = process.argv[3] || "admin@ghn.vn";

if (!password) {
  console.error("Dùng: node scripts/gen-password-hash.mjs <mat_khau_moi> [email]");
  process.exit(1);
}
if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Mật khẩu tối thiểu 8 ký tự, phải có cả chữ và số (đúng luật PW_RULE trong api/_lib/session.ts).");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");

const pwSalt = salt.toString("hex");
const pwHash = hash.toString("hex");

console.log("\n-- pw_salt:", pwSalt);
console.log("-- pw_hash:", pwHash);
console.log("\n-- Dán câu lệnh dưới vào Supabase SQL Editor để đặt mật khẩu cho", email, ":\n");
console.log(
  `update accounts set pw_salt = '${pwSalt}', pw_hash = '${pwHash}' where email_lc = lower('${email}');`
);
console.log(
  "\n-- Nếu tài khoản chưa tồn tại, tạo mới trước (role_id: xem bảng roles, ví dụ 'admin'):\n"
);
console.log(
  `insert into accounts (email, name, role_id, pw_salt, pw_hash)\nvalues ('${email}', 'Admin', 'admin', '${pwSalt}', '${pwHash}')\non conflict (email_lc) do update set pw_salt = excluded.pw_salt, pw_hash = excluded.pw_hash;\n`
);
