-- ============================================================
-- TLLD — TỶ LỆ LẤP ĐẦY CHUYẾN, viết theo ĐÚNG tài liệu công thức GHN.
-- Nguồn: "ghn-reporting"."fa"."dtm_logistics_trip_detail" (Trino / Data API).
--
-- Mức chi tiết: MỖI ĐIỂM DỪNG MỘT DÒNG. Từ chi tiết luôn gộp lên được mức chuyến,
-- ngược lại thì không — nên lưu ở mức thấp nhất.
--
-- HAI CHỖ ĐÃ SỬA so với câu dựng lại từ Metabase (cả hai đều làm TLLD THẤP HƠN thực tế):
--
--   (1) MẪU SỐ QUÃNG ĐƯỜNG.
--       Tài liệu: L = L1 + L2 + ... + L(n-1)  — CHỈ n-1 chặng, vì điểm cuối
--       không có ai rời đi. Câu cũ dùng SUM(est_distance) trên TOÀN BỘ n dòng,
--       tức là cộng thêm quãng đường của điểm đầu vào mẫu số trong khi tử số
--       không có nó -> mẫu số phình -> tỷ lệ tụt.
--       Sửa: chỉ cộng est_distance ở những dòng CÓ w_leg (tức dòng 2..n).
--
--   (2) THIẾU BẬC "MỘT SỐ BKS ĐƯỢC CONFIG" (8.000 / 2550 đơn / 6100 kg).
--       Bảng cấu hình xe tải có 8 bậc, câu cũ chỉ cài 7 — bỏ đúng bậc tra theo
--       BIỂN SỐ chứ không theo tải trọng. Những xe đó rơi nhầm vào bậc
--       6500<X<=16000 (3000 đơn / 7100 kg) -> mẫu số cao hơn thực tế ~16%.
--       Sửa: thêm mảng BKS_DAC_BIET, tra trước khi tra theo tải trọng.
--       ⚠ DANH SÁCH BIỂN SỐ BÊN DƯỚI ĐANG RỖNG — phải điền thì bậc này mới có tác dụng.
--
-- Tham số thay lúc chạy (script tự thay, viết hoa để dễ tìm):
--   :TU_NGAY  :DEN_NGAY   -- nửa khoảng [từ, đến)
-- ============================================================

WITH stops AS (
  SELECT
    code,
    load_date,
    first_check_in,
    hub,
    scheduler_name,
    number_plate,
    partner_code,
    truck_capacity_weight,
    sort_number,
    stoppoint_name,
    warehouse_id,
    warehouse_type,
    est_distance,
    -- "khi RỜI điểm" — đúng chữ trong tài liệu
    total_weight_converted AS w_roi_diem,
    volume_ordercode       AS q_roi_diem
  FROM "ghn-reporting"."fa"."dtm_logistics_trip_detail"
  -- Lọc theo load_date (cột chia phân vùng -> nhanh) NHƯNG nới rộng 1 ngày mỗi
  -- đầu, vì khoá ngày cuối cùng lấy theo first_check_in nên có chuyến lệch sang
  -- ngày kề. Lọc chính xác lại ở bước cuối.
  WHERE load_date >= DATE ':TU_NGAY' - INTERVAL '1' DAY
    AND load_date <  DATE ':DEN_NGAY' + INTERVAL '1' DAY
),

legs AS (
  SELECT *,
    -- W(i-1), Q(i-1): số ký / số đơn khi rời điểm TRƯỚC.
    -- Cặp với est_distance của chính dòng này = L(i-1), quãng đường điểm trước -> điểm này.
    LAG(w_roi_diem)    OVER (PARTITION BY code ORDER BY sort_number) AS w_leg,
    LAG(q_roi_diem)    OVER (PARTITION BY code ORDER BY sort_number) AS q_leg,
    LAG(stoppoint_name)  OVER (PARTITION BY code ORDER BY sort_number) AS kho_truoc_do,
    LEAD(stoppoint_name) OVER (PARTITION BY code ORDER BY sort_number) AS kho_tiep_theo,
    COUNT(*)             OVER (PARTITION BY code) AS so_diem_dung
  FROM stops
),

-- Mức CHUYẾN: bình quân theo quãng đường, đúng công thức
--   (W1*L1 + ... + Wn-1*Ln-1) / (L1 + ... + Ln-1)
chuyen AS (
  SELECT
    code,
    SUM(est_distance * w_leg)
      / NULLIF(SUM(CASE WHEN w_leg IS NOT NULL THEN est_distance END), 0) AS w_bq_chuyen,
    SUM(est_distance * q_leg)
      / NULLIF(SUM(CASE WHEN q_leg IS NOT NULL THEN est_distance END), 0) AS q_bq_chuyen,
    SUM(CASE WHEN w_leg IS NOT NULL THEN est_distance END) AS tong_quang_duong
  FROM legs
  GROUP BY code
),

