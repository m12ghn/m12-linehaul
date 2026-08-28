#!/usr/bin/env node
/* ============================================================
   NẠP DỮ LIỆU HIỆN CÓ: Google Sheets  ->  Supabase   (chạy 1 lần khi chuyển đổi)

   Cách chạy:
     export SUPABASE_URL="https://xxxx.supabase.co"
     export SUPABASE_SERVICE_ROLE_KEY="..."
     export GSHEETS_SA_B64="$(base64 -w0 service-account.json)"   # hoặc GOOGLE_API_KEY
     node scripts/import-sheets.mjs                # nạp tất cả
     node scripts/import-sheets.mjs --only=routes  # chỉ 1 phần
     node scripts/import-sheets.mjs --dry          # đọc & in thống kê, KHÔNG ghi

   NGUYÊN TẮC: chạy lại nhiều lần vẫn an toàn (idempotent) — dùng upsert theo
   khoá tự nhiên, không nhân bản dữ liệu. Cứ chạy thử `--dry` trước.
   ============================================================ */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Dữ liệu M12 nằm trong schema riêng (dùng chung project Supabase với hệ thống khác).
const SB_SCHEMA = process.env.SUPABASE_SCHEMA || "m12";
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const ACTOR = process.env.IMPORT_ACTOR || "import-script";

if (!DRY && (!SB_URL || !SB_KEY)) {
  console.error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ---------- CẤU HÌNH NGUỒN (chép từ src/config.ts — sửa ở đây nếu sheet đổi) ----------
const SHEET_ID = "1M_yoD-7FPwmE_TjgoPklgysfiBA2Vhy7n3JZ3peC8ZI";
const REGIONS = [
  { key: "noi-thanh-hcm",    gid: "0" },
  { key: "noi-vung-hcm",     gid: "961518640" },
  { key: "lien-vung-mn",     gid: "84848529" },
  { key: "mbh-song-than",    gid: "541305122" },
  { key: "mbh-tan-tao",      gid: "1937583700" },
  { key: "mbh-tan-thuan-q7", gid: "722712650" },
];
const TLLD_SHEET_ID = "1VfkJ6HOzCbidoCGqNTnU2Qs2nNMxwkKJw2_gKTSSchM";
const TLLD_TABS = [
  { gid: "1276580053", hub: "HCM01" },
  { gid: "1306265684", hub: "HCM20" },
  { gid: "294568716",  hub: "Sóng Thần" },
  { gid: "1240709030", hub: "Tân Tạo" },
];
const VEHICLE_SHEET_ID = "1YBnuXDh6pZEQ0DpfLCPYV1jNK6J4CtocuP7FM1VeOxc";
const VEHICLE_TABS = ["555582603", "363552999", "570963534", "1947785067"];
const WAREHOUSE_GEO_SHEET_ID = "1lqkSifW2ROTnlYMqhBNcKgHgDd5z-ktcn60cCawqyRs";
const WAREHOUSE_GEO_GID = "0";
const BC_LAY_GID = "266027908";

// ---------- Google Sheets: lấy access token từ service account ----------
let cachedToken = null;
async function googleToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const b64 = process.env.GSHEETS_SA_B64;
  if (!b64) return null;
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const { createSign } = await import("node:crypto");
  const iat = Math.floor(Date.now() / 1000);
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
  });
  const sig = createSign("RSA-SHA256").update(input).end().sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")
        + "&assertion=" + encodeURIComponent(input + "." + sig),
  });
  if (!r.ok) throw new Error("google_token_failed: " + (await r.text()).slice(0, 200));
  const d = await r.json();
  cachedToken = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return cachedToken.token;
}

/** Tên tab theo gid (Sheets API cần TÊN, không nhận gid). */
const tabCache = new Map();
async function tabName(sheetId, gid) {
  const k = sheetId + ":" + gid;
  if (tabCache.has(k)) return tabCache.get(k);
  const token = await googleToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`
            + (token ? "" : `&key=${process.env.GOOGLE_API_KEY}`);
  const r = await fetch(url, token ? { headers: { authorization: "Bearer " + token } } : {});
  if (!r.ok) throw new Error("meta_failed " + r.status + " " + (await r.text()).slice(0, 200));
  const d = await r.json();
  for (const s of d.sheets || []) tabCache.set(sheetId + ":" + s.properties.sheetId, s.properties.title);
  return tabCache.get(k);
}

/** Đọc toàn bộ 1 tab -> mảng 2 chiều chuỗi. */
async function readGrid(sheetId, gid) {
  const title = await tabName(sheetId, gid);
  if (!title) throw new Error("gid_not_found " + gid);
  const token = await googleToken();
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`
            + `?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`
            + (token ? "" : `&key=${process.env.GOOGLE_API_KEY}`);
  const r = await fetch(url, token ? { headers: { authorization: "Bearer " + token } } : {});
  if (!r.ok) throw new Error("read_failed " + r.status + " " + (await r.text()).slice(0, 200));
  return (await r.json()).values || [];
}

