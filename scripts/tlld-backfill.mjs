#!/usr/bin/env node
/* ============================================================
   NẠP LỊCH SỬ TLLD — chạy 1 lần khi chuyển đổi.

   Script này KHÔNG tự gọi Data API và KHÔNG tự ghi Supabase. Nó chỉ gọi endpoint
   /api/cron/tlld trên Vercel, mỗi lần một KHOẢNG ngày. Lý do:
     • Câu SQL và cách ghi chỉ tồn tại MỘT bản (api/_lib/tlldQuery.ts). Script này
       tự làm lấy thì thành hai bản, sớm muộn lệch nhau.
     • Token Data API và khoá Supabase nằm nguyên trên Vercel, không bê ra máy cá nhân.
     • Lỗi khoảng nào thì chạy lại đúng khoảng đó.

   ⚠ VÌ SAO CHIA THEO TUẦN CHỨ KHÔNG THEO NGÀY:
   Data API tính quota theo số lần POST /queries mỗi ngày — mặc định 200, có token
   bị đặt xuống 50. Còn việc kéo dữ liệu về (GET /next) thì KHÔNG tốn quota.
   Nạp 3 tháng mà chia theo ngày là ~90 lượt POST, ăn nửa quota hoặc vượt hẳn;
   chia theo tuần chỉ còn ~13 lượt. Gom càng lớn càng rẻ quota, nhưng đổi lại mỗi
   lượt chạy lâu hơn và endpoint có trần 300 giây — tuần là mức cân bằng.
   Khoảng nào bị quá giờ thì chạy lại riêng khoảng đó với --ngay=3 cho nhỏ lại.

   Cách chạy:
     node scripts/tlld-backfill.mjs "<CRON_SECRET>" 2026-06-01 2026-09-01
     node scripts/tlld-backfill.mjs "<CRON_SECRET>" 2026-06-01 2026-09-01 --ngay=3
     node scripts/tlld-backfill.mjs "<CRON_SECRET>" 2026-06-01 2026-09-01 --base=https://...

   Khoảng ngày là NỬA KHOẢNG [từ, đến) — ngày cuối không bao gồm.
   Secret nhận qua tham số dòng lệnh, không hardcode.
   Chạy lại nhiều lần vô hại: endpoint ghi đè theo khoá (ngày, mã chuyến, thứ tự).
   ============================================================ */

const args = process.argv.slice(2);
const co = (ten, mac) => {
  const t = args.find((a) => a.startsWith(`--${ten}=`));
  return t ? t.slice(ten.length + 3) : mac;
};
const viTri = args.filter((a) => !a.startsWith("--"));
const [SECRET, TU, DEN] = viTri;
const BASE = co("base", "https://m12-linehaul.vercel.app");
const BUOC = Math.max(1, Number(co("ngay", "7")) || 7);

if (!SECRET || !TU || !DEN) {
  console.error('Dùng: node scripts/tlld-backfill.mjs "<CRON_SECRET>" <tu-ngay> <den-ngay> [--ngay=7] [--base=...]');
  console.error('Ví dụ: node scripts/tlld-backfill.mjs "$CRON_SECRET" 2026-06-01 2026-09-01');
  process.exit(1);
}
for (const [ten, v] of [["từ", TU], ["đến", DEN]]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error(`Ngày ${ten} phải dạng YYYY-MM-DD, nhận được: ${v}`);
    process.exit(1);
  }
}

const NGAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const khoang = [];
for (let t = Date.parse(TU); t < Date.parse(DEN); t += BUOC * NGAY) {
  khoang.push([iso(t), iso(Math.min(t + BUOC * NGAY, Date.parse(DEN)))]);
}

console.log(`▸ ${TU} .. ${DEN} (không gồm ngày cuối), chia ${BUOC} ngày/lượt`);
console.log(`▸ ${khoang.length} lượt POST — Data API mặc định cho 200 lượt/ngày, có token chỉ 50`);
console.log(`▸ Đích: ${BASE}/api/cron/tlld\n`);

