/* Hook dùng chung cho tính năng "trả lời / trích đoạn" trong mọi mục chat. */
import { useState } from "react";
import type React from "react";

export interface ReplyTo { role: "user" | "assistant"; text: string }

export function useReply() {
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);

  /** Trích 1 tin (hoặc đoạn đang bôi đen trong tin đó — tin phải có thuộc tính data-msg). */
  function quote(content: string, role: "user" | "assistant", e: React.MouseEvent) {
    const sel = window.getSelection();
    const box = (e.currentTarget as HTMLElement).closest("[data-msg]");
    let text = "";
    if (sel && !sel.isCollapsed && box && box.contains(sel.anchorNode)) text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) text = (content || "").replace(/\s+/g, " ").trim();
    if (text.length > 180) text = text.slice(0, 178) + "…";
    setReplyTo({ role, text });
  }

  return { replyTo, setReplyTo, quote };
}

/** Gộp đoạn trích vào câu hỏi gửi cho AI (để model biết đang hỏi về đoạn nào). */
export const foldQuote = (q: string, r: ReplyTo | null) =>
  r ? `[Tôi đang hỏi về đoạn này: "${r.text}"]\n${q}` : q;
