#!/usr/bin/env node
/* ============================================================
   NẠP DỮ LIỆU HIỆN CÓ: Google Sheets  ->  Supabase   (chạy 1 lần khi chuyển đổi)

   Cách chạy:
     export SUPABASE_URL="https://xxxx.supabase.co"
     export SUPABASE_SERVICE_ROLE_KEY="..."
     export DATA_API_TOKEN="..."   # chỉ bước "warehouses" cần (Data API)
     node scripts/import-sheets.mjs                # nạp tất cả
     node scripts/import-sheets.mjs --only=routes  # chỉ 1 phần
     node scripts/import-sheets.mjs --dry          # đọc & in thống kê, KHÔNG ghi

     # Bước "routes": sheet Lịch Tải KHÔNG được phép share ra ngoài tổ chức
     # (đã xác nhận với user 01/09) -> đọc CSV tải tay thay vì gọi mạng:
     node scripts/import-sheets.mjs --only=routes --csv-dir=./nhap-csv --dry

   NGUYÊN TẮC: chạy lại nhiều lần vẫn an toàn (idempotent) — dùng upsert theo
   khoá tự nhiên, không nhân bản dữ liệu. Cứ chạy thử `--dry` trước.

   01/09/2026:
   - Bước "warehouses" đổi nguồn Google Sheet -> GHN Data API (bảng
     iceberg.dwh.dim_warehouse, có sẵn warehouse_id/warehouse_name/lat/long,
     không cần dò khớp tên nữa). Cần DATA_API_TOKEN (lấy token đang set trên
     Vercel → Settings → Environment Variables, cùng token dùng cho
     api/cron/tlld.ts).
   - Các bước "routes"/"vehicles"/"sanluong" đổi cách đọc Sheet: bỏ Sheets
     API v4 (JWT service-account hoặc GOOGLE_API_KEY), đọc thẳng CSV công
     khai qua gviz/export — ĐÚNG 2 nguồn dự phòng #2/#3 mà frontend
     (src/config.ts csvSources()) đã và đang dùng thật cho các sheet này.
     ⚠ Sheet Lịch Tải (bước "routes") hoá ra KHÔNG public như các sheet
     khác — user xác nhận không được phép share ra ngoài tổ chức, gviz/export
     trả 401 khi gọi không có cookie đăng nhập Google. Thêm cờ `--csv-dir=`:
     khi có, bước "routes" đọc file CSV tải TAY từ thư mục đó thay vì gọi
     mạng (xem readGridTuFile() + hướng dẫn đặt tên file bên dưới), KHÔNG
     đụng gì tới bước "vehicles"/"sanluong" (vẫn gọi mạng như cũ, sheet
     khác, chưa gặp lỗi 401).
   ============================================================ */

import { readFileSync } from "node:fs";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Dữ liệu M12 nằm trong schema riêng (dùng chung project Supabase với hệ thống khác).
const SB_SCHEMA = process.env.SUPABASE_SCHEMA || "m12";
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const ACTOR = process.env.IMPORT_ACTOR || "import-script";
// Thư mục chứa CSV tải tay cho bước "routes" (sheet Lịch Tải không public được).
const CSV_DIR = (process.argv.find((a) => a.startsWith("--csv-dir=")) || "").split("=")[1] || "";

// GHN Data API (Trino) — chỉ bước "warehouses" dùng. Cùng base url với api/_lib/tlldQuery.ts.
const DATA_API_TOKEN = process.env.DATA_API_TOKEN;
const DATA_API_BASE = process.env.DATA_API_BASE || "https://data-api-provider.ghn.vn";

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
// 01/09/2026: KHÔNG còn dùng — bước "warehouses" đổi sang đọc Data API
// (iceberg.dwh.dim_warehouse, xem dataApiQuery()/importWarehouses() bên dưới).
// Giữ lại 2 hằng số để còn đối chiếu/rollback nếu Data API có vấn đề.
const WAREHOUSE_GEO_SHEET_ID = "1lqkSifW2ROTnlYMqhBNcKgHgDd5z-ktcn60cCawqyRs";
const WAREHOUSE_GEO_GID = "0";
const BC_LAY_GID = "266027908";

