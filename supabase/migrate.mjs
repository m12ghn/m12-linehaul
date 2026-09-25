/* ============================================================
   supabase/migrate.mjs — PHA 0: import 1 lần từ TOÀN BỘ Google Sheet
   đang dùng trong src/config.ts -> Supabase (Postgres).

   Chạy:
     1) Dán supabase/schema.sql vào Supabase SQL Editor (1 lần).
     2) Copy .env.example -> .env, điền SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
     3) npm run migrate:supabase

   Kiến trúc 2 lớp (xem thêm supabase/schema.sql):
   - BRONZE: mọi source_key trong SOURCES đều được sao NGUYÊN VĂN vào
     raw_sheet_snapshot, kể cả khi chưa có parser Silver riêng.
   - SILVER: chỉ 4 mảng lõi (routes/route_stops, warehouses, tlld_daily,
     vehicle_assignments) được parse có cấu trúc trong Pha 0. Các nguồn
     khác (GXT, tăng cường, sản lượng, kiến thức, GSVT...) tạm dừng ở
     Bronze — lên Silver ở Pha 1 khi biết chắc UI từng view cần cột gì.

   KHÔNG bịa số liệu: script chỉ SAO CHÉP dữ liệu Sheet, không tính toán
   lại/suy diễn — đúng nguyên tắc cứng của dự án (xem skill m12-conventions).
   ============================================================ */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ---------- Cấu hình Supabase ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("✗ Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (xem supabase/README.md).");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* --- PHẢI khớp logic src/lib/normalize.ts + scripts/build-geo.mjs --- */
