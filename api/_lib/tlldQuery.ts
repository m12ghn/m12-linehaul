/* ============================================================
   TLLD — CÂU TRUY VẤN + CLIENT GỌI DATA API.

   ĐÂY LÀ BẢN DUY NHẤT của câu SQL. Trước có thêm scripts/tlld.sql, nhưng giữ
   hai bản là sớm muộn lệch nhau mà không ai biết — đúng cái rủi ro mình đã né
   khi quyết không nhân bản danh sách biển số ra bảng cấu hình riêng.

   Nguồn: "ghn-reporting"."fa"."dtm_logistics_trip_detail" qua Data API (Trino).
     POST /api/v1/queries              { sql }  -> { queryId, rows, schema, hasMore }
     GET  /api/v1/queries/{id}/next             -> batch kế tiếp

   Biến môi trường:
     DATA_API_TOKEN   Bearer token (Vercel → Settings → Environment Variables)
     DATA_API_BASE    mặc định https://data-api-provider.ghn.vn
   ============================================================ */

const BASE = () =>
  (globalThis as any).process?.env?.DATA_API_BASE || "https://data-api-provider.ghn.vn";

/** 5 kho của cụm M12 — khớp đúng 5 tab TLLD trong workbook cũ. */
export const M12_WAREHOUSE_IDS = [2388, 1626, 22883000, 22957000, 21606000];

/* ------------------------------------------------------------------
   Câu SQL. Bản ghép của hai câu đang dùng:
     • KHUNG lấy từ bản v2      — chọn ngày, lọc kho, lấy mã tuyến.
     • PHẦN TÍNH lấy từ bản production — bậc van/special, carry-forward,
       công tắc Xuất/Nhập, đúng tên cột nguồn.
   ------------------------------------------------------------------ */
