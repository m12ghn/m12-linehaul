---
name: m12-admin-feature
description: Thêm tính năng chỉ dành cho admin (quản trị M12SC) trên m12-lich-tai — ẩn với user thường, cần đăng nhập admin token. Kích hoạt khi user nói "chỉ admin mới thấy", "thêm quyền quản trị", "khoá tính năng X", "chỉ Sếp/M12SC dùng được".
---

# Thêm tính năng admin-only

Đọc [m12-conventions](../m12-conventions/SKILL.md) mục 6 (bảo mật) và skill `m12-create-api-endpoint`
(phần Auth) trước — 2 nơi phải khớp nhau: check ở API (backend) VÀ ẩn UI (frontend), thiếu 1 trong 2 là lỗ hổng.

## Phân biệt 2 tầng quyền (dễ nhầm — đọc kỹ)

| Tầng | Cơ chế | Dùng cho |
|---|---|---|
| **User gate** | Email domain `@ghn.vn`/`@ghn.com`/`@ghn.com.vn`, check bởi `isGhnEmail()` | Vào được dashboard nói chung (`EmailGate.tsx`) — KHÔNG phải quyền admin |
| **Admin** | Đăng nhập `M12SC` + mật khẩu → `x-admin-token` header khớp `env.ADMIN_TOKEN` (secret) | Sửa/xoá dữ liệu chung, tính năng nhạy cảm |

Từ khi sửa bảo mật (xem memory `m12-security-state`): **email GHN không còn tự động là admin** — chỉ token
đúng mới là admin. Đừng lẫn 2 khái niệm này khi viết check quyền mới.

## Phía Frontend — ẩn UI bằng `<AdminGate>`

```tsx
import { AdminGate } from "../components/AdminGate";
import { useAdmin } from "../lib/useAdmin";

function TinhNangMoi() {
  const { isAdmin } = useAdmin(); // đọc trạng thái đã unlock (lưu ở đâu xem useAdmin.ts)
  if (!isAdmin) return <AdminGate title="Tên tính năng" />;
  return <div>{/* nội dung admin */}</div>;
}
```

- `AdminGate` tự xử lý form đăng nhập (`unlockAdmin(user, pw)` gọi `/api/adminlogin`) — không viết lại
  form đăng nhập riêng cho từng tính năng.
- Component/view khác đã dùng pattern này (tham khảo cách `KeyConfig.tsx` — dù chưa gắn vào main UI — dự
  kiến dùng `AdminGate`).

## Phía Backend — check bằng `isAdminReq()`, KHÔNG được bỏ qua

Trong `functions/api/<endpoint>.ts`:
```ts
import { isAdminReq } from "./_admin";

export const onRequestPost = async ({ request, env }: any) => {
  if (!isAdminReq(request, env)) return json({ error: "unauthorized" }, 401);
  // ... logic chỉ admin mới chạy tới đây
};
```

**Quan trọng**: UI ẩn (`AdminGate`) chỉ là trải nghiệm người dùng, KHÔNG phải bảo mật thật — ai cũng có thể
gọi thẳng API bằng curl. Endpoint xử lý dữ liệu nhạy cảm/ghi-xoá dữ liệu chung **luôn luôn** phải tự check
`isAdminReq()` ở phía server, không được tin tưởng rằng "frontend đã ẩn nên an toàn".

## Nếu tính năng cần secret/config riêng

- Secret mới (API key, mật khẩu...) → `npx wrangler pages secret put <TEN> --project-name=m12-lich-tai`,
  đọc qua `env.<TEN>` trong Function. KHÔNG để trong `wrangler.toml [vars]` (plaintext).
- Nếu chỉ là cấu hình không nhạy cảm (như `ADMIN_USER = "M12SC"`) → có thể để trong `[vars]` bình thường.

## Checklist trước khi coi là xong

1. Endpoint backend trả `401` khi gọi không có/token sai — test bằng curl không header, xác nhận bị chặn.
2. UI ẩn hoàn toàn nội dung admin khi chưa đăng nhập (không lộ qua HTML/props ẩn bằng CSS `display:none`
   — phải không render, dùng early-return như ví dụ trên).
3. Sau khi đăng nhập admin, tính năng hoạt động đúng, và trạng thái đăng nhập admin không bị mất khi
   chuyển menu (kiểm tra cách `useAdmin.ts` lưu trạng thái — thường qua localStorage/sessionStorage tương
   tự `usePersistent`).
