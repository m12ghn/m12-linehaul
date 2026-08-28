import { Component, type ReactNode } from "react";

/**
 * Lưới an toàn: nếu 1 phần giao diện lỗi thì TỰ thử render lại (nhiều lỗi do
 * tải dữ liệu chưa kịp / Google Sheets trả chậm -> render lại là hết), chỉ khi
 * vẫn lỗi sau 2 lần mới hiện thông báo + nút tải lại. Ghi log đầy đủ để chẩn.
 */
type EBProps = { children: ReactNode; compact?: boolean; label?: string };

export class ErrorBoundary extends Component<EBProps, { err: Error | null; stack: string; retry: number }> {
  private timer: number | undefined;
  constructor(props: EBProps) {
    super(props);
    this.state = { err: null, stack: "", retry: 0 };
  }
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: { componentStack?: string }) {
    console.error("[M12 Dashboard] lỗi giao diện:", err, info?.componentStack);
    // Tên component lỗi (dòng đầu của componentStack) để chẩn đoán nhanh.
    const firstFrame = (info?.componentStack || "").trim().split("\n").slice(0, 4).join("\n");
    this.setState({ stack: firstFrame });
    // Lưu lỗi gần nhất để tiện chẩn đoán (xem window.__m12LastErr hoặc sessionStorage).
    try {
      (window as unknown as { __m12LastErr?: unknown }).__m12LastErr = { message: err?.message, stack: err?.stack, componentStack: info?.componentStack };
      sessionStorage.setItem("m12:lastErr", `${err?.message || err}\n${info?.componentStack || ""}`.slice(0, 1500));
    } catch { /* bỏ qua */ }
    // Tự phục hồi: thử lại sau khoảnh khắc (tối đa 2 lần).
    if (this.state.retry < 2) {
      this.timer = window.setTimeout(() => this.setState((s) => ({ err: null, retry: s.retry + 1 })), 1200);
    }
  }
  componentWillUnmount() { if (this.timer) window.clearTimeout(this.timer); }
  render() {
    if (this.state.err) {
      // Còn lượt tự phục hồi -> hiện trạng thái nhẹ "đang tải lại", không báo lỗi to.
      if (this.state.retry < 2) return <div className="eb-reloading">⏳ Đang tải lại {this.props.label || "mục này"}…</div>;
      const detail = `${String(this.state.err?.message || this.state.err)}\n\n[Vị trí]\n${this.state.stack}`;
      // Chế độ GỌN: chỉ phần con lỗi mới hiện cảnh báo nhỏ, các phần khác vẫn chạy.
      if (this.props.compact) {
        return (
          <div className="eb-compact">
            ⚠️ {this.props.label || "Mục này"} tạm lỗi hiển thị (các phần khác vẫn dùng bình thường).
            <details className="eb-detail"><summary>Chi tiết</summary><pre>{detail}</pre></details>
          </div>
        );
      }
      return (
        <div className="err-boundary">
          <div className="eb-card">
            <div className="eb-ic">⚠️</div>
            <div className="eb-title">Mục này đang gặp trục trặc hiển thị</div>
            <div className="eb-sub">Dữ liệu của Sếp vẫn an toàn. Thử tải lại trang giúp em nhé.</div>
            <button className="eb-btn" onClick={() => window.location.reload()}>🔄 Tải lại trang</button>
            <details className="eb-detail"><summary>Chi tiết kỹ thuật</summary><pre>{detail}</pre></details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