export function tlldSql(tuNgay: string, denNgay: string): string {
  ngayHopLe(tuNgay);
  ngayHopLe(denNgay);
  return `
WITH
-- Chọn chuyến theo date(first_check_in), KHÔNG theo load_date.
-- load_date là ngày bản ghi được chạm lần cuối, không phải ngày chuyến chạy —
-- đã kiểm chứng: chuyến E2608231HDJ88WW chạy 23/08 nhưng load_date ghi 30/08.
--
-- KHÔNG đổi múi giờ, và đây là chủ ý: tài liệu Data API nội bộ ghi rõ mốc thời
-- gian bên này "nhãn Z nhưng đã là giờ VN" (khác TruckAir MCP — bên đó UTC thật).
-- Thêm AT TIME ZONE vào là lệch đi 7 tiếng theo chiều ngược lại.
qualifying_trips AS (
  SELECT DISTINCT code
  FROM "ghn-reporting"."fa"."dtm_logistics_trip_detail"
  WHERE date(first_check_in) >= DATE '${tuNgay}'
    AND date(first_check_in) <  DATE '${denNgay}'
    AND warehouse_id IN (${M12_WAREHOUSE_IDS.join(", ")})
),

-- Hai danh sách biển số được cấu hình riêng. Bậc của chúng tra theo BIỂN SỐ chứ
-- không theo tải trọng, nên phải xét TRƯỚC mọi bậc tải trọng.
special_plates AS (
  SELECT number_plate FROM (VALUES
    ('50H00227'), ('50H00266'), ('50H00486'), ('50H00542'), ('50H00611'),
    ('50H00431'), ('29H22641'), ('50H00243'), ('50H00265'), ('50H00444'),
    ('29H22574'), ('50H00572'), ('29H22117'), ('29H22418'), ('29H22530'),
    ('51D60473'), ('51D60463'), ('51D60461'), ('51D60070'), ('50H00283'),
    ('50H00279'), ('50H00254'), ('50H00239'), ('50H00219'), ('50H00216'),
    ('50H00256'), ('50H00297'), ('50H00629'), ('50H00615'), ('51D60168')
  ) AS t(number_plate)
),
van_plates AS (
  SELECT number_plate FROM (VALUES
    ('50E18532'), ('50E18805'), ('50E19042'), ('50E19240'), ('50E19509'),
    ('50E19675'), ('50E20314'), ('50E20329'), ('50H49500'), ('50H55421'),
    ('50H55573'), ('50H71661'), ('50H79285'), ('50H79844'), ('50H80163'),
    ('50H80225'), ('50H80662'), ('50H80918'), ('50H92863'), ('50H93136'),
    ('50H93190'), ('50H93243'), ('50H93292'), ('50H93337'), ('50H93394'),
    ('50H93542'), ('50H93574'), ('50H93585'), ('50H93629'), ('50H93701'),
    ('50H93783'), ('50H93901'), ('50H93902'), ('50H94013'), ('50H94048'),
    ('50H94184'), ('50H94212'), ('50H94453'), ('50H94497'), ('50H94603')
  ) AS t(number_plate)
),

-- Lấy LẠI TOÀN BỘ điểm dừng của các chuyến đã chọn — KHÔNG lọc kho ở đây.
-- Một chuyến có thể ghé kho ngoài 5 kho trên; thiếu điểm là LAG() lệch và tỷ lệ
-- cả chuyến sai. Lọc ở qualifying_trips là đủ.
stops AS (
  SELECT
    t.code, t.first_check_in, t.hub, t.scheduler_name, t.number_plate,
    t.partner_code, t.partner_type,
    CAST(t.truck_capacity_weight AS DOUBLE) AS truck_capacity_weight,
    t.actual_sort_number,
    t.stoppoint_name, t.warehouse_id, t.warehouse_type, t.est_distance,
    t.total_weight_converted_new AS w_on_truck,
    t.volume_ordercode           AS q_on_truck,
    t.volume_ordercode_picked,
    (sp.number_plate IS NOT NULL) AS is_special,
    (vp.number_plate IS NOT NULL) AS is_van
  FROM "ghn-reporting"."fa"."dtm_logistics_trip_detail" t
  INNER JOIN qualifying_trips q ON q.code = t.code
  LEFT  JOIN special_plates  sp ON t.number_plate = sp.number_plate
  LEFT  JOIN van_plates      vp ON UPPER(t.number_plate) = UPPER(vp.number_plate)
),

legs AS (
  SELECT *,
    LAG(stoppoint_name)  OVER (PARTITION BY code ORDER BY actual_sort_number) AS kho_truoc_do,
    LEAD(stoppoint_name) OVER (PARTITION BY code ORDER BY actual_sort_number) AS kho_tiep_theo,
    COUNT(*)             OVER (PARTITION BY code) AS so_diem_dung,
    LAG(w_on_truck)      OVER (PARTITION BY code ORDER BY actual_sort_number) AS w_leg,
    LAG(q_on_truck)      OVER (PARTITION BY code ORDER BY actual_sort_number) AS q_leg,

    -- CARRY-FORWARD: lấy số điểm liền trước; nếu điểm đó ghi 0 thì LÙI TIẾP tìm
    -- giá trị khác 0 gần nhất. Điểm ghé ngang không ghi nhận gì sẽ trả 0, mà
    -- LAG() thuần lấy đúng số 0 đó -> xe trông như đang chạy rỗng.
    COALESCE(
      NULLIF(LAG(w_on_truck) OVER (PARTITION BY code ORDER BY actual_sort_number), 0),
      LAST_VALUE(NULLIF(w_on_truck, 0)) OVER (
        PARTITION BY code ORDER BY actual_sort_number
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
      0
    ) AS w_before,
    COALESCE(
      NULLIF(LAG(q_on_truck) OVER (PARTITION BY code ORDER BY actual_sort_number), 0),
      LAST_VALUE(NULLIF(q_on_truck, 0)) OVER (
        PARTITION BY code ORDER BY actual_sort_number
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
      0
    ) AS q_before,

    -- Bảng cấu hình xe tải, ĐỦ 9 bậc. Thứ tự quan trọng: biển số trước, tải trọng sau.
    CASE
      WHEN is_van     THEN  900.0
      WHEN is_special THEN 6100.0
      WHEN truck_capacity_weight <=  1400 THEN  1000.0
      WHEN truck_capacity_weight <=  2500 THEN  1700.0
      WHEN truck_capacity_weight <=  3500 THEN  2500.0
      WHEN truck_capacity_weight <=  5000 THEN  3400.0
      WHEN truck_capacity_weight <=  6500 THEN  4750.0
      WHEN truck_capacity_weight <= 16000 THEN  7100.0
      ELSE 11200.0
    END AS std_weight,
    CASE
      WHEN is_van     THEN  900.0
      WHEN is_special THEN 2550.0
      WHEN truck_capacity_weight <=  1400 THEN   420.0
      WHEN truck_capacity_weight <=  2500 THEN   710.0
      WHEN truck_capacity_weight <=  3500 THEN  1050.0
      WHEN truck_capacity_weight <=  5000 THEN  1420.0
      WHEN truck_capacity_weight <=  6500 THEN  1980.0
      WHEN truck_capacity_weight <= 16000 THEN  3000.0
      ELSE 4670.0
    END AS std_orders
  FROM stops
),

-- Tỷ lệ CẢ CHUYẾN — bình quân theo quãng đường.
-- ⚠ LỆCH VỚI TÀI LIỆU, CỐ Ý GIỮ NGUYÊN: tài liệu ghi L = L1 + ... + L(n-1),
--   còn đây cộng cả n chặng (SUM(est_distance) trên mọi dòng), làm mẫu số hơi
--   phình và tỷ lệ hơi thấp. Giữ y như bản đang chạy để số KHỚP báo cáo chính thức.
--   Muốn theo đúng tài liệu thì đổi mẫu số thành
--     SUM(CASE WHEN w_leg IS NOT NULL THEN est_distance END)
--   nhưng phải báo bên báo cáo trước, vì mọi con số sẽ nhích lên.
trip_agg AS (
  SELECT code,
    SUM(est_distance * w_leg) / NULLIF(SUM(est_distance), 0) AS w_avg,
    SUM(est_distance * q_leg) / NULLIF(SUM(est_distance), 0) AS q_avg,
    SUM(est_distance) AS tong_quang_duong,
    MAX(std_weight) AS std_weight,
    MAX(std_orders) AS std_orders
  FROM legs GROUP BY code
),

-- Mã tuyến nằm ở bảng khác. Gom về 1 dòng/chuyến bằng arbitrary() thay vì
-- DISTINCT: nếu một chuyến lỡ có 2 route_code thì DISTINCT sẽ NHÂN ĐÔI mọi điểm
-- dừng của chuyến đó — xem báo cáo bằng mắt thì khó thấy, nạp vào database là vỡ khoá.
route_of_trip AS (
  SELECT code, arbitrary(route_code) AS route_code
  FROM "ghn-reporting"."fa"."dtm_logistics_trip_filledrate"
  GROUP BY code
)

SELECT
  CAST(date(l.first_check_in) AS VARCHAR) AS ngay,
  l.code                          AS ma_chuyen,
  r.route_code                    AS ma_tuyen,
  CASE WHEN l.scheduler_name IS NULL OR trim(l.scheduler_name) = ''
       THEN 'Tăng cường' ELSE 'Cố định' END AS loai_lich,
  CASE WHEN l.volume_ordercode_picked > 0 THEN 'Xuất' ELSE 'Nhập' END AS loai_tai,
  l.hub,
  l.number_plate                  AS bien_so,
  l.partner_code,
  l.partner_type,
  l.truck_capacity_weight         AS tai_trong_xe,
  l.is_van,
  l.is_special,
  l.std_weight                    AS ky_tieu_chuan,
  l.std_orders                    AS don_tieu_chuan,
  l.actual_sort_number            AS thu_tu,
  l.so_diem_dung,
  l.stoppoint_name                AS kho,
  CAST(l.warehouse_id AS VARCHAR) AS warehouse_ext_id,
  l.warehouse_type,
  l.kho_truoc_do,
  l.kho_tiep_theo,
  l.est_distance                  AS quang_duong_den_diem,
  ta.tong_quang_duong,
  CASE WHEN l.volume_ordercode_picked > 0 THEN l.w_on_truck ELSE l.w_before END AS khoiluong_kg,
  CASE WHEN l.volume_ordercode_picked > 0 THEN l.q_on_truck ELSE l.q_before END AS so_don_hang,
  -- Trả về TỶ LỆ (0..n), không phải %. Vượt 1.0 là bình thường.
  (CASE WHEN l.volume_ordercode_picked > 0 THEN l.w_on_truck ELSE l.w_before END)
    / NULLIF(l.std_weight, 0) AS tlld_weight_diem,
  (CASE WHEN l.volume_ordercode_picked > 0 THEN l.q_on_truck ELSE l.q_before END)
    / NULLIF(l.std_orders, 0) AS tlld_vol_diem,
  ta.w_avg / NULLIF(ta.std_weight, 0) AS tlld_weight_chuyen,
  ta.q_avg / NULLIF(ta.std_orders, 0) AS tlld_vol_chuyen
FROM legs l
JOIN trip_agg ta      ON ta.code = l.code
LEFT JOIN route_of_trip r ON r.code = l.code
-- Thứ tự ổn định: phân trang qua /next mà thứ tự nhảy là lấy trùng hoặc sót dòng.
ORDER BY l.code, l.actual_sort_number
`.trim();
}

