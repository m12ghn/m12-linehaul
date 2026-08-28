/* ============================================================
   Tạo / đọc file Excel mẫu cho Trợ lý Lịch Tải.
   ============================================================ */
import type { TemplateRow } from "./planner";
// xlsx nạp ĐỘNG (chỉ khi tải mẫu / đọc file) -> không phình bundle lúc mở trang.

const HEADERS = [
  "Nhóm tuyến",
  "Loại hình",
  "Kho đầu",
  "Kho cuối",
  "Tên bưu cục",
  "KL Lấy (kg)",
  "KL Giao (kg)",
  "Giờ bắt đầu",
  "Cut-off (HH:MM)",
];

/** Tải file mẫu Template_Lich_Tai.xlsx. */
export async function downloadTemplate(): Promise<void> {
  const XLSX = await import("xlsx");
  const sample = [
    ["Tuyến 1", "Lấy", "Kho Trung Chuyển Hồ Chí Minh 01", "", "Bưu Cục Phước Kiển-Nhà Bè-HCM", 600, "", "19:30", "21:00"],
    ["Tuyến 1", "Lấy", "", "", "Bưu Cục 785C Nguyễn Bình-Nhà Bè-HCM", 480, "", "", "21:00"],
    ["Tuyến 1", "Lấy", "", "", "Bưu Cục 63 Đường Số 7-Xã Nhà Bè-HCM", 370, "", "", "21:30"],
    ["Tuyến 2", "Giao", "Kho Trung Chuyển Hồ Chí Minh 20", "", "Bưu Cục 63 Ký Hòa-Q.5-HCM", "", 900, "06:00", "08:00"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...sample]);
  ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 30 }, { wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 14 }];

  const huongDan = [
    ["HƯỚNG DẪN NHẬP — Trợ lý Lịch Tải M12"],
    [""],
    ["• Mỗi DÒNG = 1 điểm dừng (bưu cục/kho)."],
    ["• Cùng 'Nhóm tuyến' = gom thành 1 chuyến; máy tự xếp thứ tự & tính giờ."],
    ["• 'Loại hình': Lấy hoặc Giao."],
    ["• 'Kho đầu' / 'Kho cuối': ghi ở dòng đầu mỗi nhóm (kho cuối trống = quay về kho đầu)."],
    ["• 'KL Lấy (kg)' dùng cho tuyến Lấy; 'KL Giao (kg)' cho tuyến Giao — để máy tính số xe."],
    ["• 'Giờ bắt đầu': giờ đến kho đầu, dạng HH:MM (ghi ở dòng đầu nhóm)."],
    ["• 'Cut-off (HH:MM)': giờ chốt của bưu cục — máy cảnh báo nếu xe tới SAU giờ này."],
    ["• Tên bưu cục/kho phải ĐÚNG như trong hệ thống (có toạ độ) để vẽ được lộ trình."],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(huongDan);
  ws2["!cols"] = [{ wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "LICH_TAI");
  XLSX.utils.book_append_sheet(wb, ws2, "HƯỚNG DẪN");
  XLSX.writeFile(wb, "Template_Lich_Tai.xlsx");
}

const norm = (s: string) =>
  (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

/** Đọc file upload -> danh sách TemplateRow. */
export async function parseTemplate(file: File): Promise<TemplateRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  // ưu tiên sheet "LICH_TAI", nếu không có lấy sheet đầu
  const sheetName = wb.SheetNames.find((n) => norm(n).includes("lich")) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
  if (!aoa.length) return [];

  const H = (aoa[0] || []).map((x) => norm(String(x)));
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const i = H.findIndex((h) => h.includes(norm(k)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    group: find("nhom tuyen", "nhom", "tuyen"),
    mode: find("loai hinh", "loai"),
    khoDau: find("kho dau"),
    khoCuoi: find("kho cuoi"),
    name: find("ten buu cuc", "buu cuc", "ten kho", "diem"),
    klLay: find("kl lay", "lay"),
    klGiao: find("kl giao", "giao"),
    startTime: find("gio bat dau"),
    cutoff: find("cut-off", "cut off", "cutoff", "gio chot", "chot"),
  };
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? String(r[i] ?? "").trim() : "");
  const num = (s: string) => parseFloat((s || "").replace(/[^\d.]/g, "")) || 0;

  return aoa.slice(1).map((r) => ({
    group: g(r, c.group),
    mode: g(r, c.mode),
    khoDau: g(r, c.khoDau),
    khoCuoi: g(r, c.khoCuoi),
    name: g(r, c.name),
    klLay: num(g(r, c.klLay)),
    klGiao: num(g(r, c.klGiao)),
    startTime: g(r, c.startTime),
    cutoff: g(r, c.cutoff),
  }));
}
