/* ============================================================
   BẢN CHỐT TỔNG QUAN MỖI NGÀY 10H — port từ functions/api/overview.ts (KV "ovsnap:<date>").
   POST { action:"get" }                          -> { snap, today }
   POST { action:"save", refDate, stat, alerts }  -> { snap }

   Giữ nguyên luật cũ: chỉ chốt TỪ 10h sáng giờ VN; đã chốt rồi thì giữ nguyên cả ngày
   để mọi người nhìn cùng một bản số liệu khi ra quyết định.
   ============================================================ */
import { one, insert, json } from "./_lib/supabase";
import { getSession } from "./_lib/session";

export const config = { runtime: "edge" };

/** Ngày & giờ hiện tại theo giờ VN (UTC+7) — bản sao hàm vnNow() của functions cũ. */
function vnNow(): { date: string; hour: number } {
  const v = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: v.toISOString().slice(0, 10), hour: v.getUTCHours() };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const b: any = await req.json().catch(() => ({}));
    const { date: today, hour } = vnNow();

    const load = () => one<any>("overview_snapshots", {
      select: "ngay,ref_date,stat,alerts,created_at", filter: { ngay: "eq." + today },
    });

    if (String(b?.action || "get") === "get") {
      return json({ ok: true, snap: await load(), today });
    }

    // Ghi cần đăng nhập (bất kỳ vai trò nào) — bản chốt do client tính từ dữ liệu thật.
    if (!(await getSession(req))) return json({ error: "unauthorized" }, 401);

    if (hour < 10) return json({ ok: true, snap: null, today, note: "chua_toi_10h" });
    const existing = await load();
    if (existing) return json({ ok: true, snap: existing, today });   // đã chốt -> giữ nguyên

    const [snap] = await insert<any>("overview_snapshots", {
      ngay: today,
      ref_date: b?.refDate || null,
      stat: b?.stat ?? {},
      alerts: b?.alerts ?? [],
    });
    return json({ ok: true, snap, today });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
