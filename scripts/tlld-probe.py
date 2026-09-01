#!/usr/bin/env python3
"""
============================================================
THĂM DÒ NGUỒN TLLD — chạy 1 ngày, xem dữ liệu thật trông thế nào.

Mục đích: TRƯỚC KHI viết đường ống nạp vào Supabase, cần biết chắc mấy điều
mà nhìn câu SQL không trả lời được:
  1. `scheduler_name` có phải là MÃ TUYẾN không? (cả dashboard khớp bằng mã tuyến)
  2. Cột `hub` nhận những giá trị gì? -> mới biết lọc 5 hub miền Nam thế nào
  3. `so_don_hang` / `khoiluong_kg` trong Sheet là TỔNG hay BÌNH QUÂN?
  4. Suy `loai_tai` (Nhập/Xuất) từ đâu — `first_wh_type` chăng?

Cách chạy (token KHÔNG hardcode, nhận qua tham số dòng lệnh):

    source ~/.openclaw/service-env/custom-gateway-env.sh \
      && python3 scripts/tlld-probe.py "$DATA_API_TOKEN"

Đổi ngày (mặc định hôm kia, vì hôm qua có thể chưa chốt số):

    ... python3 scripts/tlld-probe.py "$DATA_API_TOKEN" 2026-08-28

Script CHỈ ĐỌC. Không ghi vào đâu cả, không đụng Supabase.
Token không được in ra, không được ghi vào file.
============================================================
"""
import json
import sys
import urllib.request
from collections import Counter
from datetime import date, timedelta

BASE = "https://data-api-provider.ghn.vn"


def die(msg: str) -> None:
    print("✖ " + msg)
    sys.exit(1)


if len(sys.argv) < 2 or not sys.argv[1].strip():
    die("Thiếu token.\n  Chạy: source ~/.openclaw/service-env/custom-gateway-env.sh "
        '&& python3 scripts/tlld-probe.py "$DATA_API_TOKEN"')

TOKEN = sys.argv[1].strip()
NGAY = sys.argv[2].strip() if len(sys.argv) > 2 else str(date.today() - timedelta(days=2))
NGAY_SAU = str(date.fromisoformat(NGAY) + timedelta(days=1))


def call(path: str, body: dict | None = None) -> dict:
    """Gọi Data API. Lỗi thì in nguyên văn để còn biết đường sửa."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method="POST" if body is not None else "GET",
        headers={
            "authorization": "Bearer " + TOKEN,
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code} khi gọi {path}\n{e.read().decode()[:500]}")
    except Exception as e:  # noqa: BLE001
        die(f"Không gọi được {path}: {type(e).__name__}: {e}")
    return {}


# Bản rút gọn của câu query gốc: giữ nguyên phần tính, chỉ CHƯA lọc hub
# (đang cần xem hub có những giá trị gì) và bỏ 2 cột tỷ lệ % ở cuối cho nhẹ —
# thăm dò thì chưa cần, tính lại lúc nào cũng được.
SQL = f"""
WITH stops AS (
  SELECT
    code, load_date, hub, scheduler_name, number_plate, partner_code, partner_type,
    CAST(truck_capacity_weight AS DOUBLE) AS truck_capacity_weight,
    first_check_in, sort_number, stoppoint_name, warehouse_id, warehouse_type,
    est_distance,
    total_weight_converted AS w_on_truck,
    volume_ordercode AS q_on_truck
  FROM "ghn-reporting"."fa"."dtm_logistics_trip_detail"
  WHERE load_date >= DATE '{NGAY}'
    AND load_date <  DATE '{NGAY_SAU}'
),
legs AS (
  SELECT *,
    LAG(w_on_truck) OVER (PARTITION BY code ORDER BY sort_number) AS w_leg,
    LAG(q_on_truck) OVER (PARTITION BY code ORDER BY sort_number) AS q_leg
  FROM stops
)
SELECT
  code, MAX(load_date) AS load_date, MAX(hub) AS hub,
  MAX(scheduler_name) AS scheduler_name, MAX(number_plate) AS number_plate,
  MAX(partner_code) AS partner_code, MAX(truck_capacity_weight) AS truck_capacity_weight,
  arbitrary(CASE WHEN sort_number = 1 THEN stoppoint_name END) AS first_wh_name,
  arbitrary(CASE WHEN sort_number = 1 THEN warehouse_type END) AS first_wh_type,
  array_join(array_agg(stoppoint_name ORDER BY sort_number), ' -> ') AS route_stoppoints_name,
  SUM(est_distance) AS total_est_distance,
  arbitrary(CASE WHEN sort_number = 1 THEN est_distance END) AS est_distance_diem_dau,
  COUNT(*) AS count_stoppoints,
  SUM(est_distance * w_leg) / NULLIF(SUM(est_distance), 0) AS weight_on_truck_avg,
  SUM(est_distance * q_leg) / NULLIF(SUM(est_distance), 0) AS orders_on_truck_avg,
  SUM(w_on_truck) AS tong_khoiluong_tat_ca_diem,
  SUM(q_on_truck) AS tong_so_don_tat_ca_diem
