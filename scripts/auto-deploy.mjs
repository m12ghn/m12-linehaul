/* ============================================================
   AUTO-DEPLOY: theo dõi file nguồn, hễ lưu là tự build + deploy
   lên Cloudflare Pages (m12-lich-tai.pages.dev).
   Chạy:  npm run auto    (giữ cửa sổ này mở; Ctrl+C để tắt)
   - Chỉ deploy khi BUILD THÀNH CÔNG (lỗi build sẽ không đẩy lên live).
   - Gộp nhiều lần lưu liên tiếp (debounce 4 giây) để khỏi deploy dồn.
   ============================================================ */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PROJECT = "m12-lich-tai";
const WATCH_DIRS = ["src", "functions", "public", "scripts"];
const WATCH_FILES = ["index.html", "vite.config.ts", "wrangler.toml", "package.json"];
// Bỏ qua: thư mục build, file sinh tự động (geo.json do prebuild ghi lại mỗi lần
// build → nếu theo dõi sẽ gây vòng lặp deploy vô hạn), và chính script này.
const IGNORE = /node_modules|[\\/]dist[\\/]|\.wrangler|tsbuildinfo|\.git[\\/]|auto-deploy\.mjs|geo\.json/;
const DEBOUNCE_MS = 4000;

const t = () => new Date().toLocaleTimeString("vi-VN");
const log = (...a) => console.log(t(), ...a);

let timer = null;
let running = false;
let pending = false;

function run(cmd, args) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("close", (code) => res(code));
  });
}

async function deploy() {
  if (running) { pending = true; return; }
  running = true;
  log("🔧 Build…");
  const b = await run("npm", ["run", "build"]);
  if (b !== 0) {
    log("❌ Build LỖI — KHÔNG deploy. Sửa lỗi rồi lưu lại là tự chạy tiếp.");
    running = false;
    if (pending) { pending = false; schedule(); }
    return;
  }
  log("🚀 Deploy lên", PROJECT + "…");
  const d = await run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name=" + PROJECT, "--commit-dirty=true"]);
  log(d === 0 ? "✅ Đã đồng bộ → https://" + PROJECT + ".pages.dev/  (Ctrl+F5 để thấy bản mới)" : "❌ Deploy lỗi");
  running = false;
  if (pending) { pending = false; schedule(); }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(deploy, DEBOUNCE_MS);
}

function onChange(file) {
  if (!file || IGNORE.test(file)) return;
  log("✏️  đổi:", file, "→ sẽ build+deploy sau", DEBOUNCE_MS / 1000 + "s");
  schedule();
}

for (const d of WATCH_DIRS) {
  try { watch(path.join(ROOT, d), { recursive: true }, (_e, f) => onChange(f)); } catch { /* thư mục không có -> bỏ */ }
}
watch(ROOT, (_e, f) => { if (WATCH_FILES.includes(f)) onChange(f); });

log("👀 AUTO-DEPLOY đang theo dõi: " + WATCH_DIRS.join(", ") + " + " + WATCH_FILES.join(", "));
log("   Lưu file bất kỳ là tự build + deploy. Đóng cửa sổ hoặc Ctrl+C để tắt.");
