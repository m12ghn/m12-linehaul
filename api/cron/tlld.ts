/* ============================================================
   LỊCH TỰ ĐỘNG: kéo TLLD từ Data API (Trino) về Supabase.

   GET /api/cron/tlld                      -> nạp NGÀY HÔM QUA
   GET /api/cron/tlld?tu=...&den=...       -> nạp một khoảng (dùng để nạp lịch sử)
   GET /api/cron/tlld?...&force=1          -> nạp lại kể cả khi đã có dữ liệu
   Bắt buộc: Authorization: Bearer CRON_SECRET

   LỊCH: 01:00 UTC = 08:00 giờ VN. Chọn 8 giờ chứ không phải 7 vì quota Data API
   reset đúng 07:00 giờ VN — chạy lúc 8 giờ là quota vừa đầy lại được một tiếng,
   còn đệm nếu lần đầu lỗi phải chạy lại. TLLD vốn là số của ngày N-1, chốt quanh
   nửa đêm, nên 8 giờ sáng là dư sớm.

   VÌ SAO KÉO VỀ CHỨ KHÔNG ĐỂ BÊN KIA ĐẨY SANG: ghi vào Supabase cần khoá
   service_role, mà khoá đó đi xuyên toàn bộ phân quyền — đọc ghi được mọi bảng
   trong schema m12, kể cả bảng tài khoản. Kéo về thì khoá nằm nguyên trong
   Vercel, không giao cho hệ thống nào khác giữ. Kéo cũng chủ động hơn: chạy lại
   được khi lỗi, biết lần cuối chạy lúc nào.

   Biến môi trường:
     CRON_SECRET      TỰ TẠO trong Settings → Environment Variables (Vercel KHÔNG
                      tự sinh). Vercel lấy giá trị này gắn vào header Authorization
                      khi gọi cron; thiếu thì cron chạy nhưng luôn bị trả 401.
     DATA_API_TOKEN   token Bearer của Data API — NHẬP TAY trên Vercel
   ============================================================ */
// ⚠ PHẢI ghi đuôi .js — đây là file DUY NHẤT trong api/ chạy trên Node runtime.
// Node chạy ESM ("type":"module" trong package.json) bắt buộc đường dẫn có đuôi;
// còn Edge thì gói mọi thứ vào một bundle nên viết thiếu đuôi vẫn chạy. Các file
// khác trong api/ đều là Edge nên chúng viết không đuôi — đừng thấy vậy mà bỏ đi.
// Viết .js chứ không phải .ts vì đây là tên file SAU KHI biên dịch.
// Bỏ đuôi ra là chết ngay lúc gọi: ERR_MODULE_NOT_FOUND -> FUNCTION_INVOCATION_FAILED
// (đã dính thật, lần chạy thử đầu tiên).
import { select } from "./../_lib/supabase.js";
import { layTlld, chayQuery, khoSql, M12_WAREHOUSE_IDS, type TlldRow } from "./../_lib/tlldQuery.js";

// CHẠY TRÊN NODE, KHÔNG PHẢI EDGE — và đây là chỗ dễ vấp:
// Edge runtime chỉ cho ~25 giây rồi cắt. Một câu Trino quét một ngày mất
// 30–90 giây là bình thường, nên để Edge là lần chạy đầu tiên đã đứt.
// Các endpoint khác trong dự án để Edge vì chúng chỉ đọc Supabase (vài trăm ms).
// maxDuration 300 giây là mức gói Vercel Pro cho phép.
export const config = { runtime: "nodejs", maxDuration: 300 };

/** Ghi theo lô. Lô nhỏ hơn ETL thường (500) vì mỗi dòng TLLD có thêm cột raw. */
const LO = 300;

const soHoacNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 1 dòng Data API -> 1 dòng m12.tlld_daily. Giữ nguyên bản gốc vào cột raw. */
function sangDongDb(r: TlldRow): Record<string, unknown> {
  return {
    ngay: r.ngay,
    ma_chuyen: r.ma_chuyen,
    // SQL đã COALESCE(actual_sort_number, sort_number). Tới đây mà vẫn null thì
    // là nguồn thiếu thật — vẫn phải có giá trị vì đây là khoá, nhưng dùng -1 để
    // phân biệt với điểm số 0 hợp lệ, nhìn vào bảng là biết ngay chỗ cần soi.
    thu_tu: soHoacNull(r.thu_tu) ?? -1,
    ma_tuyen: r.ma_tuyen || null,
    loai_lich: r.loai_lich || null,
    loai_tai: r.loai_tai || null,
    hub: r.hub || null,
    // Nguồn có chỗ ghi biển số kèm gạch dưới ở đầu ('_50H12311') — cắt cho khớp
    // với cleanBks() bên giao diện, không thì tra xe theo biển số sẽ trượt.
    bien_so: (r.bien_so || "").replace(/^[_\s]+/, "").toUpperCase() || null,
    partner_code: r.partner_code || null,
    partner_type: r.partner_type || null,
    tai_trong_xe: soHoacNull(r.tai_trong_xe),
    is_van: !!r.is_van,
    is_special: !!r.is_special,
    ky_tieu_chuan: soHoacNull(r.ky_tieu_chuan),
    don_tieu_chuan: soHoacNull(r.don_tieu_chuan),
    so_diem_dung: soHoacNull(r.so_diem_dung),
    kho: r.kho || null,
    warehouse_ext_id: r.warehouse_ext_id ? String(r.warehouse_ext_id) : null,
    warehouse_type: r.warehouse_type || null,
    kho_truoc_do: r.kho_truoc_do || null,
    kho_tiep_theo: r.kho_tiep_theo || null,
    quang_duong_den_diem: soHoacNull(r.quang_duong_den_diem),
    tong_quang_duong: soHoacNull(r.tong_quang_duong),
    khoiluong_kg: soHoacNull(r.khoiluong_kg),
    so_don_hang: soHoacNull(r.so_don_hang),
    tlld_weight_diem: soHoacNull(r.tlld_weight_diem),
    tlld_vol_diem: soHoacNull(r.tlld_vol_diem),
    tlld_weight_chuyen: soHoacNull(r.tlld_weight_chuyen),
    tlld_vol_chuyen: soHoacNull(r.tlld_vol_chuyen),
    raw: r,
    source: "data-api",
  };
}