FROM legs
GROUP BY code
"""

print(f"▸ Ngày thăm dò: {NGAY}  (nửa khoảng [{NGAY}, {NGAY_SAU}) — đúng như query gốc)")
print("▸ Đang gửi query… (Trino có thể mất 30–90 giây)")

res = call("/api/v1/queries", {"sql": SQL})
qid = res.get("queryId")
cols = [c.get("name", c) if isinstance(c, dict) else c for c in (res.get("schema") or [])]
rows = list(res.get("rows") or [])

# Lấy hết các batch còn lại
lan = 1
while res.get("hasMore") and qid:
    lan += 1
    res = call(f"/api/v1/queries/{qid}/next")
    rows += list(res.get("rows") or [])
    print(f"   … batch {lan}: tổng {len(rows)} dòng")

print(f"\n── KẾT QUẢ ─────────────────────────────────────────")
print(f"Số chuyến trong ngày (toàn quốc): {len(rows)}")
print(f"\nCột trả về ({len(cols)}):")
print("  " + ", ".join(map(str, cols)))

if not rows:
    print("\n⚠ Không có dòng nào. Thử ngày khác — có thể ngày này chưa chốt số.")
    sys.exit(0)


def col(name: str):
    """Lấy giá trị 1 cột theo tên, chịu được cả kiểu dict lẫn kiểu mảng."""
    if isinstance(rows[0], dict):
        return [r.get(name) for r in rows]
    if name not in cols:
        return []
    i = cols.index(name)
    return [r[i] if i < len(r) else None for r in rows]


print("\n── CÂU HỎI 2: cột `hub` nhận giá trị gì? ──────────")
for v, n in Counter(str(x) for x in col("hub")).most_common(25):
    print(f"  {n:>6}  {v}")

print("\n── CÂU HỎI 1: `scheduler_name` có giống mã tuyến không? ──")
sch = [str(x) for x in col("scheduler_name") if x not in (None, "", "None")]
print(f"  {len(sch)}/{len(rows)} chuyến có scheduler_name "
      f"({len(rows) - len(sch)} chuyến trống -> 'Tăng cường')")
for v in list(dict.fromkeys(sch))[:12]:
    print(f"    {v}")

print("\n── CÂU HỎI 4: `first_wh_type` nhận giá trị gì? ─────")
for v, n in Counter(str(x) for x in col("first_wh_type")).most_common(10):
    print(f"  {n:>6}  {v}")

print("\n── CÂU HỎI 5: điểm dừng đầu có quãng đường khác 0 không? ──")
d0 = [x for x in col("est_distance_diem_dau") if x is not None]
khac0 = [x for x in d0 if float(x) != 0]
print(f"  {len(khac0)}/{len(d0)} chuyến có est_distance ở điểm đầu KHÁC 0")
print("  (khác 0 nhiều -> công thức đang bỏ điểm đầu ở tử số nhưng vẫn tính ở mẫu số")
print("   -> tỷ lệ lấp đầy bị kéo xuống. Cần đối chiếu với Sheet.)")

print("\n── CÂU HỎI 3: bình quân hay tổng? (3 chuyến đầu) ──")
for i in range(min(3, len(rows))):
    r = rows[i]
    g = (lambda k: r.get(k)) if isinstance(r, dict) else (lambda k: r[cols.index(k)] if k in cols else None)
    print(f"  chuyến {g('code')}")
    print(f"    khối lượng: bình quân={g('weight_on_truck_avg')}  tổng={g('tong_khoiluong_tat_ca_diem')}")
    print(f"    số đơn:     bình quân={g('orders_on_truck_avg')}  tổng={g('tong_so_don_tat_ca_diem')}")
    print(f"    tải trọng xe={g('truck_capacity_weight')}  số điểm={g('count_stoppoints')}")

print("\n── 1 DÒNG MẪU ĐẦY ĐỦ ──────────────────────────────")
r0 = rows[0]
if isinstance(r0, dict):
    for k, v in r0.items():
        print(f"  {k:<28} {v}")
else:
    for k, v in zip(cols, r0):
        print(f"  {str(k):<28} {v}")

print("\nXong. Gửi lại toàn bộ phần in ra ở trên là đủ để viết đường ống.")