// ---------- Supabase ----------
async function sbWrite(table, rows, onConflict) {
  if (!rows.length) return 0;
  if (DRY) return rows.length;
  let done = 0;
  // Chia lô 500 dòng — tránh payload quá lớn và dễ khoanh vùng khi lỗi.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const url = SB_URL + "/rest/v1/" + table + (onConflict ? "?on_conflict=" + encodeURIComponent(onConflict) : "");
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SB_KEY, authorization: "Bearer " + SB_KEY,
        "content-type": "application/json",
        "content-profile": SB_SCHEMA,   // ghi -> Content-Profile
        "x-actor": ACTOR,
        prefer: onConflict ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`ghi ${table} lỗi ${r.status}: ${(await r.text()).slice(0, 300)}`);
    done += chunk.length;
    process.stdout.write(`\r   ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write("\n");
  return done;
}

async function sbSelect(table, query) {
  if (DRY) return [];
  const r = await fetch(SB_URL + "/rest/v1/" + table + "?" + query, {
    headers: { apikey: SB_KEY, authorization: "Bearer " + SB_KEY, "accept-profile": SB_SCHEMA },
  });
  if (!r.ok) throw new Error(`đọc ${table} lỗi ${r.status}`);
  return r.json();
}

// ---------- tiện ích phân tích bảng ----------
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

/** Dò cột theo từ khoá — BẢN SAO findCol() của src/lib/csv.ts, giữ đồng bộ. */
function findCol(header, keys) {
  const h = header.map(norm);
  for (const kw of keys) {
    const k = norm(kw);
    let i = h.findIndex((x) => x === k);
    if (i >= 0) return i;
    i = h.findIndex((x) => x.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

const cell = (row, i) => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");

function cleanBks(s) {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}

/** Dò dòng tiêu đề trong 10 dòng đầu (bố cục 6 tab hơi khác nhau). */
function findHeaderRow(grid) {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const H = grid[i] || [];
    let hit = 0;
    for (const k of [["ten tuyen", "ma tuyen"], ["ten kho", "kho"], ["loai hinh"], ["toi diem", "gio toi"], ["roi diem", "gio roi"]]) {
      if (findCol(H, k) >= 0) hit++;
    }
    if (hit >= 3) return i;
  }
  return 0;
}

/** "12/8/2026", "2026-08-12", "12-08-2026" -> "2026-08-12"; không đọc được -> null. */
function toDate(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const num = (s) => {
  const v = parseFloat(String(s || "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

const normTime = (s) => {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};

// ============================================================
// CÁC BƯỚC NẠP
// ============================================================

async function importWarehouses() {
  console.log("\n▸ Kho / bưu cục + toạ độ");
  const grid = await readGrid(WAREHOUSE_GEO_SHEET_ID, WAREHOUSE_GEO_GID);
  const H = grid[0] || [];
  const c = {
    id: findCol(H, ["warehouse_id", "ma kho"]),
    name: findCol(H, ["warehouse_name", "ten kho"]),
    district: findCol(H, ["district_name", "quan huyen"]),
    province: findCol(H, ["province_name", "tinh"]),
    lat: findCol(H, ["latitude", "lat"]),
    lng: findCol(H, ["longitude", "lng", "long"]),
  };
  const seen = new Set();
  const rows = [];
  for (const r of grid.slice(1)) {
    const name = cell(r, c.name);
    if (!name) continue;
    const wid = cell(r, c.id) || null;
    const key = wid || name.toLowerCase();
    if (seen.has(key)) continue;      // sheet toàn quốc có dòng lặp
    seen.add(key);
    rows.push({
      warehouse_id: wid, name,
      district_name: cell(r, c.district) || null,
      province_name: cell(r, c.province) || null,
      lat: num(cell(r, c.lat)), lng: num(cell(r, c.lng)),
    });
  }
  console.log(`   đọc ${rows.length} kho`);
  // warehouse_id có thể null -> chỉ upsert nhóm có mã, nhóm còn lại chèn mới nếu chưa có.
  await sbWrite("warehouses", rows.filter((x) => x.warehouse_id), "warehouse_id");
  const noId = rows.filter((x) => !x.warehouse_id);
  if (noId.length) {
    const have = new Set((await sbSelect("warehouses", "select=name")).map((x) => x.name));
    await sbWrite("warehouses", noId.filter((x) => !have.has(x.name)));
  }
  return rows.length;
}

async function importRoutes() {
  console.log("\n▸ Lịch tải: tuyến + điểm dừng");
  // Bản đồ tên kho -> id, để gán warehouse_id cho từng điểm dừng ngay lúc nạp.
  const whs = await sbSelect("warehouses", "select=id,name_norm&limit=10000");
  const whByNorm = new Map(whs.map((w) => [w.name_norm, w.id]));
  const normName = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

  let totalRoutes = 0, totalStops = 0, unmatched = new Set();

  for (const reg of REGIONS) {
    const grid = await readGrid(SHEET_ID, reg.gid);
    const h = findHeaderRow(grid);
    const H = grid[h] || [];
    const c = {
      route: (() => { const i = findCol(H, ["ten tuyen", "ma tuyen"]); return i >= 0 ? i : 0; })(),
      load: findCol(H, ["tai trong", "trong tai"]),
      cat: findCol(H, ["loai tuyen"]),
      ncc: findCol(H, ["ncc"]),
      bks: findCol(H, ["bks", "bien so"]),
      kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
      lh: findCol(H, ["loai hinh"]),
      toi: findCol(H, ["toi diem", "gio toi", "gio den"]),
      roi: findCol(H, ["roi diem", "gio roi", "gio di"]),
      id: findCol(H, ["id"]),
    };

    // Gom nhiều dòng cùng "Tên tuyến" thành 1 tuyến (đúng logic src/lib/sheet.ts).
    const byCode = new Map();
    for (const r of grid.slice(h + 1)) {
      const code = cell(r, c.route);
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, {
          region_key: reg.key, code,
          category: cell(r, c.cat) || null,
          load: cell(r, c.load) || null,
          ncc: cell(r, c.ncc) || null,
          bks: cleanBks(cell(r, c.bks)) || null,
          sort: byCode.size,
          _stops: [],
        });
      }
      const t = byCode.get(code);
      // Cột phạm vi TUYẾN: lấy giá trị KHÔNG RỖNG đầu tiên (Sheet chỉ điền ở dòng đầu).
      for (const [k, idx, fn] of [["load", c.load, (v) => v], ["ncc", c.ncc, (v) => v],
                                  ["bks", c.bks, cleanBks], ["category", c.cat, (v) => v]]) {
        if (!t[k]) { const v = cell(r, idx); if (v) t[k] = fn(v); }
      }
      const kho = cell(r, c.kho);
      if (kho) {
        t._stops.push({
          seq: t._stops.length + 1, kho,
          loai_hinh: cell(r, c.lh) || null,
          toi: normTime(cell(r, c.toi)),
          roi: normTime(cell(r, c.roi)),
          ext_id: cell(r, c.id) || null,
        });
      }
    }

    const routes = [...byCode.values()];
    console.log(`   ${reg.key}: ${routes.length} tuyến, ${routes.reduce((s, r) => s + r._stops.length, 0)} điểm dừng`);
    await sbWrite("routes", routes.map(({ _stops, ...r }) => r), "region_key,code");

    // Lấy lại id tuyến vừa ghi để gắn điểm dừng.
    if (!DRY) {
      const saved = await sbSelect("routes", `select=id,code&region_key=eq.${encodeURIComponent(reg.key)}&limit=5000`);
      const idByCode = new Map(saved.map((r) => [r.code, r.id]));
      const stopRows = [];
      for (const t of routes) {
        const rid = idByCode.get(t.code);
        if (!rid) continue;
        for (const s of t._stops) {
          const wid = whByNorm.get(normName(s.kho)) || null;
          if (!wid) unmatched.add(s.kho);
          stopRows.push({ ...s, route_id: rid, warehouse_id: wid });
        }
      }
      // Nạp lại = thay toàn bộ điểm dừng của vùng này (tránh nhân đôi khi chạy lần 2).
      for (const rid of idByCode.values()) {
        await fetch(`${SB_URL}/rest/v1/stops?route_id=eq.${rid}`, {
          method: "DELETE",
          headers: {
            apikey: SB_KEY, authorization: "Bearer " + SB_KEY,
            "content-profile": SB_SCHEMA, "x-actor": ACTOR,
          },
        });
      }
      await sbWrite("stops", stopRows);
      totalStops += stopRows.length;
    }
    totalRoutes += routes.length;
  }

  if (unmatched.size) {
    console.log(`   ⚠ ${unmatched.size} tên kho chưa khớp toạ độ — thêm bí danh vào bảng warehouse_aliases:`);
    console.log("     " + [...unmatched].slice(0, 15).join(" | ") + (unmatched.size > 15 ? " …" : ""));
  }
  return { totalRoutes, totalStops };
}

async function importTlld() {
  console.log("\n▸ TLLD (tỷ lệ lấp đầy)");
  const rows = [];
  for (const t of TLLD_TABS) {
    const grid = await readGrid(TLLD_SHEET_ID, t.gid);
    // Bố cục cố định theo config cũ: cột 0 = ngày, 3 = mã tuyến, 10 = tlld_weight.
    for (const r of grid.slice(1)) {
      const ngay = toDate(cell(r, 0));
      const code = cell(r, 3);
      if (!ngay || !code) continue;
      const w = num(cell(r, 10));
      rows.push({
        ngay, hub: t.hub, route_code: code,
        tlld_weight: w == null ? null : (w > 1.5 ? w / 100 : w),   // sheet có chỗ ghi % , chỗ ghi tỷ lệ
        source: "etl",
      });
    }
    console.log(`   ${t.hub}: ${rows.length} dòng luỹ kế`);
  }
  await sbWrite("tlld_daily", rows, "ngay,hub,route_code");
  return rows.length;
}

async function importVehicles() {
  console.log("\n▸ Thông tin xe (BKS / tài xế / SĐT)");
  const rows = [];
  for (const gid of VEHICLE_TABS) {
    let grid;
    try { grid = await readGrid(VEHICLE_SHEET_ID, gid); }
    catch (e) { console.log(`   bỏ qua gid ${gid}: ${e.message}`); continue; }
    const h = findHeaderRow(grid);
    const H = grid[h] || [];
    const c = {
      route: (() => { const i = findCol(H, ["ten tuyen", "ma tuyen"]); return i >= 0 ? i : 0; })(),
      bks: findCol(H, ["bks", "bien so"]),
      driver: findCol(H, ["tai xe", "lai xe", "ho ten"]),
      phone: findCol(H, ["sdt", "so dien thoai", "dien thoai"]),
    };
    for (const r of grid.slice(h + 1)) {
      const code = cell(r, c.route);
      const bks = cleanBks(cell(r, c.bks));
      if (!code || !bks) continue;
      rows.push({ route_code: code, bks, driver: cell(r, c.driver) || null, phone: cell(r, c.phone) || null, source: "dieu-phoi" });
    }
  }
  console.log(`   ${rows.length} dòng xe`);
  await sbWrite("vehicles", rows);
  return rows.length;
}

async function importSanLuong() {
  console.log("\n▸ Sản lượng lấy hàng theo bưu cục");
  const grid = await readGrid(SHEET_ID, BC_LAY_GID);
  const H = grid[0] || [];
  const c = {
    dt: findCol(H, ["dt", "ngay"]),
    wid: findCol(H, ["warehouse_id"]),
    wname: findCol(H, ["warehouse_name"]),
    district: findCol(H, ["district_name"]),
    volume: findCol(H, ["volume"]),
    weight: findCol(H, ["weight_kg", "weight"]),
  };
  const rows = [];
  for (const r of grid.slice(1)) {
    const ngay = toDate(cell(r, c.dt));
    const wid = cell(r, c.wid);
    if (!ngay || !wid) continue;
    rows.push({
      ngay, warehouse_code: wid,
      warehouse_name: cell(r, c.wname) || null,
      district_name: cell(r, c.district) || null,
      category: "1. Lấy hàng",
      volume: num(cell(r, c.volume)), weight_kg: num(cell(r, c.weight)),
    });
  }
  console.log(`   ${rows.length} dòng`);
  await sbWrite("san_luong_bc", rows, "ngay,warehouse_code,category");
  return rows.length;
}

// ============================================================
const STEPS = {
  warehouses: importWarehouses,
  routes: importRoutes,
  tlld: importTlld,
  vehicles: importVehicles,
  sanluong: importSanLuong,
};

(async () => {
  console.log(DRY ? "== CHẾ ĐỘ THỬ (không ghi) ==" : "== NẠP DỮ LIỆU VÀO SUPABASE ==");
  const names = ONLY ? ONLY.split(",") : Object.keys(STEPS);
  for (const n of names) {
    const fn = STEPS[n];
    if (!fn) { console.log(`Bỏ qua bước không rõ: ${n}`); continue; }
    try { await fn(); }
    catch (e) { console.error(`\n✖ Bước "${n}" lỗi: ${e.message}`); process.exitCode = 1; }
  }
  console.log("\nXong.");
})();