-- Bảng cấu hình xe tải — 8 bậc, chép nguyên từ tài liệu.
-- Bậc "một số BKS được config" tra theo BIỂN SỐ, phải xét TRƯỚC các bậc tải trọng.
chuan AS (
  SELECT l.*,
    c.w_bq_chuyen, c.q_bq_chuyen, c.tong_quang_duong,
    CASE
      WHEN l.number_plate IN (
        -- ⚠ ĐIỀN BIỂN SỐ ĐƯỢC CONFIG ĐẶC BIỆT VÀO ĐÂY, ví dụ: '50H12311', '51C99999'
        ''
      ) THEN 6100.0
      WHEN l.truck_capacity_weight <=  1400 THEN  1000.0
      WHEN l.truck_capacity_weight <=  2500 THEN  1700.0
      WHEN l.truck_capacity_weight <=  3500 THEN  2500.0
      WHEN l.truck_capacity_weight <=  5000 THEN  3400.0
      WHEN l.truck_capacity_weight <=  6500 THEN  4750.0
      WHEN l.truck_capacity_weight <= 16000 THEN  7100.0
      ELSE 11200.0
    END AS ky_tieu_chuan,
    CASE
      WHEN l.number_plate IN (
        -- ⚠ GIỮ ĐỒNG BỘ với danh sách ở trên
        ''
      ) THEN 2550.0
      WHEN l.truck_capacity_weight <=  1400 THEN   420.0
      WHEN l.truck_capacity_weight <=  2500 THEN   710.0
      WHEN l.truck_capacity_weight <=  3500 THEN  1050.0
      WHEN l.truck_capacity_weight <=  5000 THEN  1420.0
      WHEN l.truck_capacity_weight <=  6500 THEN  1980.0
      WHEN l.truck_capacity_weight <= 16000 THEN  3000.0
      ELSE 4670.0
    END AS don_tieu_chuan
  FROM legs l
  JOIN chuyen c ON c.code = l.code
)

SELECT
  -- Ngày lấy theo lần check-in đầu của chuyến, KHÔNG theo load_date.
  -- ⚠ MÚI GIỜ: nếu first_check_in lưu theo UTC thì phải đổi sang giờ VN trước khi
  --   cắt ngày, không thì mọi chuyến chạy trước 07:00 sáng bị đẩy về ngày hôm trước.
  --   Bỏ AT TIME ZONE nếu cột đã là giờ VN.
  CAST(first_check_in AT TIME ZONE 'Asia/Ho_Chi_Minh' AS DATE) AS ngay,
  code            AS ma_chuyen,
  scheduler_name  AS ma_tuyen,
  CASE WHEN scheduler_name IS NULL OR trim(scheduler_name) = ''
       THEN 'Tăng cường' ELSE 'Cố định' END AS loai_lich,
  hub,
  number_plate    AS bien_so,
  partner_code,
  CASE WHEN partner_code = 'GHN' THEN 'GHN' ELSE 'NCC' END AS partner_type,
  truck_capacity_weight AS tai_trong_xe,
  ky_tieu_chuan,
  don_tieu_chuan,

  sort_number     AS thu_tu,
  so_diem_dung,
  stoppoint_name  AS kho,
  warehouse_id,
  warehouse_type,
  kho_truoc_do,
  kho_tiep_theo,
  est_distance    AS quang_duong_den_diem,
  tong_quang_duong,

  -- TLLD TẠI ĐIỂM: số trên xe KHI RỜI ĐIỂM / tiêu chuẩn
  w_roi_diem      AS khoiluong_kg,
  q_roi_diem      AS so_don_hang,
  ROUND(100.0 * w_roi_diem / NULLIF(ky_tieu_chuan, 0), 2)  AS tlld_weight_diem_pct,
  ROUND(100.0 * q_roi_diem / NULLIF(don_tieu_chuan, 0), 2) AS tlld_vol_diem_pct,

  -- TLLD CẢ CHUYẾN: bình quân theo quãng đường / tiêu chuẩn
  ROUND(100.0 * w_bq_chuyen / NULLIF(ky_tieu_chuan, 0), 2)  AS tlld_weight_chuyen_pct,
  ROUND(100.0 * q_bq_chuyen / NULLIF(don_tieu_chuan, 0), 2) AS tlld_vol_chuyen_pct

FROM chuan
WHERE CAST(first_check_in AT TIME ZONE 'Asia/Ho_Chi_Minh' AS DATE) >= DATE ':TU_NGAY'
  AND CAST(first_check_in AT TIME ZONE 'Asia/Ho_Chi_Minh' AS DATE) <  DATE ':DEN_NGAY'
  -- ⚠ CHƯA LỌC HUB. Query đang quét TOÀN QUỐC.
  --   Chạy scripts/tlld-probe.py để biết cột hub nhận giá trị gì, rồi bật dòng dưới:
  -- AND hub IN ('HCM01', 'HCM20', ...)
ORDER BY ngay, code, sort_number
