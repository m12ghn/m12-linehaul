import { RouteCard } from "./RouteCard";
import { normCode } from "../lib/tlld";
import type { Vehicle } from "../lib/fleet";
import type { Route } from "../types";

/** Danh sách tuyến + các trạng thái tải/lỗi/rỗng.
 *  `id?`: dùng chung cho cả Lịch Tải (DbRoute, có `id`) lẫn GSVT (Route thường, không có) —
 *  xem CardRoute trong RouteCard.tsx. */
export function RouteList({
  routes,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  fleet,
  canEdit,
  onSaved,
}: {
  routes: (Route & { id?: string })[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  fleet?: Map<string, Vehicle> | null;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  if (loading && routes.length === 0) {
    return (
      <div className="state">
        <div className="spinner" />
        <div className="big">Đang tải dữ liệu…</div>
        <div>Kết nối Google Sheets thời gian thực</div>
      </div>
    );
  }
  if (error && routes.length === 0) {
    const isPrivate = error === "PRIVATE";
    return (
      <div className="state">
        {isPrivate ? (
          <>
            <div className="big">Google Sheets đang ở chế độ riêng tư</div>
            <div>
              Hãy mở <b>Chia sẻ → "Bất kỳ ai có liên kết" → Người xem</b>.
            </div>
          </>
        ) : (
          <>
            <div className="big">Không tải được dữ liệu</div>
            <div>
              <code>{error}</code>
            </div>
          </>
        )}
        <button className="retry-btn" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    );
  }
  if (routes.length === 0) {
    return (
      <div className="state">
        <div className="big">Không có tuyến phù hợp</div>
        <div>Thử xoá từ khoá tìm kiếm hoặc đổi vùng/loại tuyến.</div>
      </div>
    );
  }
  return (
    <div className="routes">
      {routes.map((r) => (
        <RouteCard
          key={r.id || r.route}
          route={r}
          open={selectedId === r.route}
          onSelect={() => onSelect(r.route)}
          vehicle={fleet?.get(normCode(r.route))}
          canEdit={canEdit}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}
