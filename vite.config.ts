import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// process do Node cấp lúc chạy; khai báo tối thiểu để khỏi cần @types/node.
declare const process: { env: Record<string, string | undefined> };

// Mã BẢN BUILD (đổi mỗi lần build) -> nhúng vào app (__BUILD_ID__) và ghi ra /version.json.
// Client so 2 giá trị này; khác nhau = có bản deploy mới -> tự tải lại trang.
const BUILD_ID = Date.now().toString(36);

// Ghi dist/version.json = { id: BUILD_ID } (không cần fs -> dùng emitFile của Rollup).
const versionPlugin: Plugin = {
  name: "emit-version",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID }) });
  },
};

// Cấu hình build chuẩn production cho SPA.
export default defineConfig({
  plugins: [react(), versionPlugin],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    // Dùng cổng do harness cấp qua biến PORT (tránh trùng với dev server chat khác);
    // không có thì về 5180, kẹt thì tự nhảy cổng kế.
    port: Number(process.env.PORT) || 5180,
    strictPort: false,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
