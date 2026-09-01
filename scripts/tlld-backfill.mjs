#!/usr/bin/env node
/* ============================================================
   NẠP LỊCH SỬ TLLD — chạy 1 lần khi chuyển đổi.

   Script này KHÔNG tự gọi Data API và KHÔNG tự ghi Supabase. Nó chỉ gọi endpoint
   /api/cron/tlld trên Vercel, mỗi lần một ngày. Lý do:
     • Câu SQL và cách ghi chỉ tồn tại MỘT bản (api/_lib/tlldQuery.ts). Nếu script
       này tự làm lấy thì thành hai bản, sớm muộn lệch nhau.
     • Token Data API và khoá Supabase nằm nguyên trên Vercel, không phải bê ra
       máy cá nhân.
     • Mỗi ngày một lời gọi -> không đụng giới hạn thời gian chạy của function,
       và lỗi ngày nào thì chạy lại đúng ngày đó.

   Cách chạy:
     node scripts/tlld-backfill.mjs "<CRON_SECRET>" 2026-06-01 2026-09-01
     node scripts/tlld-backfill.mjs "<CRON_SECRET>" 2026-06-01 2026-09-01 https://m12-linehaul.vercel.app

   Khoảng ngày là NỬA KHOẢNG [từ, đến) — ngày cuối không bao gồm.
   Secret nhận qua tham số dòng lệnh, không hardcode.
   Chạy lại nhiều lần vô hại: endpoint ghi đè theo khoá (ngày, mã chuyến, thứ tự).
   ============================================================ */

const [, , SECRET, TU, DEN, BASE_ARG] = process.argv;
const BASE = BASE_ARG || "https://m12-linehaul.vercel.app";

if (!SECRET || !TU || !DEN) {
  console.error('Dùng: node scripts/tlld-backfill.mjs "<CRON_SECRET>" <tu-ngay> <den-ngay> [base-url]');
  console.error("Ví dụ: node scripts/tlld-backfill.mjs \"$CRON_SECRET\" 2026-06-01 2026-09-01");
  process.exit(1);
}
for (const [ten, v] of [["từ", TU], ["đến", DEN]]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error(`Ngày ${ten} phải dạng YYYY-MM-DD, nhận được: ${v}`);
    process.exit(1);
  }
}

const ngayISO = (d) => d.toISOString().slice(0, 10);
const NGAY = 86_400_000;

const danhSachNgay = [];
for (let t = Date.parse(TU); t < Date.parse(DEN); t += NGAY) {
  danhSachNgay.push(ngayISO(new Date(t)));
}

console.log(`▸ Nạp ${danhSachNgay.length} ngày: ${TU} .. ${DEN} (không gồm ngày cuối)`);
console.log(`▸ Đích: ${BASE}/api/cron/tlld\n`);

let tongDoc = 0, tongGhi = 0, tongChuyen = 0, tongThieuTuyen = 0;
const loi = [];

for (const [i, ngay] of danhSachNgay.entries()) {
  const sau = ngayISO(new Date(Date.parse(ngay) + NGAY));
  const nhan = `[${String(i + 1).padStart(3)}/${danhSachNgay.length}] ${ngay}`;
  const batDau = Date.now();
  try {
    const r = await fetch(`${BASE}/api/cron/tlld?tu=${ngay}&den=${sau}`, {
      headers: { authorization: "Bearer " + SECRET },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      loi.push({ ngay, loi: d.detail || d.error || `HTTP ${r.status}` });
      console.log(`${nhan}  ✖ ${d.detail || d.error || r.status}`);
      continue;
    }
    tongDoc += d.doc || 0;
    tongGhi += d.ghi || 0;
    tongChuyen += d.so_chuyen || 0;
    tongThieuTuyen += d.thieu_ma_tuyen || 0;
    const giay = Math.round((Date.now() - batDau) / 1000);
    console.log(
      `${nhan}  ${String(d.doc || 0).padStart(5)} điểm dừng · ` +
      `${String(d.so_chuyen || 0).padStart(4)} chuyến · ${giay}s` +
      (d.thieu_ma_tuyen ? `  ⚠ ${d.thieu_ma_tuyen} dòng thiếu mã tuyến` : ""),
    );
  } catch (e) {
    loi.push({ ngay, loi: String(e?.message || e) });
    console.log(`${nhan}  ✖ ${e?.message || e}`);
  }
}

console.log(`\n── TỔNG ────────────────────────────────`);
console.log(`Điểm dừng đọc được : ${tongDoc.toLocaleString("vi-VN")}`);
console.log(`Ghi vào Supabase   : ${tongGhi.toLocaleString("vi-VN")}`);
console.log(`Chuyến             : ${tongChuyen.toLocaleString("vi-VN")}`);
if (tongThieuTuyen) {
  console.log(`\n⚠ ${tongThieuTuyen.toLocaleString("vi-VN")} dòng KHÔNG có mã tuyến.`);
  console.log(`  Những dòng này không nối được sang lịch tải. Thường là chuyến tăng cường`);
  console.log(`  không sinh từ lịch trình nào — cần xem lại trước khi tin số tổng theo tuyến.`);
}
if (loi.length) {
  console.log(`\n✖ ${loi.length} ngày lỗi, chạy lại riêng mấy ngày này:`);
  for (const l of loi) console.log(`  ${l.ngay}  ${l.loi}`);
  process.exitCode = 1;
} else {
  console.log("\nXong, không ngày nào lỗi.");
}