/* Gộp các dòng TRÙNG KHOÁ trước khi ghi.
   Postgres không cho một lệnh INSERT ... ON CONFLICT chạm cùng một dòng hai lần:
     21000 ON CONFLICT DO UPDATE command cannot affect row a second time
   Nghĩa là nguồn có thể trả về hai dòng cùng (ngày, mã chuyến, thứ tự điểm).
   Giữ dòng SAU CÙNG và ĐẾM số bị gộp — con số đó trả về trong phản hồi, vì nó
   nói lên giả định "bộ ba này là duy nhất" có đúng hay không. Gộp nhiều là phải
   xem lại khoá của bảng, chứ không phải cứ lặng lẽ bỏ bớt dòng. */
function gopTrung(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; trung: number } {
  const m = new Map<string, Record<string, unknown>>();
  for (const r of rows) m.set(`${r.ngay}|${r.ma_chuyen}|${r.thu_tu}`, r);
  return { rows: [...m.values()], trung: rows.length - m.size };
}

/** Ghi đè theo khoá (ngay, ma_chuyen, thu_tu) -> chạy lại bao nhiêu lần cũng được. */
async function ghi(rows: Record<string, unknown>[], env: any): Promise<number> {
  let xong = 0;
  for (let i = 0; i < rows.length; i += LO) {
    const lo = rows.slice(i, i + LO);
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tlld_daily?on_conflict=${encodeURIComponent("ngay,ma_chuyen,thu_tu")}`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
          "content-type": "application/json",
          "content-profile": env.SUPABASE_SCHEMA || "m12",
          "x-actor": "cron-tlld",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(lo),
      },
    );
    if (!r.ok) throw new Error(`ghi_tlld_${r.status}: ${(await r.text()).slice(0, 300)}`);
    xong += lo.length;
  }
  return xong;
}

const ngayISO = (d: Date) => d.toISOString().slice(0, 10);

/* ⚠ CHỮ KÝ HANDLER KIỂU NODE, KHÔNG PHẢI KIỂU WEB.
   Node runtime của Vercel truyền vào (req, res) kiểu http cũ — KHÔNG phải
   Request/Response chuẩn web như Edge. Viết theo kiểu web thì chết ngay dòng
   đầu: "TypeError: req.headers.get is not a function" -> FUNCTION_INVOCATION_FAILED
   (đã dính thật). Vì vậy file này cũng không dùng được json() của _lib/supabase
   — hàm đó trả về Response, chỉ hợp với Edge. Dùng tra() bên dưới. */
type NodeReq = { url?: string; headers: Record<string, string | string[] | undefined> };
type NodeRes = {
  statusCode: number;
  setHeader(k: string, v: string): void;
  end(body?: string): void;
};

function tra(res: NodeRes, obj: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  const env = (globalThis as any).process?.env || {};

  const secret = env.CRON_SECRET;
  const h = req.headers.authorization;
  const auth = Array.isArray(h) ? h[0] || "" : h || "";
  if (!secret || auth !== "Bearer " + secret) return tra(res, { error: "unauthorized" }, 401);

  const token = env.DATA_API_TOKEN;
  if (!token) return tra(res, { error: "thieu_DATA_API_TOKEN" }, 500);

  // req.url ở Node chỉ có đường dẫn + query, không có host -> phải ghép base giả.
  const u = new URL(req.url || "/", "http://localhost");
  const homQua = new Date(Date.now() - 86_400_000);
  const tu = u.searchParams.get("tu") || ngayISO(homQua);
  const den = u.searchParams.get("den") || ngayISO(new Date(Date.parse(tu) + 86_400_000));
  const force = u.searchParams.get("force") === "1";

  // CHẾ ĐỘ KIỂM TRA KHO: ?che_do=kho — chỉ đọc, KHÔNG ghi gì vào Supabase.
  // Đối chiếu 2 cách lọc (theo warehouse_id vs theo tên kho) xem có ra cùng một
  // tập không, để biết danh sách 5 id có đang bỏ sót kho nào.
  if (u.searchParams.get("che_do") === "kho") {
    try {
      const { rows, quotaConLai } = await chayQuery(token, khoSql(tu, den));
      const thieuId = rows.filter((r: any) => !r.trong_danh_sach_id);
      return tra(res, {
        ok: true, tu, den, che_do: "kho",
        id_dang_dung: M12_WAREHOUSE_IDS,
        so_cap_kho: rows.length,
        canh_bao: thieuId.length
          ? `${thieuId.length} kho khớp TÊN nhưng warehouse_id KHÔNG nằm trong danh sách -> đang bỏ sót`
          : "mọi kho khớp tên đều đã nằm trong danh sách id",
        kho: rows,
        quota_con_lai: quotaConLai,
      });
    } catch (e: any) {
      return tra(res, { error: "loi_kiem_tra_kho", detail: String(e?.message || e) }, 500);
    }
  }

  // ── RÀO TIẾT KIỆM QUOTA ─────────────────────────────────────
  // Đếm trước trong Supabase xem khoảng ngày này đã có dữ liệu chưa. Phép đếm
  // này KHÔNG tốn quota Data API, còn mỗi lần POST /queries thì tốn 1 lượt trên
  // tổng 200/ngày (có token chỉ 50).
  // Gặp dữ liệu đã nạp trong vòng 12 tiếng thì bỏ qua — chặn mấy lần bấm lại,
  // cron chạy trùng, hay chạy nạp lịch sử đè lên khoảng đã xong.
  if (!force) {
    try {
      const daCo = await select<{ ngay: string; updated_at: string }>("tlld_daily", {
        select: "ngay,updated_at",
        filter: { and: `(ngay.gte.${tu},ngay.lt.${den})` },
        order: "updated_at.desc",
        limit: 1,
      });
      const moiNhat = daCo[0]?.updated_at ? Date.parse(daCo[0].updated_at) : 0;
      if (moiNhat && Date.now() - moiNhat < 12 * 3_600_000) {
        return tra(res, {
          ok: true, tu, den, bo_qua: true,
          ly_do: "da_nap_trong_12_gio",
          nap_luc: daCo[0].updated_at,
          goi_y: "thêm &force=1 nếu thật sự muốn nạp lại (tốn 1 lượt quota)",
        });
      }
    } catch {
      // Đếm hỏng thì cứ nạp — thà tốn 1 lượt quota còn hơn bỏ mất một ngày dữ liệu.
    }
  }

  const batDau = Date.now();
  try {
    const { rows, quotaConLai, soLanPoll } = await layTlld(token, tu, den);
    if (!rows.length) {
      return tra(res, { ok: true, tu, den, doc: 0, ghi: 0, quota_con_lai: quotaConLai, note: "khong_co_du_lieu" });
    }
    const { rows: sach, trung } = gopTrung(rows.map(sangDongDb));
    const soGhi = await ghi(sach, env);

    const chuyen = new Set(rows.map((r) => r.ma_chuyen)).size;
    const thieuMaTuyen = rows.filter((r) => !r.ma_tuyen).length;

    // Phân tách theo hub — để đối chiếu thẳng với từng tab TLLD trong workbook cũ.
    // Không có cái này thì chỉ so được con số tổng, mà tổng khớp chưa chắc từng hub khớp.
    const theoHub: Record<string, { diem: number; chuyen: number }> = {};
    const chuyenTheoHub: Record<string, Set<string>> = {};
    for (const r of rows) {
      const k = r.hub || "(trống)";
      (theoHub[k] ||= { diem: 0, chuyen: 0 }).diem++;
      (chuyenTheoHub[k] ||= new Set()).add(r.ma_chuyen);
    }
    for (const k of Object.keys(theoHub)) theoHub[k].chuyen = chuyenTheoHub[k].size;
    return tra(res, {
      ok: true, tu, den,
      doc: rows.length, ghi: soGhi, so_chuyen: chuyen,
      // Số dòng trùng khoá (ngày, mã chuyến, thứ tự điểm) đã bị gộp.
      // Khác 0 nghĩa là khoá của bảng chưa mô tả đúng dữ liệu -> cần xem lại,
      // đừng coi là chuyện bình thường.
      gop_trung: trung,
      theo_hub: theoHub,
      thieu_ma_tuyen: thieuMaTuyen,
      // Quota Data API tính theo số lần POST /queries mỗi ngày (mặc định 200,
      // có token bị đặt xuống 50). Nạp lịch sử mà không nhìn số này là dễ cụt giữa chừng.
      quota_con_lai: quotaConLai,
      so_lan_poll: soLanPoll,
      giay: Math.round((Date.now() - batDau) / 1000),
    });
  } catch (e: any) {
    return tra(res, { error: "loi_nap_tlld", detail: String(e?.message || e), tu, den }, 500);
  }
}
