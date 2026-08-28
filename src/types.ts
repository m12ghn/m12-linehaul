/** Một điểm dừng trong tuyến (1 dòng sheet) */
export interface Stop {
  kho: string;       // Tên kho / Bưu cục
  loaiHinh: string;  // Phân loại / Giao / Lấy...
  toi: string;       // Tới điểm (giờ)
  roi: string;       // Rời điểm (giờ)
  coord?: [number, number]; // toạ độ khớp từ KML (nếu có)
  id?: string;       // cột ID (để xuất Excel)
}

/** Một tuyến = gom nhiều dòng cùng "Tên tuyến" */
export interface Route {
  route: string;     // Tên tuyến
  load: string;      // Tải trọng
  category: string;  // Loại tuyến
  ncc?: string;      // Nhà cung cấp (cột NCC trong sheet lịch tải)
  bks?: string;      // Biển số xe (cột BKS trong sheet lịch tải, đã làm sạch)
  stops: Stop[];
  mappedCount: number; // số điểm khớp được toạ độ
}

/** Định nghĩa 1 tab sheet (vùng) */
export interface SheetDef {
  key: string;
  gid: string;
  label: string;
  /** true = ẩn khỏi MỌI bộ chọn vùng trên UI (menu Lịch Tải, dropdown TLLD/Ghép Tải) nhưng
   *  VẪN giữ trong SHEETS để logic loại trừ (tlldExclude) đọc được gid. Dùng VISIBLE_SHEETS ở UI. */
  hidden?: boolean;
}

export type TopMenu =
  | "tong-quan"
  | "lich-tai"
  | "gsvt"
  | "lo-trinh"
  | "tlld-tuyen"
  | "tang-cuong"
  | "cong-xuat"
  | "san-luong"
  | "ds-ncc"
  | "plan-event"
  | "sap-lich-tai"
  | "phan-quyen";

/** Trạng thái tải dữ liệu của 1 vùng */
export interface SheetData {
  routes: Route[];
  categories: string[];        // các "Loại tuyến" distinct, đã sắp xếp
  lastSync: number | null;     // epoch ms
  loading: boolean;
  error: string | null;
  missingGeo: string[];        // tên kho không khớp toạ độ (distinct)
}
