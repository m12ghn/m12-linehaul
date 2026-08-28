/* Gọi API Hỏi đáp (/api/qa) — Cloudflare Function + KV. Chat qua lại. */
export interface QAReply {
  by: "user" | "admin";
  name: string;
  text: string;
  ts: number;
}
export interface QAItem {
  id: string;
  name: string;
  msg: string;
  ts: number;
  replies: QAReply[];
}
export interface QAData {
  items: QAItem[];
  total: number;
  answered: number;
}

import { adminHeaders } from "./useUser";

const BASE = "/api/qa";

export async function getQA(): Promise<QAData> {
  const r = await fetch(BASE, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export async function submitQA(name: string, msg: string): Promise<void> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, msg }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "HTTP " + r.status);
}

/** Đếm "đã trả lời" = thread đã có ít nhất 1 phản hồi (đồng bộ với backend). */
export function countAnswered(items: QAItem[]): number {
  return items.filter((q) => q.replies.length > 0).length;
}

/** Thêm tin nhắn vào thread. admin (reply vai trò M12SC) -> gửi email @ghn.vn để server xác thực. */
export async function replyQA(
  id: string,
  text: string,
  by: "user" | "admin",
  name: string
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (by === "admin") Object.assign(headers, adminHeaders());
  const r = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "reply", id, text, by, name }),
  });
  if (r.status === 401) throw new Error("Tài khoản chưa có quyền quản trị để trả lời.");
  if (!r.ok) throw new Error("HTTP " + r.status);
}

export async function deleteQA(id: string): Promise<void> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ action: "delete", id }),
  });
  if (r.status === 401) throw new Error("Tài khoản chưa có quyền quản trị để xoá.");
  if (!r.ok) throw new Error("HTTP " + r.status);
}
