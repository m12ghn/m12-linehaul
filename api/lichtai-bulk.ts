/* ============================================================
   LỊCH TẢI — TẢI LÊN HÀNG LOẠT (bulk upload), thêm 03/09/2026 theo yêu cầu Sếp.

   POST /api/lichtai-bulk   (JSON, CHỈ vai trò admin — xem lý do bên dưới)
     { region, routes: [{ code, category?, load?, ncc?, bks?,
                           stops?: [{ kho, loaiHinh?, toi?, roi? }, ...] }, ...] }
   ->  { ok, total, success, failed,
         results: [{ code, status: "created"|"updated"|"error", error?, stops? }, ...] }

   TÁCH RIÊNG khỏi api/lichtai.ts (không chỉ thêm 1 action nữa) vì 2 lý do:
   1. Runtime: đây là Node Function (maxDuration 300s), không phải Edge (~25s) —
      1 lượt tải có thể ghi hàng trăm tuyến (vùng lớn nhất hiện có, Nội Thành HCM,
      có 440 tuyến/1267 điểm dừng — xem cron TLLD api/cron/tlld.ts, cùng lý do).
      api/lichtai.ts vẫn Edge vì các thao tác sửa-1-dòng ở đó cần độ trễ thấp.
   2. Quyền: BẮT BUỘC admin (roleId === "admin", GIỐNG HỆT useAdmin() ở frontend),
      SIẾT HƠN quyền RBAC "lich-tai:edit" thường (vốn có thể cấp cho nhiều vai trò
      như deputy/manager) — vì đây là thao tác GHI ĐÈ nhiều tuyến cùng lúc, KHÔNG
      qua rev-check như sửa từng dòng. Quyết định Sếp chọn 03/09 qua AskUserQuestion.

   Với tuyến ĐÃ CÓ (trùng mã trong vùng): THAY THẾ TOÀN BỘ điểm dừng cũ bằng danh
   sách mới trong file (xoá hết rồi ghi lại) — cũng là quyết định Sếp chọn 03/09,
   đúng cách scripts/import-sheets.mjs đang làm khi nạp lại 1 vùng. KHÔNG dùng
   rev-check (không có ý nghĩa khi Sếp chủ động tải cả file lên).

   Xử lý TỪNG TUYẾN độc lập (không phải 1 giao dịch chung) — 1 tuyến lỗi không
   chặn các tuyến khác, để báo cáo "thành công X / thất bại Y" đúng nghĩa. Chạy
   song song có giới hạn (8 luồng) để không vượt trần thời gian với vùng lớn.
   ============================================================ */
import { select, insert, update, remove, json, SupabaseError } from "./_lib/supabase";
import { guard } from "./_lib/session";
import { BadInput, routePatch, stopPatch } from "./_lib/lichtaiValidate";

export const config = { runtime: "nodejs", maxDuration: 300 };

const MODULE = "lich-tai";
// Vùng lớn nhất hiện có (Nội Thành HCM) có 440 tuyến — 500 chừa dư, đủ an toàn
// cho thời gian chạy (Node 300s) mà vẫn chặn được file bất thường/gửi nhầm.
const MAX_ROUTES = 500;

interface BulkStopIn { kho?: string; loaiHinh?: string; toi?: string; roi?: string; }
interface BulkRouteIn { code?: string; category?: string; load?: string; ncc?: string; bks?: string; stops?: BulkStopIn[]; }
interface RouteResult { code: string; status: "created" | "updated" | "error"; error?: string; stops?: number; }

