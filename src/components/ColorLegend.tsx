/* Chú giải màu DÙNG CHUNG cho mọi thẻ/biểu đồ trong Plan Event — 1 quy ước duy nhất,
   tránh mỗi khối tự bịa nghĩa màu khác nhau (phản hồi "người mới không biết màu nghĩa gì"). */
export function ColorLegend() {
  return (
    <div className="color-legend">
      <b>Chú giải màu:</b>
      <span><i style={{ background: "var(--green)" }} />Xanh = đạt/đủ</span>
      <span><i style={{ background: "var(--orange)" }} />Cam = cảnh báo/gần ngưỡng</span>
      <span><i style={{ background: "var(--red)" }} />Đỏ = vượt ngưỡng/rủi ro</span>
    </div>
  );
}
