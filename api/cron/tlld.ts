/* ============================================================
   LỊCH TỰ ĐỘNG: kéo TLLD từ Data API (Trino) về Supabase.

   GET /api/cron/tlld                      -> nạp NGÀY HÔM QUA
   GET /api/cron/tlld?tu=...&den=...       -> nạp một khoảng (dùng để nạp lịch sử)
   Bắt buộc: Authorization: Bearer CRON_SECRET

   VÌ SAO KÉO VỀ CHỨ KHÔNG ĐỂ BÊN KIA ĐẨY SANG: ghi vào Supabase cần khoá
   service_role, mà khoá đó đi xuyên toàn bộ phân quyền — đọc ghi được mọi bảng
   trong schema m12, kể cả bảng tài khoản. Kéo về thì khoá nằm nguyên trong
   Vercel, không giao cho hệ thống nào khác giữ. Kéo cũng chủ động hơn: chạy lại
   được khi lỗi, biết lần cuối chạy lúc nào.

   Biến môi trường:
     CRON_SECRET      Vercel tự sinh khi khai báo crons
     DATA_API_TOKEN   token Bearer của Data API — NHẬP TAY trên Vercel
   ============================================================ */
import { json } from "./../_lib/supabase";
import { layTlld, type TlldRow } from "./../_lib/tlldQuery";

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
    thu_tu: soHoacNull(r.thu_tu) ?? 0,
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

export default async function handler(req: Request): Promise<Response> {
  const env = (globalThis as any).process?.env || {};

  const secret = env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) return json({ error: "unauthorized" }, 401);

  const token = env.DATA_API_TOKEN;
  if (!token) return json({ error: "thieu_DATA_API_TOKEN" }, 500);

  // Mặc định: hôm qua. TLLD là số của ngày N-1, chạy sáng sớm là vừa.
  const u = new URL(req.url);
  const homQua = new Date(Date.now() - 86_400_000);
  const tu = u.searchParams.get("tu") || ngayISO(homQua);
  const den = u.searchParams.get("den") || ngayISO(new Date(Date.parse(tu) + 86_400_000));

  const batDau = Date.now();
  try {
    const rows = await layTlld(token, tu, den);
    if (!rows.length) {
      return json({ ok: true, tu, den, doc: 0, ghi: 0, note: "khong_co_du_lieu" });
    }
    const soGhi = await ghi(rows.map(sangDongDb), env);

    // Vài con số để nhìn log là biết chạy có ra hồn không.
    const chuyen = new Set(rows.map((r) => r.ma_chuyen)).size;
    const thieuMaTuyen = rows.filter((r) => !r.ma_tuyen).length;
    return json({
      ok: true, tu, den,
      doc: rows.length, ghi: soGhi, so_chuyen: chuyen,
      thieu_ma_tuyen: thieuMaTuyen,
      giay: Math.round((Date.now() - batDau) / 1000),
    });
  } catch (e: any) {
    return json({ error: "loi_nap_tlld", detail: String(e?.message || e), tu, den }, 500);
  }
}