/** Chạy `fn` cho từng phần tử của `items`, tối đa `limit` lượt SONG SONG cùng lúc —
 *  giữ đúng THỨ TỰ kết quả theo thứ tự vào (không dùng Promise.all thẳng vì cần
 *  giới hạn số luồng, tránh dội quá nhiều request cùng lúc vào PostgREST). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function errText(e: any): string {
  if (e instanceof BadInput) {
    if (e.code === "route_unnamed") return "Thiếu Tên tuyến";
    return `Giá trị không hợp lệ ở cột "${e.field}"`;
  }
  if (e instanceof SupabaseError) {
    return e.body.includes("23505") ? "Mã tuyến bị trùng" : "Lỗi cơ sở dữ liệu";
  }
  return String(e?.message || e);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const g = await guard(req, MODULE, "edit");
    if ("deny" in g) return g.deny;
    if (g.actor.roleId !== "admin") return json({ error: "forbidden" }, 403);
    const actorEmail = g.actor.email;

    const body = await req.json().catch(() => ({}));
    const region = String(body?.region || "").trim();
    if (!region) return json({ error: "bad_request", detail: "missing region" }, 400);
    const input: BulkRouteIn[] = Array.isArray(body?.routes) ? body.routes : [];
    if (!input.length) return json({ error: "bad_request", detail: "empty routes" }, 400);
    if (input.length > MAX_ROUTES) {
      return json({
        error: "too_many_routes",
        detail: `Tối đa ${MAX_ROUTES} tuyến/lượt tải lên, file có ${input.length} tuyến — chia nhỏ file rồi tải lại.`,
      }, 400);
    }

    // Đọc TOÀN BỘ mã tuyến đang có của vùng 1 LẦN (không phải hỏi riêng từng tuyến) —
    // đúng cách scripts/import-sheets.mjs đang làm, region hiện lớn nhất chỉ ~440 tuyến.
    // CỐ Ý KHÔNG lọc active=true: tuyến đã bị xoá MỀM (route.delete, xem api/lichtai.ts)
    // vẫn còn giữ mã trong khoá duy nhất (region_key,code) — nếu Sếp tải lên lại đúng mã
    // đó, phải khớp vào dòng CŨ (update + active:true bên dưới) chứ không phải insert mới
    // (sẽ vỡ khoá duy nhất, báo lỗi trùng mã sai ý).
    const existing = await select<{ id: string; code: string }>("routes", {
      select: "id,code", filter: { region_key: "eq." + region }, limit: 5000,
    });
    const idByCode = new Map(existing.map((r) => [r.code, r.id]));

    const results = await mapLimit(input, 8, async (r): Promise<RouteResult> => {
      const codeRaw = String(r.code || "").trim() || "(chưa đặt mã)";
      try {
        const patch = routePatch(r);
        const stopsIn = Array.isArray(r.stops) ? r.stops : [];
        // routePatch/stopPatch NÉM LỖI ngay nếu có ô sai -> validate hết TRƯỚC khi ghi
        // gì xuống DB, tuyến này không bị ghi dở dang nửa chừng.
        const validStops = stopsIn.map((s) => stopPatch(s)).filter((s) => s.kho);

        const existId = idByCode.get(patch.code);
        let routeId: string;
        let status: "created" | "updated";
        if (existId) {
          // active:true LUÔN ép — kể cả tuyến ĐÃ bị xoá mềm trước đó, tải lên lại là
          // Sếp muốn tuyến đó HIỆN LẠI trên dashboard (xem comment ở đoạn đọc `existing`).
          await update("routes", { id: "eq." + existId }, { ...patch, active: true, updated_by: actorEmail }, actorEmail);
          routeId = existId;
          status = "updated";
          // Quyết định Sếp 03/09: THAY THẾ TOÀN BỘ điểm dừng cũ, không cộng dồn.
          await remove("stops", { route_id: "eq." + routeId }, actorEmail);
        } else {
          const [row] = await insert<{ id: string }>("routes",
            { ...patch, region_key: region, active: true, created_by: actorEmail, updated_by: actorEmail }, actorEmail);
          routeId = row.id;
          status = "created";
        }
        if (validStops.length) {
          await insert("stops", validStops.map((s, i) => ({ ...s, route_id: routeId, seq: i + 1 })), actorEmail);
        }
        return { code: patch.code, status, stops: validStops.length };
      } catch (e: any) {
        return { code: codeRaw, status: "error", error: errText(e) };
      }
    });

    const success = results.filter((r) => r.status !== "error").length;
    return json({ ok: true, total: results.length, success, failed: results.length - success, results });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
