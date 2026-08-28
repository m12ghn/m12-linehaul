/* Bảng viết tắt/thuật ngữ gấp gọn cho Plan Event — người mới đọc báo cáo không quen từ
   FC/NCC/cot/CK... Định nghĩa lấy theo đúng cách dùng THẬT trong Dash (không suy diễn thêm). */
import { Collapsible } from "./Collapsible";

const TERMS: { term: string; def: string }[] = [
  { term: "FC (Forecast)", def: "Dự báo sản lượng/khối lượng hàng theo ngày × kho, lấy từ Sheet Forecast Volume — nguồn số CHÍNH để tính xe cần." },
  { term: "NCC (Nhà cung cấp)", def: "Đơn vị vận tải THUÊ NGOÀI (khác xe nhà GHN), cung cấp xe theo booking/hợp đồng." },
  { term: "BC (Bưu cục)", def: "Điểm gom/giao hàng — nơi phát sinh nhu cầu \"xin tăng cường\" xe." },
  { term: "cot", def: "Khung giờ/cữ xe cố định đã đặt trước với NCC cho kỳ event (\"bỏ cot\" = huỷ khung giờ đã đặt để đổi xe khác linh hoạt hơn khi cần gấp)." },
  { term: "CK", def: "15 khu vực gom hàng nội thành HCM (dùng trong \"Data hàng\") — là mức KHU VỰC, không phải từng bưu cục lẻ." },
  { term: "cut-off", def: "Mốc giờ chốt nhận hàng trong ngày — hàng nộp sau cut-off bị dời xử lý sang hôm sau." },
  { term: "ghép tải", def: "Gộp nhiều đơn/tuyến đang lấp đầy thấp vào chung 1 xe để giảm số xe cần." },
  { term: "đội nền", def: "Xe chạy CỐ ĐỊNH hàng ngày (không phải xe đặt thêm cho event) — năng lực gốc của cụm." },
  { term: "GHN (cũ) — đội xe nền", def: "Xe công ty tự có, tham chiếu THỦ CÔNG cố định (không đổi theo kỳ) trong biểu đồ \"Đội xe nền\" — KHÁC 2 mục GHN dưới đây." },
  { term: "GHN dự phòng — kỳ tăng cường", def: "Số xe nhà GHN THẬT đã book cho kỳ tăng cường ĐANG XEM (số LIVE, đổi theo từng kỳ) — dùng ở PlanVerdict/SurgePlan, giữ làm dự phòng phát sinh, không tính vào phần tăng cường chính (100% qua NCC)." },
  { term: "GHN rảnh — lấy hàng", def: "~10 xe trống riêng cho LẤY HÀNG (tham chiếu thủ công, không đổi theo kỳ), mỗi xe chạy 2-3 lượt/ngày → dự phòng thêm ~20-30 lượt." },
  { term: "trần năng lực", def: "Giới hạn tối đa xe có thể huy động (đội nền + dư địa NCC/GHN) — vượt trần phải thuê nóng thêm." },
  { term: "tồn >24h", def: "Đơn hàng còn tồn kho quá 24 giờ chưa xử lý — dấu hiệu quá tải cần can thiệp gấp." },
  { term: "độ co giãn (elasticity)", def: "Tỷ lệ %xe tăng so với %hàng tăng ngày đỉnh — đo xem tăng xe có tương xứng tăng hàng không (hợp lý ~0.6–0.9×)." },
  { term: "HCM20", def: "Kho trung chuyển khu vực nội thành HCM." },
  { term: "Sóng Thần", def: "Kho trung chuyển khu vực Sóng Thần (Bình Dương)." },
];

export function Glossary() {
  return (
    <Collapsible title="📖 Giải thích thuật ngữ" sub="FC, NCC, cot, CK, cut-off, đội nền, GHN..." defaultOpen={false} style={{ marginTop: 12 }}>
      <div className="glossary-grid">
        {TERMS.map((t) => (
          <div className="glossary-row" key={t.term}>
            <b>{t.term}</b>
            <span>{t.def}</span>
          </div>
        ))}
      </div>
    </Collapsible>
  );
}