function stripAccents(s) {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
function normalizeName(s) {
  let x = stripAccents(s);
  x = x.replace(/^\s*\d{3,}\s*[-_().\s]+/, " ");
  x = x.replace(/[^a-z0-9]+/g, " ");
  return x.replace(/\s+/g, " ").trim();
}
/* --- PHẢI khớp src/lib/csv.ts --- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
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
function findCol(header, keys) {
  const norm = (s) => stripAccents(s || "").trim();
  const h = header.map(norm);
  for (const kw of keys) {
    const k = norm(kw);
    let idx = h.findIndex((x) => x === k);
    if (idx >= 0) return idx;
    idx = h.findIndex((x) => x.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ---------- Tải 1 tab qua gviz (CHỈ dùng được cho sheet công khai "Ai có liên kết") ----------
async function fetchGvizCsv(sheetId, { gid, sheetName }) {
  const q = gid != null ? `gid=${gid}` : `sheet=${encodeURIComponent(sheetName)}`;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${q}&_=${Date.now()}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const head = text.slice(0, 300);
  if (/^\s*<(!doctype html|html)/i.test(head) || /requires you to sign in|Temporarily unavailable/i.test(head)) {
    throw new Error("Sheet riêng tư hoặc bị chặn — cần chia sẻ 'Ai có liên kết → Người xem'");
  }
  return text;
}

// ---------- Google OAuth: 1 nguồn duy nhất KHÔNG public (sheet toạ độ kho) ----------
// Mirror functions/api/geo.ts — sheet này KHÔNG chia sẻ công khai, chỉ đọc được qua OAuth Sheets API.
async function fetchViaOAuth(sheetId, gid) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null; // báo caller tự fallback
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok || !tok.access_token) throw new Error("Google OAuth refresh lỗi: " + JSON.stringify(tok));
  const authHeader = { authorization: "Bearer " + tok.access_token };
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`, { headers: authHeader });
  const meta = await metaRes.json();
  if (!metaRes.ok) throw new Error("Lỗi đọc metadata sheet: HTTP " + metaRes.status);
  const sh = (meta.sheets || []).find((s) => String(s.properties?.sheetId) === String(gid));
  if (!sh) throw new Error("Không tìm thấy gid=" + gid);
  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sh.properties.title)}?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: authHeader },
  );
  const data = await valRes.json();
  if (!valRes.ok) throw new Error("Lỗi đọc dữ liệu sheet: HTTP " + valRes.status);
  return (data.values || []).map((row) => row.map((v) => String(v ?? "")));
}

// ---------- Danh sách nguồn — PHẢI khớp src/config.ts (cập nhật cả 2 nơi nếu đổi ID sheet) ----------
const SHEET_ID = "1M_yoD-7FPwmE_TjgoPklgysfiBA2Vhy7n3JZ3peC8ZI";
const TLLD_SHEET_ID = "1VfkJ6HOzCbidoCGqNTnU2Qs2nNMxwkKJw2_gKTSSchM";
const VEHICLE_SHEET_ID = "1YBnuXDh6pZEQ0DpfLCPYV1jNK6J4CtocuP7FM1VeOxc";
const GXT_SHEET_ID = "1otLFPSLRKtBk-2WXdXnVSHbJMwtIzqMBmJnZ5M7bl7c";
const KNOWLEDGE_SHEET_ID = "1mvu295K_b3AtVkAyNSZKrYHAU-xlp-UyhwZ8CXQUKks";
const WAREHOUSE_GEO_SHEET_ID = "1lqkSifW2ROTnlYMqhBNcKgHgDd5z-ktcn60cCawqyRs";
// Sheet "Lịch tải M12" — nhật ký chuyến THỰC TẾ (KHÁC sheet lịch tải KẾ HOẠCH SHEET_ID ở trên),
// dùng cho báo cáo tự động Telegram — xem functions/api/bao-cao-tudong.ts. Sếp xác nhận 2026-09-25:
// migrate luôn (Bronze — đây vốn là 1 cuốn nhật ký/log, giữ nguyên văn là đủ, chưa cần Silver).
const NHATKY_CHUYEN_SHEET_ID = "1qencarSmiH1-BukeHTTG1MFsbJLBIBDn6drGIhZP-nU";
const NHATKY_CHUYEN_GID = "2119716240";

const SOURCES = [
  // --- Lịch tải (6 tab SHEETS) — silver: routes + route_stops ---
  { key: "routes:noi-thanh-hcm", sheetId: SHEET_ID, gid: "0", silver: "routes", region: "noi-thanh-hcm" },
  { key: "routes:noi-vung-hcm", sheetId: SHEET_ID, gid: "961518640", silver: "routes", region: "noi-vung-hcm" },
  { key: "routes:lien-vung-mn", sheetId: SHEET_ID, gid: "84848529", silver: "routes", region: "lien-vung-mn" },
  { key: "routes:mbh-song-than", sheetId: SHEET_ID, gid: "541305122", silver: "routes", region: "mbh-song-than" },
  { key: "routes:mbh-tan-tao", sheetId: SHEET_ID, gid: "1937583700", silver: "routes", region: "mbh-tan-tao" },
  { key: "routes:mbh-tan-thuan-q7", sheetId: SHEET_ID, gid: "722712650", silver: "routes", region: "mbh-tan-thuan-q7" },

  // --- Toạ độ kho (KHÔNG public — cần OAuth, xem fetchViaOAuth) — silver: warehouses ---
  { key: "warehouses", sheetId: WAREHOUSE_GEO_SHEET_ID, gid: "0", silver: "warehouses", oauthOnly: true },

  // --- Nhật ký chuyến thực tế (KHÔNG public — cần OAuth) — bronze only, xem PHA3-PLAN.md ---
  { key: "nhat-ky-chuyen-thuc-te", sheetId: NHATKY_CHUYEN_SHEET_ID, gid: NHATKY_CHUYEN_GID, oauthOnly: true },

  // --- TLLD (4 tab hub, cấu trúc cố định) — silver: tlld_daily ---
  { key: "tlld:HCM01", sheetId: TLLD_SHEET_ID, gid: "1276580053", silver: "tlld", hub: "HCM01" },
  { key: "tlld:HCM20", sheetId: TLLD_SHEET_ID, gid: "1306265684", silver: "tlld", hub: "HCM20" },
  { key: "tlld:SongThan", sheetId: TLLD_SHEET_ID, gid: "294568716", silver: "tlld", hub: "Sóng Thần" },
  { key: "tlld:TanTao", sheetId: TLLD_SHEET_ID, gid: "1240709030", silver: "tlld", hub: "Tân Tạo" },
  { key: "tlld:tc-event", sheetId: TLLD_SHEET_ID, gid: "15227999" }, // bronze only — cấu trúc pivot khác 4 tab trên

  // --- Xe/tài xế (4 tab) — silver: vehicle_assignments ---
  { key: "vehicles:tai-cam-noi-vung", sheetId: VEHICLE_SHEET_ID, gid: "555582603", silver: "vehicles" },
  { key: "vehicles:lich-moc-20h", sheetId: VEHICLE_SHEET_ID, gid: "363552999", silver: "vehicles" },
  { key: "vehicles:song-than", sheetId: VEHICLE_SHEET_ID, gid: "570963534", silver: "vehicles" },
  { key: "vehicles:tan-tao", sheetId: VEHICLE_SHEET_ID, gid: "1947785067", silver: "vehicles" },

  // --- GXT (bronze only — Pha 1 mới cần parse) ---
  { key: "gxt:huy-2506", sheetId: GXT_SHEET_ID, gid: "901063597" },
  { key: "gxt:huy-2606", sheetId: GXT_SHEET_ID, gid: "787236888" },
  { key: "gxt:thu-duc-nhap", sheetId: GXT_SHEET_ID, gid: "1757305320" },
  { key: "gxt:chi-tu", sheetId: GXT_SHEET_ID, gid: "1892953261" },

  // --- Tăng cường + điều chỉnh NCC (bronze only) ---
  { key: "surge:xin-tc", sheetId: SHEET_ID, gid: "907458113" },
  { key: "surge:tc-event", sheetId: SHEET_ID, gid: "361704153" },
  { key: "surge:tang-cuong-lay-giao", sheetId: SHEET_ID, gid: "414498895" },
  { key: "surge:event-t6", sheetId: SHEET_ID, gid: "587684422" },
  { key: "ncc:dieu-chinh", sheetId: SHEET_ID, gid: "1166787822" },

  // --- Kiến thức bổ sung (bronze only) ---
  { key: "knowledge:0", sheetId: KNOWLEDGE_SHEET_ID, gid: "0" },

  // --- Sản lượng (đọc theo TÊN tab, bronze only) ---
  { key: "sanluong:ktc-hcm20", sheetId: SHEET_ID, sheetName: "SL HCM20" },
  { key: "sanluong:ktc-st", sheetId: SHEET_ID, sheetName: "SL ST" },
  { key: "sanluong:bc-lay", sheetId: SHEET_ID, gid: "266027908" },

  // --- Lịch trực GSVT (đọc theo TÊN tab, bronze only) ---
  { key: "gsvt:roster", sheetId: SHEET_ID, sheetName: "LỊCH TRỰC GSVT" },
];

// ---------- Silver parsers ----------
async function parseRoutes(rows, region, runSummary) {
  const H = rows[0];
  const col = {
    route: (() => { const c = findCol(H, ["ten tuyen", "ma tuyen"]); return c >= 0 ? c : 0; })(),
    load: findCol(H, ["tai trong", "trong tai"]),
    kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
    loaiHinh: findCol(H, ["loai hinh"]),
    toi: findCol(H, ["toi diem", "gio toi", "gio den"]),
    roi: findCol(H, ["roi diem", "gio roi", "gio di"]),
    cat: findCol(H, ["loai tuyen"]),
    id: findCol(H, ["id"]),
    ncc: findCol(H, ["ncc"]),
    bks: findCol(H, ["bks", "bien so"]),
  };
  const g = (r, idx) => (idx >= 0 && idx < r.length ? (r[idx] || "").trim() : "");
  const routeMap = new Map(); // route_name -> { load, category, ncc, bks, stops: [] }
  const dataRows = rows.slice(1);
  dataRows.forEach((r, i) => {
    const routeName = g(r, col.route);
    const kho = g(r, col.kho);
    if (!routeName && !kho) return;
    const key = routeName || "(Không tên)";
    if (!routeMap.has(key)) routeMap.set(key, { load: "", category: "", ncc: "", bks: "", stops: [] });
    const route = routeMap.get(key);
    if (!route.load && g(r, col.load)) route.load = g(r, col.load);
    if (!route.category && g(r, col.cat)) route.category = g(r, col.cat);
    if (!route.ncc && g(r, col.ncc)) route.ncc = g(r, col.ncc);
    if (!route.bks && g(r, col.bks)) route.bks = g(r, col.bks);
    route.stops.push({ warehouse_name: kho, loai_hinh: g(r, col.loaiHinh), gio_toi: g(r, col.toi), gio_roi: g(r, col.roi), sheet_row_id: g(r, col.id), source_row_index: i });
  });

  let stopCount = 0;
  for (const [routeName, route] of routeMap) {
    const { data: up, error: upErr } = await db.from("routes")
      .upsert({ region_key: region, route_name: routeName, load_text: route.load, category: route.category, ncc: route.ncc, bks: route.bks, updated_at: new Date().toISOString() }, { onConflict: "region_key,route_name" })
      .select("id").single();
    if (upErr) { runSummary.errors.push(`routes:${region}/${routeName}: ${upErr.message}`); continue; }
    await db.from("route_stops").delete().eq("route_id", up.id); // xoá bản cũ trước khi ghi lại (import 1 lần, idempotent)
    const stopsPayload = route.stops.map((s) => ({ route_id: up.id, region_key: region, ...s }));
    for (let i = 0; i < stopsPayload.length; i += 500) {
      const { error } = await db.from("route_stops").insert(stopsPayload.slice(i, i + 500));
      if (error) runSummary.errors.push(`route_stops:${region}/${routeName}: ${error.message}`);
      else stopCount += stopsPayload.slice(i, i + 500).length;
    }
  }
  return { routeCount: routeMap.size, stopCount };
}

async function parseWarehouses(rows, runSummary) {
  const H = rows[0];
  const col = { id: findCol(H, ["warehouse_id"]), name: findCol(H, ["warehouse_name"]), district: findCol(H, ["district_name"]), lat: findCol(H, ["latitude"]), lng: findCol(H, ["longitude"]) };
  if (col.name < 0 || col.lat < 0 || col.lng < 0) { runSummary.errors.push("warehouses: không tìm thấy cột warehouse_name/latitude/longitude"); return { count: 0 }; }
  const payload = [];
  for (const r of rows.slice(1)) {
    const name = (r[col.name] || "").trim();
    const lat = parseFloat(r[col.lat]);
    const lng = parseFloat(r[col.lng]);
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    payload.push({
      warehouse_id: col.id >= 0 ? (r[col.id] || "").trim() : null,
      warehouse_name: name,
      normalized_name: normalizeName(name),
      district_name: col.district >= 0 ? (r[col.district] || "").trim() : null,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      updated_at: new Date().toISOString(),
    });
  }
  let count = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db.from("warehouses").upsert(payload.slice(i, i + 500), { onConflict: "normalized_name" });
    if (error) runSummary.errors.push(`warehouses: ${error.message}`);
    else count += payload.slice(i, i + 500).length;
  }
  return { count };
}

// Cấu trúc CỐ ĐỊNH theo comment gốc config.ts: cột 0=ngày, 3=mã tuyến, 10=tlld_weight.
async function parseTlld(rows, hub, runSummary) {
  const payload = [];
  for (const r of rows.slice(1)) {
    const dt = (r[0] || "").trim();
    const routeCode = (r[3] || "").trim();
    const w = parseFloat(r[10]);
    if (!dt || !routeCode || Number.isNaN(w)) continue;
    const iso = toIsoDate(dt);
    if (!iso) continue;
    payload.push({ dt: iso, route_code: routeCode, hub, tlld_weight: w });
  }
  let count = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db.from("tlld_daily").upsert(payload.slice(i, i + 500), { onConflict: "dt,route_code,hub" });
    if (error) runSummary.errors.push(`tlld:${hub}: ${error.message}`);
    else count += payload.slice(i, i + 500).length;
  }
  return { count };
}
function toIsoDate(s) {
  // Sheet có thể trả "dd/mm/yyyy" hoặc "yyyy-mm-dd" tuỳ định dạng cột — thử cả 2, KHÔNG đoán khi mơ hồ.
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

async function parseVehicles(rows, sourceKey, runSummary) {
  const H = rows[0];
  const col = {
    route: findCol(H, ["ma tuyen", "ten tuyen"]),
    bks: findCol(H, ["bks", "bien so"]),
    phone: findCol(H, ["sdt", "so dien thoai", "dien thoai"]),
    driver: findCol(H, ["tai xe", "ho ten"]),
  };
  if (col.route < 0 || col.bks < 0) { runSummary.errors.push(`${sourceKey}: không tìm thấy cột mã tuyến/BKS — bỏ qua silver`); return { count: 0 }; }
  const payload = [];
  for (const r of rows.slice(1)) {
    const routeCode = (r[col.route] || "").trim();
    const plate = col.bks >= 0 ? (r[col.bks] || "").trim() : "";
    if (!routeCode || !plate) continue;
    payload.push({ route_code: routeCode, plate_number: plate, driver_name: col.driver >= 0 ? (r[col.driver] || "").trim() : null, driver_phone: col.phone >= 0 ? (r[col.phone] || "").trim() : null, tab_source: sourceKey });
  }
  let count = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db.from("vehicle_assignments").insert(payload.slice(i, i + 500));
    if (error) runSummary.errors.push(`${sourceKey}: ${error.message}`);
    else count += payload.slice(i, i + 500).length;
  }
  return { count };
}

// ---------- Main ----------
async function main() {
  const runId = randomUUID();
  console.log(`→ Bắt đầu migrate (run_id=${runId})\n`);
  await db.from("migration_runs").insert({ run_id: runId, summary: {} });

  const summaryRows = [];

  // Xoá dữ liệu Silver cũ của vehicle_assignments 1 lần đầu run (bảng này không có unique key để upsert —
  // import 1 lần thì xoá sạch trước khi nạp lại, tránh nhân đôi nếu chạy script 2 lần).
  await db.from("vehicle_assignments").delete().neq("id", 0);

  for (const src of SOURCES) {
    const runSummary = { errors: [] };
    let rows = null;
    let fetchError = null;
    let header = [];

    try {
      if (src.oauthOnly) {
        const values = await fetchViaOAuth(src.sheetId, src.gid);
        if (!values) {
          fetchError = "Thiếu GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN trong .env — bỏ qua nguồn cần OAuth (xem supabase/README.md).";
        } else {
          rows = values;
        }
      } else {
        const csv = await fetchGvizCsv(src.sheetId, { gid: src.gid, sheetName: src.sheetName });
        rows = parseCSV(csv);
      }
    } catch (e) {
      fetchError = e.message || String(e);
    }

    if (fetchError) {
      console.log(`✗ ${src.key}: ${fetchError}`);
      await db.from("raw_sheet_snapshot").insert({ run_id: runId, source_key: src.key, sheet_id: src.sheetId, gid: src.gid ?? null, sheet_name: src.sheetName ?? null, fetch_error: fetchError });
      summaryRows.push({ source: src.key, sheetRows: 0, silver: "-", silverCount: 0, note: fetchError });
      continue;
    }

    header = rows[0] || [];
    const dataRowCount = Math.max(0, rows.length - 1);

    // BRONZE — luôn ghi, kể cả nguồn chưa có parser Silver.
    const { error: snapErr } = await db.from("raw_sheet_snapshot").insert({
      run_id: runId, source_key: src.key, sheet_id: src.sheetId, gid: src.gid ?? null, sheet_name: src.sheetName ?? null,
      header, rows: rows.slice(1), row_count: dataRowCount,
    });
    if (snapErr) console.log(`  (bronze lỗi ghi ${src.key}: ${snapErr.message})`);

    // SILVER — chỉ 4 mảng lõi.
    let silverCount = 0, silverLabel = "-";
    if (rows.length >= 2) {
      if (src.silver === "routes") { const r = await parseRoutes(rows, src.region, runSummary); silverCount = r.stopCount; silverLabel = `routes(${r.routeCount})+stops`; }
      else if (src.silver === "warehouses") { const r = await parseWarehouses(rows, runSummary); silverCount = r.count; silverLabel = "warehouses"; }
      else if (src.silver === "tlld") { const r = await parseTlld(rows, src.hub, runSummary); silverCount = r.count; silverLabel = "tlld_daily"; }
      else if (src.silver === "vehicles") { const r = await parseVehicles(rows, src.key, runSummary); silverCount = r.count; silverLabel = "vehicle_assignments"; }
    }

    console.log(`✓ ${src.key}: ${dataRowCount} dòng sheet -> bronze ok${silverLabel !== "-" ? `, silver ${silverLabel}=${silverCount}` : ""}`);
    if (runSummary.errors.length) runSummary.errors.forEach((e) => console.log(`    ⚠ ${e}`));
    summaryRows.push({ source: src.key, sheetRows: dataRowCount, silver: silverLabel, silverCount, note: runSummary.errors.join("; ") });
  }

  await db.from("migration_runs").update({ finished_at: new Date().toISOString(), summary: Object.fromEntries(summaryRows.map((r) => [r.source, r])) }).eq("run_id", runId);

  console.log("\n===== ĐỐI CHIẾU (Pha 0) =====");
  console.table(summaryRows);
  console.log(`\n→ Xong. run_id=${runId} — chi tiết đầy đủ trong bảng migration_runs / raw_sheet_snapshot.`);
  const hardErrors = summaryRows.filter((r) => r.note && r.silver === "-" && r.sheetRows === 0);
  if (hardErrors.length) {
    console.log(`\n⚠ ${hardErrors.length} nguồn KHÔNG fetch được — xem cột "note" ở trên, chạy lại riêng sau khi xử lý (vd cấp quyền OAuth).`);
  }
}

main().catch((e) => {
  console.error("✗ migrate lỗi:", e);
  process.exit(1);
});
