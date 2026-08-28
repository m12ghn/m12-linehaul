/* ============================================================
   build-geo.mjs
   Tải KML của Google MyMap -> trích toạ độ từng Bưu Cục
   -> ghi src/data/geo.json (key = tên đã chuẩn hoá).
   Chạy: npm run build:geo   (chạy lại khi MyMap thay đổi)
   ============================================================ */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MAP_MID = "13GsCLPeCyljbEDsSa05HHy0-trvNAOM";
const SHEET_ID = "1M_yoD-7FPwmE_TjgoPklgysfiBA2Vhy7n3JZ3peC8ZI";
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MAP_MID}&forcekml=1`;

/* --- PHẢI khớp logic src/lib/normalize.ts --- */
function stripAccents(s) {
  return (s || "").toString().toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
function normalizeName(s) {
  let x = stripAccents(s);
  x = x.replace(/^\s*\d{3,}\s*[-_().\s]+/, " ");
  x = x.replace(/[^a-z0-9]+/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
  return res.text();
}

/** Trích các Placemark dạng Point: { name, lat, lng } */
function parseKml(xml) {
  const out = [];
  const blocks = xml.split("<Placemark");
  for (const b of blocks) {
    const nameM = b.match(/<name>([\s\S]*?)<\/name>/);
    const ptM = b.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!nameM || !ptM) continue;
    const name = nameM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const coordStr = ptM[1].trim().split(/\s+/)[0]; // "lng,lat,alt"
    const [lng, lat] = coordStr.split(",").map(Number);
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    out.push({ name, lat, lng });
  }
  return out;
}

async function main() {
  console.log("→ Tải KML từ MyMap…");
  const kml = await get(KML_URL);
  console.log(`  KML ${(kml.length / 1024 / 1024).toFixed(1)} MB`);

  const places = parseKml(kml);
  console.log(`→ Trích ${places.length} điểm có toạ độ.`);

  // Gom theo tên chuẩn hoá (điểm trùng tên giữ điểm đầu)
  const geo = {};
  let dup = 0;
  for (const p of places) {
    const key = normalizeName(p.name);
    if (!key) continue;
    if (geo[key]) { dup++; continue; }
    geo[key] = [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))];
  }
  console.log(`  ${Object.keys(geo).length} tên duy nhất (bỏ ${dup} trùng).`);

  // Đối chiếu nhanh với cột "Tên kho" của tab gid=0 để báo tỉ lệ khớp
  try {
    const csv = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`);
    const lines = csv.split("\n");
    const header = [...(lines[0] || "").matchAll(/"([^"]*)"/g)].map((m) => normalizeName(m[1]));
    let khoCol = header.findIndex((h) => h === "ten kho");
    if (khoCol < 0) khoCol = header.findIndex((h) => h.includes("kho"));
    const offices = new Set();
    for (const line of lines.slice(1)) {
      const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const o = (cells[khoCol] || "").trim();
      if (o) offices.add(o);
    }
    let hit = 0;
    const miss = [];
    for (const o of offices) (geo[normalizeName(o)] ? hit++ : miss.push(o));
    const total = offices.size || 1;
    console.log(`→ Khớp tuyệt đối Sheet(gid0): ${hit}/${offices.size} (${Math.round((hit / total) * 100)}%).`);
    if (miss.length) console.log(`  Chưa khớp tuyệt đối (${miss.length}) — sẽ thử fuzzy lúc chạy. Vd:`, miss.slice(0, 6));
  } catch (e) {
    console.log("  (bỏ qua đối chiếu Sheet:", e.message, ")");
  }

  await mkdir(join(ROOT, "src", "data"), { recursive: true });
  await writeFile(join(ROOT, "src", "data", "geo.json"), JSON.stringify(geo), "utf8");
  console.log("✓ Ghi src/data/geo.json");
}

main().catch((e) => {
  console.error("✗ build-geo lỗi:", e.message);
  process.exit(1);
});
