/* ============================================================
   PHÂN TÍCH TỰ ĐỘNG MỖI NGÀY 09H — port từ functions/api/daily.ts (KV "daily:<id>").
   POST { id, digest, force? } -> { text, at, date, status }

   Luật giữ nguyên bản cũ:
     - Mỗi mục chỉ chạy AI 1 LẦN/NGÀY, kết quả lưu lại để mọi người xem cùng 1 bản.
     - Ai mở đầu tiên SAU 09h mà chưa có bản hôm nay -> tự sinh & lưu.
     - force=true -> phân tích lại ngay (nút "Phân tích lại", cần quyền edit).
   ============================================================ */
import { one, upsert, json } from "./_lib/supabase";
import { guard, getSession } from "./_lib/session";

export const config = { runtime: "edge" };

function vnNow(): { date: string; hour: number } {
  const v = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: v.toISOString().slice(0, 10), hour: v.getUTCHours() };
}

/** Gọi trợ lý để sinh nhận định. Tách riêng -> đổi nhà cung cấp AI chỉ sửa 1 chỗ. */
async function askAssistant(req: Request, digest: string): Promise<string> {
  const r = await fetch(new URL("/api/assistant", req.url).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: req.headers.get("authorization") || "",
    },
    body: JSON.stringify({
      mode: "analyze",
      messages: [{ role: "user", content: digest }],
    }),
  });
  const d: any = await r.json().catch(() => ({}));
  return String(d?.reply || "").trim();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const b: any = await req.json().catch(() => ({}));
    const scope = String(b?.id || "").slice(0, 60).replace(/[^\w.\-:]/g, "");
    if (!scope) return json({ error: "bad_request" }, 400);
    if (!(await getSession(req))) return json({ error: "unauthorized" }, 401);

    const { date, hour } = vnNow();
    const existing = await one<any>("ai_daily", {
      select: "text,created_at,status", filter: { scope: "eq." + scope, ngay: "eq." + date },
    });

    const force = !!b?.force;
    if (existing && !force) {
      return json({ ok: true, text: existing.text, at: Date.parse(existing.created_at), date, status: existing.status });
    }
    if (force) {
      const g = await guard(req, "tong-quan", "edit");
      if ("deny" in g) return g.deny;
    } else if (hour < 9) {
      // Chưa tới giờ chốt và chưa có bản -> KHÔNG tự chạy AI (giữ đúng luật cũ, tiết kiệm lượt).
      return json({ ok: true, text: "", at: null, date, status: "chua_toi_gio" });
    }

    const digest = String(b?.digest || "").slice(0, 30_000);
    if (!digest) return json({ error: "no_digest" }, 400);

    const text = await askAssistant(req, digest);
    if (!text) return json({ ok: true, text: "", at: null, date, status: "ai_loi" });

    await upsert("ai_daily", { scope, ngay: date, text, status: "ok", created_at: new Date().toISOString() },
                 "scope,ngay");
    return json({ ok: true, text, at: Date.now(), date, status: "ok" });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