/** Chặn ngày lạ trước khi ghép vào SQL — không nhận gì ngoài YYYY-MM-DD. */
function ngayHopLe(s: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("ngay_khong_hop_le:" + s);
}

export interface TlldRow {
  ngay: string; ma_chuyen: string; ma_tuyen: string | null;
  loai_lich: string | null; loai_tai: string | null; hub: string | null;
  bien_so: string | null; partner_code: string | null; partner_type: string | null;
  tai_trong_xe: number | null; is_van: boolean; is_special: boolean;
  ky_tieu_chuan: number | null; don_tieu_chuan: number | null;
  thu_tu: number; so_diem_dung: number | null; kho: string | null;
  warehouse_ext_id: string | null; warehouse_type: string | null;
  kho_truoc_do: string | null; kho_tiep_theo: string | null;
  quang_duong_den_diem: number | null; tong_quang_duong: number | null;
  khoiluong_kg: number | null; so_don_hang: number | null;
  tlld_weight_diem: number | null; tlld_vol_diem: number | null;
  tlld_weight_chuyen: number | null; tlld_vol_chuyen: number | null;
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KetQuaTlld {
  rows: TlldRow[];
  /** Số lần POST /queries còn lại trong ngày, đọc từ header X-Quota-Remaining. */
  quotaConLai: number | null;
  soLanPoll: number;
}

/* ------------------------------------------------------------------
   Gọi Data API theo đúng luật trong tài liệu nội bộ (GHN Data API guide):

     • POST /queries chỉ trả queryId, rows thường RỖNG. Dữ liệu lấy qua /next.
     • Tín hiệu lặp là `hasMore`, KHÔNG phải `status`.
     • rows rỗng + hasMore -> query ĐANG TÍNH, chờ ~10s rồi mới hỏi tiếp.
       Hỏi dồn thì ăn 429/409 chứ không nhanh hơn.
     • 503 pod_busy / 409 conflict -> thử lại ĐÚNG cái /next đó, backoff
       100→200→400ms. An toàn vì /next lỗi không nhích con trỏ, không sót
       không trùng dòng.
     • 410 query_expired -> dừng lâu quá, phải gửi lại từ đầu.
     • QUOTA tính theo số POST /queries mỗi ngày (mặc định 200, có token bị đặt
       xuống 50), reset 00:00 UTC. /next KHÔNG tốn quota -> gom nhiều ngày vào
       MỘT lời gọi luôn rẻ hơn chia nhỏ.
   ------------------------------------------------------------------ */
export async function layTlld(token: string, tuNgay: string, denNgay: string): Promise<KetQuaTlld> {
  const H = { authorization: "Bearer " + token, "content-type": "application/json" };
  let quotaConLai: number | null = null;

  const post = async (): Promise<any> => {
    const r = await fetch(BASE() + "/api/v1/queries", {
      method: "POST", headers: H,
      // JSON.stringify tự escape dấu " trong SQL (catalog "ghn-reporting") —
      // đây là chỗ tài liệu cảnh báo hay hỏng nếu tự ghép chuỗi.
      body: JSON.stringify({ sql: tlldSql(tuNgay, denNgay) }),
    });
    const q = r.headers.get("x-quota-remaining");
    if (q !== null && q !== "") quotaConLai = Number(q);
    const txt = await r.text();
    if (!r.ok) throw new Error(`data_api_${r.status}: ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : {};
  };

  /** Một lần /next, có thử lại cho lỗi tạm. Trả null nếu hết đường. */
  const next = async (qid: string): Promise<any> => {
    let cho = 100;
    for (let lan = 0; lan < 4; lan++) {
      const r = await fetch(`${BASE()}/api/v1/queries/${encodeURIComponent(qid)}/next`, { headers: H });
      if (r.ok) {
        const txt = await r.text();
        return txt ? JSON.parse(txt) : {};
      }
      const txt = (await r.text()).slice(0, 300);
      // Lỗi tạm -> thử lại đúng cái /next này.
      if (r.status === 503 || r.status === 409) {
        await ngu(cho); cho *= 2; continue;
      }
      if (r.status === 410) throw new Error(`data_api_410_query_het_han: ${txt}`);
      throw new Error(`data_api_${r.status}: ${txt}`);
    }
    throw new Error("data_api_503_thu_lai_4_lan_van_ban");
  };

  let res = await post();
  const qid: string = res.queryId;
  const cols: string[] = (res.schema || []).map((c: any) => (typeof c === "string" ? c : c?.name));
  const gom: any[] = [...(res.rows || [])];

  let soLanPoll = 0;
  while (res.hasMore && qid && soLanPoll < 2000) {
    // Chưa có dòng nào mà vẫn hasMore = kho đang tính. Chờ hẳn 10 giây theo
    // tài liệu; hỏi dồn chỉ tốn rate-limit chứ không làm nó xong nhanh hơn.
    const dangTinh = !(res.rows || []).length;
    await ngu(dangTinh ? 10_000 : 150);
    soLanPoll++;
    res = await next(qid);
    gom.push(...(res.rows || []));
  }

  // API có thể trả mảng theo thứ tự cột, hoặc trả sẵn object — chịu cả hai.
  const rows = gom.map((r: any) =>
    Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r
  ) as TlldRow[];

  return { rows, quotaConLai, soLanPoll };
}