// ---------- GHN Data API (Trino SQL over HTTP) — chỉ bước "warehouses" dùng ----------
// BẢN SAO rút gọn của chayQuery() trong api/_lib/tlldQuery.ts (không import được
// từ đây vì file đó là .ts, còn script này chạy thẳng bằng node, không qua build).
// Sửa logic poll/backoff ở 1 bên thì nhớ soát lại bên kia — cùng rủi ro lệch bản
// như normalize.ts/build-geo.mjs đã ghi trong quy tắc dự án.
async function dataApiQuery(sql) {
  if (!DATA_API_TOKEN) throw new Error("Thiếu DATA_API_TOKEN");
  const H = { authorization: "Bearer " + DATA_API_TOKEN, "content-type": "application/json" };
  const ngu = (ms) => new Promise((r) => setTimeout(r, ms));

  const post = async () => {
    const r = await fetch(DATA_API_BASE + "/api/v1/queries", {
      method: "POST", headers: H, body: JSON.stringify({ sql }),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`data_api_${r.status}: ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : {};
  };
  const next = async (qid) => {
    let cho = 100;
    for (let lan = 0; lan < 4; lan++) {
      const r = await fetch(`${DATA_API_BASE}/api/v1/queries/${encodeURIComponent(qid)}/next`, { headers: H });
      if (r.ok) { const txt = await r.text(); return txt ? JSON.parse(txt) : {}; }
      const txt = (await r.text()).slice(0, 300);
      if (r.status === 503 || r.status === 409) { await ngu(cho); cho *= 2; continue; }
      if (r.status === 410) throw new Error("data_api_410_query_het_han: " + txt);
      throw new Error(`data_api_${r.status}: ${txt}`);
    }
    throw new Error("data_api_503_thu_lai_4_lan_van_ban");
  };

  let cols = [];
  const napCols = (r) => {
    const s = (r?.schema || []).map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean);
    if (s.length) cols = s;
  };

  let res = await post();
  const qid = res.queryId;
  napCols(res);
  const gom = [...(res.rows || [])];

  let soLanPoll = 0;
  while (res.hasMore && qid && soLanPoll < 2000) {
    const dangTinh = !(res.rows || []).length;
    await ngu(dangTinh ? 10_000 : 150);
    soLanPoll++;
    res = await next(qid);
    napCols(res);
    gom.push(...(res.rows || []));
  }

  const kieuMang = gom.length > 0 && Array.isArray(gom[0]);
  if (kieuMang && !cols.length) {
    throw new Error(`data_api_khong_co_schema: nhận ${gom.length} dòng kiểu mảng nhưng không có tên cột`);
  }
  return gom.map((r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r));
}

// ---------- Google Sheets: đọc CSV công khai (KHÔNG cần API key/service account) ----------
// 01/09/2026: trước đây gọi Sheets API v4 (JWT service-account hoặc GOOGLE_API_KEY).
// Đổi sang đọc thẳng 2 nguồn dự phòng #2/#3 mà frontend đã dùng thật cho ĐÚNG các
// sheet này từ trước tới giờ (xem csvSources()/csvSourcesByName() trong
// src/config.ts — nguồn #1 ở đó là proxy /api/sheet-v4, chỉ gọi được từ trình
// duyệt qua domain Vercel nên bỏ qua ở đây). Các sheet đã public dạng "ai có
// link cũng xem được", nên gviz/export đọc thẳng không cần đăng nhập gì cả.

/* Parser CSV — BẢN SAO của parseCSV() trong src/lib/csv.ts, giữ đồng bộ. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* bỏ qua */ }
      else field += c;
    }
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Đọc toàn bộ 1 tab (theo gid) -> mảng 2 chiều chuỗi, thử gviz rồi export?format=csv. */
async function readGrid(sheetId, gid) {
  const nguon = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
  ];
  let loiCuoi = null;
  for (const url of nguon) {
    try {
      const r = await fetch(url);
      if (!r.ok) { loiCuoi = new Error(`http_${r.status}`); continue; }
      const text = await r.text();
      // Sheet riêng tư / gid sai -> Google trả trang HTML (đăng nhập/lỗi) thay vì CSV.
      if (/^\s*<(!doctype|html)/i.test(text)) { loiCuoi = new Error("tra_ve_html_khong_phai_csv"); continue; }
      return parseCSV(text);
    } catch (e) { loiCuoi = e; }
  }
  throw new Error(`doc_sheet_csv_that_bai id=${sheetId} gid=${gid}: ${loiCuoi?.message || loiCuoi}`);
}

/**
 * Đọc 1 tab từ file CSV tải TAY (dùng khi sheet không được phép share ra
 * ngoài tổ chức, gviz/export trả 401 — trường hợp sheet Lịch Tải, 01/09).
 * Tên file PHẢI đúng `<key vùng>.csv`, đặt trong thư mục truyền qua --csv-dir=.
 * Cách lấy: mở sheet trên trình duyệt (đã đăng nhập sẵn) -> bấm từng tab ->
 * nhìn URL có "#gid=<số>" để biết đang ở tab nào (khớp bảng REGIONS bên dưới)
 * -> File > Download > Comma Separated Values (.csv) -> đổi tên file đúng key.
 */
function readGridTuFile(key) {
  const path = `${CSV_DIR.replace(/\/+$/, "")}/${key}.csv`;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`khong_doc_duoc_file_csv ${path}: ${e.message}`);
  }
  return parseCSV(text);
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

// Số thô từ Data API (JSON number hoặc chuỗi số thuần) — KHÔNG dùng num() ở dưới
// cho lat/lng: num() có bước bóc dấu "." ngăn cách nghìn kiểu Sheet VN, dễ ăn
// nhầm toạ độ dạng "10.777" (đúng 3 số lẻ) thành 10777. Data API trả số thật,
// không có dấu ngăn cách nghìn, nên parse thẳng là đủ và an toàn hơn.
const soDataApi = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

async function importWarehouses() {
  console.log("\n▸ Kho / bưu cục + toạ độ (Data API — iceberg.dwh.dim_warehouse)");
  const raw = await dataApiQuery(
    "SELECT warehouse_id, warehouse_name, latitude, longitude FROM iceberg.dwh.dim_warehouse"
  );
  const seen = new Set();
  const rows = [];
  for (const r of raw) {
    const wid = r.warehouse_id === null || r.warehouse_id === undefined ? null : String(r.warehouse_id).trim();
    const name = String(r.warehouse_name || "").trim();
    if (!wid || !name) continue;
    if (seen.has(wid)) continue;      // đề phòng Data API trả trùng dòng
    seen.add(wid);
    rows.push({
      warehouse_id: wid, name,
      lat: soDataApi(r.latitude), lng: soDataApi(r.longitude),
    });
  }
  console.log(`   đọc ${rows.length} kho`);
  await sbWrite("warehouses", rows, "warehouse_id");
  return rows.length;
}

async function importRoutes() {
  console.log(
    "\n▸ Lịch tải: tuyến + điểm dừng" + (CSV_DIR ? ` (đọc CSV tải tay từ ${CSV_DIR})` : "")
  );
  // Bản đồ tên kho -> id, để gán warehouse_id cho từng điểm dừng ngay lúc nạp.
  const whs = await sbSelect("warehouses", "select=id,name_norm&limit=10000");
  const whByNorm = new Map(whs.map((w) => [w.name_norm, w.id]));
  const normName = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

  let totalRoutes = 0, totalStops = 0, unmatched = new Set();

  for (const reg of REGIONS) {
    const grid = CSV_DIR ? readGridTuFile(reg.key) : await readGrid(SHEET_ID, reg.gid);
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