let tongDoc = 0, tongGhi = 0, tongChuyen = 0, tongThieuTuyen = 0, quotaCuoi = null, boQua = 0;
const loi = [];

for (const [i, [tu, den]] of khoang.entries()) {
  const nhan = `[${String(i + 1).padStart(3)}/${khoang.length}] ${tu} → ${den}`;
  const batDau = Date.now();
  try {
    const r = await fetch(`${BASE}/api/cron/tlld?tu=${tu}&den=${den}`, {
      headers: { authorization: "Bearer " + SECRET },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      loi.push({ tu, den, loi: d.detail || d.error || `HTTP ${r.status}` });
      console.log(`${nhan}  ✖ ${d.detail || d.error || r.status}`);
      // Hết quota thì dừng hẳn: chạy tiếp chỉ tốn thêm lượt mà không ra gì.
      if (String(d.detail || "").includes("quota")) {
        console.log("\n✖ Hết quota Data API trong ngày. Quota reset 07:00 giờ VN — mai chạy tiếp.");
        break;
      }
      continue;
    }
    // Endpoint tự bỏ qua khoảng đã nạp trong 12 tiếng để khỏi tốn quota.
    // Đây KHÔNG phải lỗi — chạy lại script sau khi đứt giữa chừng là gặp nhiều.
    if (d.bo_qua) {
      boQua++;
      console.log(`${nhan}  ⤳ bỏ qua, đã nạp lúc ${d.nap_luc}`);
      continue;
    }
    tongDoc += d.doc || 0;
    tongGhi += d.ghi || 0;
    tongChuyen += d.so_chuyen || 0;
    tongThieuTuyen += d.thieu_ma_tuyen || 0;
    if (d.quota_con_lai !== null && d.quota_con_lai !== undefined) quotaCuoi = d.quota_con_lai;
    console.log(
      `${nhan}  ${String(d.doc || 0).padStart(6)} điểm dừng · ` +
      `${String(d.so_chuyen || 0).padStart(5)} chuyến · ${Math.round((Date.now() - batDau) / 1000)}s` +
      (d.quota_con_lai != null ? ` · quota còn ${d.quota_con_lai}` : "") +
      (d.thieu_ma_tuyen ? `  ⚠ ${d.thieu_ma_tuyen} dòng thiếu mã tuyến` : ""),
    );
  } catch (e) {
    loi.push({ tu, den, loi: String(e?.message || e) });
    console.log(`${nhan}  ✖ ${e?.message || e}`);
  }
}

console.log(`\n── TỔNG ────────────────────────────────`);
console.log(`Điểm dừng đọc được : ${tongDoc.toLocaleString("vi-VN")}`);
console.log(`Ghi vào Supabase   : ${tongGhi.toLocaleString("vi-VN")}`);
console.log(`Chuyến             : ${tongChuyen.toLocaleString("vi-VN")}`);
if (boQua) console.log(`Bỏ qua (đã nạp rồi): ${boQua} khoảng`);
if (quotaCuoi != null) console.log(`Quota còn lại      : ${quotaCuoi}`);
if (tongThieuTuyen) {
  console.log(`\n⚠ ${tongThieuTuyen.toLocaleString("vi-VN")} dòng KHÔNG có mã tuyến.`);
  console.log(`  Những dòng này không nối được sang lịch tải. Thường là chuyến tăng cường`);
  console.log(`  không sinh từ lịch trình nào — xem lại trước khi tin số tổng theo tuyến.`);
}
if (loi.length) {
  console.log(`\n✖ ${loi.length} khoảng lỗi, chạy lại riêng mấy khoảng này:`);
  for (const l of loi) {
    console.log(`  ${l.tu} → ${l.den}  ${l.loi}`);
  }
  console.log(`  Nếu lỗi là quá giờ (timeout) thì chạy lại với --ngay=2 cho nhỏ lại.`);
  process.exitCode = 1;
} else {
  console.log("\nXong, không khoảng nào lỗi.");
}
