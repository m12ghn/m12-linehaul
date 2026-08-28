/* Gọi API sửa Lịch Tải trực tiếp trên dash -> ghi ngược vào Google Sheet gốc.
   Xem thiết kế đầy đủ ở functions/api/lichtai-edit.ts + functions/api/_gsheets.ts.
   CHỈ admin mới gọi được (server tự chặn lại lần nữa, đây chỉ là phía hiển thị). */
import { adminHeaders } from "./useUser";

export type EditScope = "stop" | "route";
export type EditField = "loaiHinh" | "toi" | "roi" | "load" | "ncc" | "bks";

export interface StopMatch { kho: string; loaiHinh: string; toi: string; roi: string; id: string }

export interface SaveCellArgs {
  gid: string;
  route: string;
  scope: EditScope;
  field: EditField;
  value: string;
  oldValue: string;
  match?: StopMatch;
  force?: boolean;
}

export type SaveResult =
  | { ok: true; updated: number }
  | { ok: false; error: string; current?: string; values?: string[] };

export async function saveCell(a: SaveCellArgs): Promise<SaveResult> {
  try {
    const r = await fetch("/api/lichtai-edit", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action: "save", ...a }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (d?.ok) return { ok: true, updated: d.updated ?? 0 };
    return { ok: false, error: d?.error || "network", current: d?.current, values: d?.values };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Câu tiếng Việt hiển thị cho Sếp theo mã lỗi trả về từ server. */
export function editErrorText(e: string, extra?: { current?: string; values?: string[] }): string {
  switch (e) {
    case "unauthorized": return "Phiên đăng nhập đã hết hạn. Đăng nhập lại giúp em.";
    case "forbidden": return "Bạn không có quyền sửa Lịch Tải.";
    case "row_not_found": return "Dòng này đã thay đổi trên Sheet. Đang tải lại…";
    case "conflict": return `Người khác vừa sửa thành «${extra?.current ?? "?"}». Ghi đè?`;
    case "inconsistent": return `Các dòng trùng đang khác nhau (${(extra?.values || []).join(" / ")}). Ghi đè tất cả?`;
    case "invalid_value": return "Giá trị không hợp lệ.";
    case "field_not_allowed": return "Không được sửa cột này.";
    case "gid_not_allowed": return "Vùng không hợp lệ.";
    case "route_unnamed": return "Tuyến chưa có tên — không sửa được.";
    case "not_configured": return "Chưa cấu hình tài khoản ghi Sheet.";
    case "google_error": return "Không ghi được vào Google Sheet.";
    case "network": return "Lỗi kết nối, thử lại giúp em.";
    default: return "Không lưu được, thử lại giúp em.";
  }
}

/** Lỗi cần hỏi Sếp "Ghi đè?" thay vì chỉ báo lỗi suông. */
export function isOverwritable(e: string): boolean {
  return e === "conflict" || e === "inconsistent";
}
