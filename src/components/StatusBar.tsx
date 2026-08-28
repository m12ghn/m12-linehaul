import { useEffect, useState, type ReactNode } from "react";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "vừa cập nhật";
  if (s < 60) return `${s} giây trước`;
  return `${Math.floor(s / 60)} phút trước`;
}

/** Dải trạng thái: tình trạng đồng bộ + thời điểm + cảnh báo điểm thiếu toạ độ. */
export function StatusBar({
  lastSync,
  error,
  missingGeo,
  action,
}: {
  lastSync: number | null;
  error: string | null;
  missingGeo: string[];
  action?: ReactNode;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="statusbar">
      {error ? (
        <span className="pill warn">
          <span className="blink" /> Lỗi kết nối
        </span>
      ) : lastSync ? (
        <span className="pill">
          <span className="blink" /> Trực tuyến · đồng bộ {ago(lastSync)}
        </span>
      ) : (
        <span className="pill idle">
          <span className="blink" /> Đang đồng bộ…
        </span>
      )}
      {missingGeo.length > 0 && (
        <span
          className="pill warn"
          title={"Chưa có toạ độ trên bản đồ:\n" + missingGeo.slice(0, 40).join("\n")}
        >
          {missingGeo.length} điểm chưa có toạ độ
        </span>
      )}
      {action && <span className="sb-action">{action}</span>}
    </div>
  );
}
