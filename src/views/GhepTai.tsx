import { useEffect, useMemo, useState } from "react";
import { MapPanel } from "../components/MapPanel";
import { AssistantChat } from "../components/AssistantChat";
import { useLichTai as useSchedule } from "../lib/db/useLichTai"; // 01/09/2026: Lịch Tải đã chuyển sang Supabase
import { useAllRoutes, usePlaceIds } from "../lib/allRoutes";
import { PlaceInput } from "../components/PlaceInput";
import { useTlld } from "../lib/useTlld";
import { normCode, type TlldRoute } from "../lib/tlld";
import { normSearch, expandAliases, stripAccents } from "../lib/normalize";
import { haversineKm, lookupCoord, useGeoVersion, initLiveGeo } from "../lib/geo";
import { fetchRoadLegs, fetchRoadLegsFull } from "../lib/route-distance";
import { usePersistentState } from "../lib/usePersistent";
import { takePendingGhep } from "../lib/nav";
import { planRouteFixed, pickVehicle, type PlanResult } from "../lib/planner";
import { VISIBLE_SHEETS } from "../config";
import type { Route } from "../types";

const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
const fmtKg = (n: number) => n.toLocaleString("vi-VN");

/** Bỏ tiền tố "ID - " khi Sếp chọn gợi ý dạng "23138000 - (HCM) KD Bình Trị Đông" (xem PlaceInput.tsx)
 *  — ID chỉ để hiển thị phân biệt các điểm dễ trùng tên, tra toạ độ/khớp tên thật vẫn phải bỏ đi. */
function stripIdPrefix(s: string): string {
  return (s || "").replace(/^\s*\d+\s*-\s*/, "").trim();
}

/** TLLD dùng để xét ghép tải (Sếp yêu cầu góc nhìn rộng hơn N-1/TB7 hay biến động 1-2 ngày):
 *  TB 30 ngày gần nhất, LOẠI bỏ Chủ Nhật (sản lượng CN thường thất thường, kéo lệch TB). */
function avg30ExclSun(t: TlldRoute | undefined): number | null {
  if (!t) return null;
  const vals = t.series30
    .filter((s) => s.val != null && new Date(s.date + "T00:00:00").getDay() !== 0)
    .map((s) => s.val as number);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Viết tắt tên NCC để ghi cạnh mã tuyến cho dễ check (Sếp yêu cầu): lấy chữ cái đầu mỗi từ,
 *  bỏ dấu, in hoa. "Huy Bảo Phát" -> "HBP" · "An Hợp Tín" -> "AHT". Riêng xe nhà (NCC="GHN")
 *  giữ nguyên "GHN", không viết tắt tiếp (Sếp dặn). */
function nccAbbr(name: string | undefined): string {
  if (!name) return "";
  if (stripAccents(name).trim() === "ghn") return "GHN";
  return stripAccents(name).split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
}

interface Candidate {
  route: Route;
  fill: number; // TLLD dùng để xét ghép — TB 30 ngày gần nhất, loại Chủ Nhật (xem avg30ExclSun)
  cap: number; // tải trọng xe (kg)
  spare: number; // kg còn trống tới 100%
  dist: number; // km gần nhất từ bưu cục tới tuyến
  addKm: number; // km phát sinh khi chèn bưu cục (đo độ tối ưu lộ trình)
  afterFill: number; // TLLD sau khi ghép
  trips: number; // số chuyến/7 ngày
  khoNames: string[]; // các kho tuyến đi qua (để hiện "về Kho 20")
  stopCount: number; // số bưu cục hiện có trên tuyến
  pure: boolean; // tuyến THUẦN đúng chiều đang chọn (lấy toàn điểm lấy / giao toàn điểm giao) -> ưu tiên
}

/** Điểm có phải KHO / CK / hub trung chuyển không (KHÔNG phải bưu cục khách). */
function isWarehouse(name: string): boolean {
  return /kho|trung chuyển|cross|\bhub\b|\bck\b|cụm kho/i.test(name || "");
}

/**
 * Chiều tuyến theo MÃ tuyến — chuẩn nhất theo quy ước đặt tên M12 (sếp dạy):
 *  CA1/CK1 = chỉ GIAO (không lấy). CK2/CA2 = GIAO VÀ LẤY (giao xong lấy hàng về).
 *  LAY.../MHTT/MHST/MHQ7 = LẤY hàng về kho/hub. Không khớp -> null (suy theo dữ liệu).
 */
function dirFromCode(code: string): "Giao" | "Lấy" | "Cả 2" | null {
  const c = (code || "").toUpperCase();
  if (/CK2|CA2/.test(c)) return "Cả 2";
  if (/CA1|CK1/.test(c)) return "Giao";
  if (/LAY|MHTT|MHST|MHQ7/.test(c)) return "Lấy";
  return null;
}

/** Rút gọn tên kho: "Kho Trung Chuyển Hồ Chí Minh 20" -> "HCM 20" */
function shortKho(name: string): string {
  const m = name.match(/(?:hồ chí minh|hcm)\s*0*(\d+)/i);
  if (m) return "HCM " + m[1].padStart(2, "0");
  if (/sóc trăng|soc trang/i.test(name)) return "Sóc Trăng";
  if (/tiền giang|tien giang/i.test(name)) return "Tiền Giang";
  return name.replace(/^kho\s+(trung chuyển\s+)?/i, "").slice(0, 18);
}

/**
 * Chọn vị trí chèn điểm mới vào tuyến (không đảo thứ tự gốc), trả về { k, add }.
 * QUY ƯỚC LOGISTICS M12 (sếp dạy):
 *  - KHÔNG chèn điểm lấy/giao vào đoạn KHO→KHO (đoạn chuyển nhanh hàng FW/Phân loại).
 *  - Điểm LẤY mới phải gộp chung với CỤM BƯU CỤC LẤY (trước khi xe về kho đầu tiên).
 *  - Điểm GIAO mới gộp với cụm bưu cục GIAO (sau khi rời kho cuối).
 */
function insertGap(
  ordered: { kho?: string; loaiHinh: string; coord: [number, number] }[],
  p: [number, number],
  planMode: "Giao" | "Lấy"
): { k: number; add: number } {
  const n = ordered.length;
  if (n < 2) return { k: n, add: n ? haversineKm(ordered[0].coord, p) * 2 : 0 };
  const wh = ordered.map((s) => isWarehouse(s.kho || ""));
  const firstWh = wh.indexOf(true);
  const lastWh = wh.lastIndexOf(true);
  // Khoảng được phép chèn theo chiều:
  let loK = 1, hiK = n;
  if (planMode === "Lấy" && firstWh > 0) hiK = firstWh;          // lấy: trong cụm bưu cục đầu (trước kho đầu)
  else if (planMode === "Giao" && lastWh >= 0) loK = lastWh + 1; // giao: trong cụm bưu cục cuối (sau kho cuối)
  const whGap = (k: number) => wh[k - 1] && wh[k]; // đoạn giữa 2 KHO -> cấm chèn
  let bestK = -1, bestAdd = Infinity;
  // Vòng 1: trong khoảng đúng chiều, bỏ đoạn kho→kho. Vòng 2 (nếu vòng 1 trống): nới rộng cả tuyến.
  for (let pass = 0; pass < 2 && bestK < 0; pass++) {
    const lo = pass === 0 ? loK : 1, hi = pass === 0 ? hiK : n;
    for (let k = Math.max(1, lo); k <= hi && k < n; k++) {
      if (whGap(k)) continue;
      const add = haversineKm(ordered[k - 1].coord, p) + haversineKm(p, ordered[k].coord) - haversineKm(ordered[k - 1].coord, ordered[k].coord);
      if (add < bestAdd) { bestAdd = add; bestK = k; }
    }
  }
  if (bestK < 0) bestK = Math.min(Math.max(loK, 1), n - 1);
  return { k: bestK, add: bestAdd === Infinity ? haversineKm(ordered[Math.max(0, bestK - 1)].coord, p) : bestAdd };
}

/** Ghép Tải: thêm bưu cục vào tuyến giao/lấy TLLD thấp, hoặc đề xuất mở tuyến mới. */
export function GhepTai({
  mapMode,
  setMapMode,
}: {
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
}) {
  const [region, setRegion] = usePersistentState("ghep.region", VISIBLE_SHEETS[0].key);
  const sheet = VISIBLE_SHEETS.find((s) => s.key === region) ?? VISIBLE_SHEETS[0];
  const { data } = useSchedule(sheet.key);
  const tlld = useTlld().index;

  const [mode, setMode] = usePersistentState<"Giao" | "Lấy" | "Cả 2">("ghep.mode", "Lấy");
  const [khoDest, setKhoDest] = usePersistentState("ghep.kho1", "");
  const [khoDest2, setKhoDest2] = usePersistentState("ghep.kho2", "");
  const [bc, setBc] = usePersistentState("ghep.bc", "");
  const [kg, setKg] = usePersistentState("ghep.kg", "");
  const [searched, setSearched] = usePersistentState("ghep.searched", false);
  const [merged, setMerged] = useState<{ label: string; ncc?: string; before: number; after: number; result: PlanResult } | null>(null);
  const [busy, setBusy] = useState(false);

  // geoVersion đổi mỗi khi initLiveGeo() (App.tsx) nạp/trộn xong toạ độ MyMap mới -> nhớ tính lại,
  // không thì bưu cục vừa được thêm vào MyMap vẫn báo "chưa có toạ độ" cho tới khi Sếp gõ lại tên.
  const geoVersion = useGeoVersion();
  const bcCoord = useMemo(() => lookupCoord(stripIdPrefix(bc)), [bc, geoVersion]);
  const wKg = parseFloat(kg) || 0;

  function detectMode(r: Route): "Giao" | "Lấy" {
    // Ưu tiên MÃ tuyến (chuẩn nhất).
    const byCode = dirFromCode(r.route);
    if (byCode === "Giao" || byCode === "Lấy") return byCode;
    const c = (r.category || "").toLowerCase();
    if (/giao/.test(c) && !/lay|lấy/.test(c)) return "Giao";
    if (/lay|lấy/.test(c) && !/giao/.test(c)) return "Lấy";
    // Không rõ -> đếm điểm: nhiều điểm LẤY (không phải giao) hơn -> tuyến tải lấy.
    const layN = r.stops.filter((s) => /lay|lấy/i.test(s.loaiHinh) && !/giao/i.test(s.loaiHinh)).length;
    const giaoN = r.stops.filter((s) => /giao/i.test(s.loaiHinh)).length;
    return layN >= giaoN ? "Lấy" : "Giao";
  }
  // Chiều tuyến 3 trạng thái (để tuyến GIAO-VÀ-LẤY phục vụ được cả 2 chiều ghép).
  function routeDir(r: Route): "Giao" | "Lấy" | "Cả 2" {
    return dirFromCode(r.route) ?? detectMode(r);
  }
  function routeIsMode(r: Route): boolean {
    if (mode === "Cả 2") return true;
    const d = routeDir(r);
    return d === "Cả 2" || d === mode; // CK2/CA2 (giao và lấy) ghép được cả khi chọn Giao lẫn Lấy
  }

  // Gợi ý bưu cục + kho lấy từ TOÀN BỘ 6 vùng (realtime), chỉ điểm CÓ toạ độ.
  const allRoutes = useAllRoutes();
  // Cho phép gõ MÃ ID bưu cục/kho để tìm ra tên (Sếp yêu cầu 2026-08-24, cùng cơ chế PlaceInput đã
  // dùng ở "Tính nhanh") — dùng lại đúng usePlaceIds() có sẵn, không tự chế map riêng.
  const placeIds = usePlaceIds();
  const { bcOptions, khoOptions } = useMemo(() => {
    const bc = new Set<string>();
    const kho = new Set<string>();
    // Lấy ĐỦ MỌI bưu cục/kho trong lịch toàn vùng (KHÔNG lọc theo toạ độ) để gợi ý đầy đủ.
    // (Toạ độ chỉ cần khi TÌM tuyến ghép — kiểm riêng bên dưới.)
    for (const r of allRoutes.values())
      for (const s of r.stops)
        if (s.kho) { bc.add(s.kho); if (/kho/i.test(s.kho)) kho.add(s.kho); }
    const sortVi = (a: string, b: string) => a.localeCompare(b, "vi");
    return { bcOptions: [...bc].sort(sortVi), khoOptions: [...kho].sort(sortVi) };
  }, [allRoutes]);

  // Tên kho người dùng gõ -> khớp về tên kho thật trong hệ thống (gõ "HCM 20" ra "...Hồ Chí Minh 20").
  // Bỏ tiền tố "ID - " trước khi khớp (Sếp chọn gợi ý dạng "1626 - Kho Trung Chuyển HCM 01").
  function resolveKho(qRaw: string): string {
    const q = stripIdPrefix(qRaw);
    const n = expandAliases(normSearch(q)); // "HCM20" -> "ho chi minh 20"
    if (!n) return "";
    const toks = n.split(" ").filter((t) => t.length > 1);
    return (
      khoOptions.find((k) => normSearch(k).includes(n)) ||
      khoOptions.find((k) => { const kn = normSearch(k); return toks.length > 0 && toks.every((t) => kn.includes(t)); }) ||
      q.trim()
    );
  }
  /** Tên bưu cục người dùng gõ (kể cả VIẾT TẮT) -> khớp về tên THẬT trong hệ thống (có toạ độ).
   *  Vd "KD Bình Hưng Hòa" -> "(HCM) KD Bình Hưng Hòa - Bình Tân-HCM". Dùng cho trợ lý tự điền. */
  function resolveBc(q: string): string {
    const n = expandAliases(normSearch(q));
    if (!n) return q.trim();
    const hit = bcOptions.find((b) => normSearch(b).includes(n)); // khớp nguyên cụm
    if (hit) return hit;
    const toks = n.split(" ").filter((w) => w.length >= 2);
    let best = "", bestScore = 0;
    for (const b of bcOptions) {
      const bn = normSearch(b);
      const score = toks.filter((t) => bn.includes(t)).length;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return bestScore >= Math.max(1, Math.ceil(toks.length * 0.6)) ? best : q.trim();
  }
  const khoResolved = useMemo(() => resolveKho(khoDest), [khoDest, khoOptions]);
  const khoResolved2 = useMemo(() => resolveKho(khoDest2), [khoDest2, khoOptions]);
  // Tối đa 2 kho: tuyến phục vụ BẤT KỲ kho nào trong danh sách đều ghép được
  const khoList = useMemo(() => [khoResolved, khoResolved2].filter(Boolean), [khoResolved, khoResolved2]);

  // Tìm tuyến ghép: TLLD < 70%, đủ chỗ trống, gần bưu cục
  const candidates: Candidate[] = useMemo(() => {
    if (!bcCoord || wKg <= 0 || !tlld) return [];
    const out: Candidate[] = [];
    const matchKho = (name: string) => {
      const sn = normSearch(name);
      return khoList.some((k) => { const kn = normSearch(k); return sn.includes(kn) || kn.includes(sn); });
    };
    for (const r of data.routes) {
      if (!routeIsMode(r)) continue;
      // QUY ƯỚC M12: tuyến KHO→KHO (chỉ nối kho/CK/hub, không có bưu cục khách) -> KHÔNG ghép bưu cục vào.
      const realStops = r.stops.filter((s) => s.kho && s.coord && !isWarehouse(s.kho));
      if (realStops.length === 0) continue;
      if (khoList.length && !r.stops.some((s) => s.kho && matchKho(s.kho))) continue; // tuyến phải VỀ ít nhất 1 kho đích
      // Đếm điểm theo chiều (Phân loại ở kho KHÔNG tính là giao/lấy).
      const layStops = r.stops.filter((s) => /lay|lấy/i.test(s.loaiHinh) && !/giao/i.test(s.loaiHinh)).length;
      const giaoStops = r.stops.filter((s) => /giao/i.test(s.loaiHinh) && !/lay|lấy/i.test(s.loaiHinh)).length;
      // Chọn 1 chiều cụ thể -> tuyến PHẢI có điểm đúng chiều đó (ghép điểm LẤY thì tuyến phải đang lấy hàng).
      if (mode === "Lấy" && layStops === 0) continue;
      if (mode === "Giao" && giaoStops === 0) continue;
      // "pure" = tuyến THUẦN đúng chiều (không lẫn điểm chiều ngược) -> ưu tiên hiện trước.
      const pure = mode === "Lấy" ? giaoStops === 0 : mode === "Giao" ? layStops === 0 : true;
      // Cap: mỗi tuyến ghép tối đa 3 điểm lấy -> tuyến đã có ≥3 điểm lấy thì bỏ
      if (mode !== "Giao") {
        const layN = r.stops.filter((s) => /lay|lấy/i.test(s.loaiHinh)).length;
        if (layN >= 3) continue;
      }
      const t = tlld.byCode.get(normCode(r.route));
      const fill = avg30ExclSun(t);
      if (fill == null || fill >= 0.7) continue; // chỉ tuyến TLLD thấp
      const cap = parseFloat(r.load) || 0;
      if (!cap) continue;
      const spare = Math.max(0, (1 - fill) * cap);
      if (spare < wKg) continue; // không đủ chỗ
      const coords = r.stops.map((s) => s.coord).filter(Boolean) as [number, number][];
      if (!coords.length) continue;
      const dist = Math.min(...coords.map((c) => haversineKm(bcCoord, c)));
      const orderedStops = r.stops.filter((s) => s.kho && s.coord) as { kho: string; loaiHinh: string; coord: [number, number] }[];
      const pMode = mode === "Cả 2" ? detectMode(r) : mode;
      const addKm = insertGap(orderedStops, bcCoord, pMode).add;
      const khoNames = [...new Set(r.stops.filter((s) => isWarehouse(s.kho)).map((s) => shortKho(s.kho)))];
      const stopCount = realStops.length;
      out.push({
        route: r, fill, cap, spare, dist, addKm, afterFill: fill + wKg / cap,
        trips: t?.trips ?? 0, khoNames, stopCount, pure,
      });
    }
    // Ưu tiên: tuyến THUẦN đúng chiều (lấy hàng) lên trước; rồi THUẬN ĐƯỜNG nhất (ít km chèn);
    // cùng mức thì TLLD thấp hơn lên trước. (Tối ưu nhất nằm trên cùng.)
    return out.sort((a, b) => (Number(b.pure) - Number(a.pure)) || (a.addKm - b.addKm) || (a.fill - b.fill)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bcCoord, wKg, tlld, data.routes, mode, khoList]);

  // Tính km ĐƯỜNG BỘ THỰC TẾ phát sinh (OSRM) cho đúng vị trí sẽ chèn — chính xác hơn chim bay.
  const [roadAdd, setRoadAdd] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!bcCoord || candidates.length === 0) { setRoadAdd({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        candidates.map(async (c) => {
          const ordered = c.route.stops.filter((s) => s.kho && s.coord) as { kho: string; loaiHinh: string; coord: [number, number] }[];
          const pMode = mode === "Cả 2" ? detectMode(c.route) : mode;
          const { k } = insertGap(ordered, bcCoord, pMode);
          const prev = ordered[k - 1]?.coord;
          const next = ordered[k]?.coord;
          if (!prev || !next) return [c.route.route, null] as const;
          const [via, direct] = await Promise.all([
            fetchRoadLegsFull([prev, bcCoord, next]),
            fetchRoadLegs([prev, next]),
          ]);
          if (!via || !direct) return [c.route.route, null] as const;
          const add = via.reduce((a, l) => a + l.km, 0) - direct.reduce((a, d) => a + d, 0);
          return [c.route.route, Math.max(0, add)] as const;
        })
      );
      if (!cancelled) setRoadAdd(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, bcCoord, mode]);

  // Khi có đủ km đường bộ -> sắp xếp lại theo đường bộ thực tế (chính xác hơn), VẪN ưu tiên tuyến thuần đúng chiều.
  const shownCands = useMemo(() => {
    const allRoad = candidates.length > 0 && candidates.every((c) => typeof roadAdd[c.route.route] === "number");
    if (!allRoad) return candidates;
    return [...candidates].sort((a, b) => (Number(b.pure) - Number(a.pure)) || ((roadAdd[a.route.route] as number) - (roadAdd[b.route.route] as number)));
  }, [candidates, roadAdd]);

  async function chooseCandidate(c: Candidate) {
    if (!bcCoord) return;
    setBusy(true);
    try {
      // Nạp lại toạ độ REALTIME trước khi tính — Sếp yêu cầu 2026-08-23 "Dash phải luôn đồng bộ":
      // tra lại NGAY TẠI ĐÂY (không dùng bcCoord đóng gói lúc render) để không dính đúng lỗ hổng đã
      // sửa ở planSchedule() (tính lịch trước khi sheet toạ độ toàn quốc kịp tải xong).
      await initLiveGeo();
      const freshBcCoord = lookupCoord(stripIdPrefix(bc)) || bcCoord;
      // GIỮ NGUYÊN toàn bộ điểm + thứ tự + loại hình của tuyến gốc, chỉ CHÈN bưu cục mới.
      // Vị trí chèn theo nguyên tắc giao-trước-lấy-sau (xem insertGap).
      const ordered = c.route.stops.filter((s) => s.kho && s.coord) as {
        kho: string; loaiHinh: string; coord: [number, number]; toi: string;
      }[];
      const planMode = mode === "Cả 2" ? detectMode(c.route) : mode;
      const { k: bestK } = insertGap(ordered, freshBcCoord, planMode);
      const seq = ordered.map((s) => ({ name: s.kho, loaiHinh: s.loaiHinh, coord: s.coord }));
      seq.splice(bestK, 0, { name: bc.trim(), loaiHinh: planMode, coord: freshBcCoord });

      const result = await planRouteFixed(seq, ordered[0]?.toi || "19:30");
      setMerged({ label: c.route.route, ncc: c.route.ncc, before: c.fill, after: c.afterFill, result });
    } finally {
      setBusy(false);
    }
  }

  async function openNew() {
    if (!bcCoord) return;
    setBusy(true);
    try {
      await initLiveGeo(); // cùng lý do như chooseCandidate() ở trên
      const freshBcCoord = lookupCoord(stripIdPrefix(bc)) || bcCoord;
      const veh = pickVehicle(wKg);
      const planMode = mode === "Cả 2" ? "Lấy" : mode;
      const khoName = khoResolved || "Kho Trung Chuyển Hồ Chí Minh 01";
      const khoCoord = lookupCoord(khoName);
      const bcStop = { name: bc.trim(), loaiHinh: planMode, coord: freshBcCoord };
      const khoStop = khoCoord ? { name: khoName, loaiHinh: "Phân loại", coord: khoCoord as [number, number] } : null;
      // Lấy: xuất phát từ BƯU CỤC → về kho. Giao: từ kho → tới bưu cục.
      const seq = planMode === "Giao"
        ? [khoStop, bcStop].filter(Boolean) as typeof bcStop[]
        : [bcStop, khoStop].filter(Boolean) as typeof bcStop[];
      const result = await planRouteFixed(seq, "19:30");
      setMerged({ label: `TUYẾN MỚI (${fmtKg(veh.cap)}kg)`, before: 0, after: wKg / veh.kg, result });
    } finally {
      setBusy(false);
    }
  }

  function doSearch() {
    setMerged(null);
    setSearched(true);
  }

  /** Áp 1 LỆNH GHÉP {bc,kg,loai,region,kho} vào form + tự tìm + cuộn + trả câu phản hồi.
   *  Dùng chung cho: chat trong Ghép Tải VÀ lệnh từ khung chat "Sắp Mới" (pending). */
  function applyGhepCmd(cmd: any): string {
    // ----- Áp lệnh vào form (KHỚP TÊN THẬT) -----
    if (cmd.loai === "Lấy" || cmd.loai === "Giao" || cmd.loai === "Cả 2") setMode(cmd.loai);
    if (cmd.region) {
      const f = VISIBLE_SHEETS.find((s) => normSearch(s.label).includes(normSearch(String(cmd.region))));
      if (f) setRegion(f.key);
    }
    if (cmd.kho) setKhoDest(resolveKho(String(cmd.kho))); // "HCM20" -> tên kho thật
    let resolvedBc = "";
    if (cmd.bc) { resolvedBc = resolveBc(String(cmd.bc)); setBc(resolvedBc); setMerged(null); } // viết tắt -> tên đầy đủ
    if (cmd.kg != null && Number(cmd.kg) > 0) setKg(String(cmd.kg));

    const bcName = resolvedBc || bc.trim();
    const kgVal = Number(cmd.kg) > 0 ? Number(cmd.kg) : parseFloat(kg) || 0;
    const ready = !!bcName && kgVal > 0;

    if (ready) {
      setMerged(null);
      setSearched(true); // tự bấm "Tìm tuyến ghép"
      // Cuộn màn hình tới khu kết quả sau khi render.
      setTimeout(() => document.getElementById("ghep-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
      // Phản hồi THÔNG MINH: kiểm tra có khớp toạ độ bưu cục không (client tự biết, không đoán).
      const found = !!lookupCoord(bcName);
      const loaiTxt = (cmd.loai && cmd.loai !== "") ? cmd.loai : mode;
      const khoTxt = cmd.kho ? ` về ${resolveKho(String(cmd.kho))}` : "";
      if (found) {
        return `Dạ em đã điền & tìm giúp Sếp rồi ạ: ghép **${bcName}** ${kgVal}kg (${loaiTxt})${khoTxt}. Sếp xem các tuyến có thể ghép ngay bên dưới nhé 👇`;
      }
      return `Em đã điền form (**${bcName}** ${kgVal}kg) nhưng bưu cục này **chưa có toạ độ trên bản đồ** (chưa có trong MyMap) nên chưa tính được tuyến ghép. Nếu Sếp vừa thêm vào MyMap thì đợi vài phút hệ thống tự đồng bộ; không thì Sếp kiểm tra lại tên giúp em ạ. 🙏`;
    }
    // Thiếu thông tin -> hỏi lại (đã điền phần có).
    return cmd.ask || cmd.say || "Dạ Sếp cho em thêm: bưu cục cần ghép + khối lượng (kg) + lấy/giao ạ?";
  }

  /** Chat NGAY trong tab Ghép Tải: gọi API trích lệnh rồi áp. */
  async function ghepInterpret(text: string): Promise<string> {
    const formCtx = `Vùng đang chọn: ${sheet.label}. Form hiện có: bưu cục="${bc}", kg="${kg || "(trống)"}", loại="${mode}", kho về="${khoDest || "(trống)"}". Các vùng: ${VISIBLE_SHEETS.map((s) => s.label).join(", ")}.`;
    let raw = "";
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "ghepcmd", text, context: formCtx }) });
      raw = (await r.json())?.reply || "";
    } catch (e) {
      return "Dạ em chưa kết nối được, Sếp thử lại giúp em ạ. (" + (e instanceof Error ? e.message : String(e)) + ")";
    }
    const m = raw.match(/\{[\s\S]*\}/);
    let cmd: any = null;
    if (m) { try { cmd = JSON.parse(m[0]); } catch { /* parse lỗi */ } }
    if (!cmd) return "Dạ em chưa hiểu rõ. Sếp nói gọn giúp em: ghép bưu cục NÀO, bao nhiêu KG, LẤY hay GIAO ạ?";
    return applyGhepCmd(cmd);
  }

  // Nhận LỆNH GHÉP do khung chat "Sắp Mới" gửi sang (khi vừa nhảy vào tab Ghép Tải): tự điền + tìm.
  useEffect(() => {
    const g = takePendingGhep();
    if (g && g.bc) applyGhepCmd(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapRoutes: Route[] = merged
    ? [{ route: merged.label, load: "", category: mode, stops: merged.result.rows.map((r) => ({ kho: r.name, loaiHinh: r.loaiHinh, toi: r.toi, roi: r.roi, coord: r.coord })), mappedCount: merged.result.rows.filter((r) => r.coord).length }]
    : [];

  const ctx = `Ghép Tải vùng ${sheet.label}: cần ghép bưu cục "${bc}" (${wKg}kg, ${mode}). ${candidates.length} tuyến TLLD<70% phù hợp.`;

  return (
    <div className="split">
      <div>
        <div className="section-card ghep-form">
          <div className="pl-seg" style={{ marginBottom: 12 }}>
            <button className={mode === "Lấy" ? "on" : ""} onClick={() => setMode("Lấy")}>📥 Lấy</button>
            <button className={mode === "Giao" ? "on" : ""} onClick={() => setMode("Giao")}>📤 Giao</button>
            <button className={mode === "Cả 2" ? "on" : ""} onClick={() => setMode("Cả 2")}>🔁 Cả 2</button>
          </div>
          <label className="pl-full"><span>① Vùng cần ghép</span>
            <select className="pl-in" value={region} onChange={(e) => { setRegion(e.target.value); setSearched(false); setMerged(null); }}>
              {VISIBLE_SHEETS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="pl-full"><span>② {mode === "Giao" ? "Giao đi từ kho" : mode === "Cả 2" ? "Kho lấy/giao" : "Lấy về kho"} — tối đa 2 kho (để trống = mọi kho)</span>
            <PlaceInput value={khoDest} onChange={(v) => { setKhoDest(v); setSearched(false); setMerged(null); }} names={khoOptions} ids={placeIds} placeholder="Kho 1 — gõ tên hoặc mã ID để chọn từ gợi ý…" />
            {khoDest && khoResolved && khoResolved !== khoDest && (
              <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 3 }}>→ {khoResolved}</div>
            )}
            <div style={{ marginTop: 6 }}>
              <PlaceInput value={khoDest2} onChange={(v) => { setKhoDest2(v); setSearched(false); setMerged(null); }} names={khoOptions} ids={placeIds} placeholder="Kho 2 (tuỳ chọn) — nếu bưu cục cần về 2 kho…" />
            </div>
            {khoDest2 && khoResolved2 && khoResolved2 !== khoDest2 && (
              <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 3 }}>→ {khoResolved2}</div>
            )}
          </label>
          <label className="pl-full"><span>③ Bưu cục cần ghép</span>
            <PlaceInput value={bc} onChange={setBc} names={bcOptions} ids={placeIds} placeholder="Gõ tên hoặc mã ID bưu cục để chọn từ gợi ý…" />
          </label>
          <div className="pl-grid">
            <label><span>④ Khối lượng (kg)</span>
              <input className="pl-in" type="number" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="kg" />
            </label>
            <label><span>&nbsp;</span>
              <button className="pl-calc" style={{ width: "100%" }} onClick={doSearch} disabled={!bc.trim() || wKg <= 0}>🔗 Tìm tuyến ghép</button>
            </label>
          </div>
          {searched && !bcCoord && <div className="pl-warn" id="ghep-results">Bưu cục "{bc}" chưa có toạ độ trên bản đồ (chưa có trong MyMap) nên chưa tính được tuyến ghép. Nếu Sếp vừa thêm điểm này vào MyMap, hệ thống tự đồng bộ trong vài phút — thử tìm lại; nếu vẫn chưa lên, Sếp kiểm tra lại tên hoặc chọn bưu cục khác giúp em ạ.</div>}
        </div>

        {searched && bcCoord && (
          <div className="section-card" id="ghep-results" style={{ marginTop: 12 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>
              {candidates.length > 0 ? `${candidates.length} tuyến có thể ghép (TLLD < 70%)` : "Không có tuyến phù hợp để ghép"}
            </h2>
            {candidates.length === 0 ? (
              <div>
                <p className="lead" style={{ marginBottom: 10 }}>Không tuyến nào đủ chỗ/gần để ghép. Nên <b>mở tuyến mới</b> cho bưu cục này.</p>
                <button className="pl-calc" onClick={openNew} disabled={busy}>{busy ? "Đang tính…" : "➕ Mở tuyến tải mới (tối ưu)"}</button>
              </div>
            ) : (
              <div className="ghep-list">
                <div className="ghep-scroll">
                {shownCands.map((c) => {
                  const road = roadAdd[c.route.route];
                  return (
                  <button key={c.route.route} className="ghep-card" onClick={() => chooseCandidate(c)} disabled={busy}>
                    <div className="ghep-head">
                      <span className="ghep-code">
                        {c.route.route}
                        {c.route.ncc && <span className="ghep-ncc" title={c.route.ncc}> ({nccAbbr(c.route.ncc)})</span>}
                      </span>
                      <span className="ghep-veh">🚚 {fmtKg(c.cap)} kg{c.khoNames.length ? " · về " + c.khoNames.join(" + ") : ""}</span>
                    </div>
                    <div className="ghep-meta">
                      <span className="chip" title="Quãng đường ĐƯỜNG BỘ phát sinh thêm khi xe ghé bưu cục này (đo bằng OSRM, đúng vị trí sẽ chèn)">
                        ➕ đi thêm {road == null ? `~${c.addKm.toFixed(1)} km*` : `${road.toFixed(1)} km`}
                      </span>
                      <span className="chip" title="Khoảng cách đường chim bay tới điểm gần nhất trên tuyến (chỉ để tham khảo vị trí)">📍 gần nhất ~{c.dist.toFixed(1)} km</span>
                      <span className="chip load">trống {fmtKg(Math.round(c.spare))} kg</span>
                      <span className="chip">{c.stopCount} điểm · {c.trips} chuyến/7n</span>
                    </div>
                    <div className="ghep-meta">
                      <span className="chip">TLLD TB30 (trừ CN) <b>{pct(c.fill)}</b></span>
                      <span className="chip">sau ghép <b style={{ color: c.afterFill <= 1 ? "var(--green)" : "var(--red)" }}>{pct(c.afterFill)}</b></span>
                    </div>
                  </button>
                  );
                })}
                </div>
                {shownCands.length > 5 && <div className="ghep-scroll-hint">⌄ Cuộn xem thêm {shownCands.length - 5} tuyến nữa — tối ưu nhất nằm trên cùng</div>}
                <button className="pl-add" style={{ marginTop: 4 }} onClick={openNew} disabled={busy}>hoặc ➕ mở tuyến mới</button>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                  Xếp từ trên xuống = tối ưu nhất (ưu tiên tuyến thuần đúng chiều, rồi ít km đi thêm). “đi thêm” = km <b>đường bộ</b> ghé thêm (OSRM); <b>*</b> = đang ước lượng.
                </div>
              </div>
            )}
          </div>
        )}

        {merged && (
          <div className="section-card" style={{ marginTop: 12 }}>
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>
              Lộ trình tối ưu sau ghép · {merged.label}
              {merged.ncc && <span className="ghep-ncc" title={merged.ncc}> ({nccAbbr(merged.ncc)})</span>}
            </h2>
            <p className="lead" style={{ marginBottom: 10 }}>
              {merged.result.rows.length} điểm · <b>{merged.result.totalKm.toFixed(1)} km</b> · <b>{Math.round(merged.result.totalMin)} phút</b> ·
              TLLD <b>{pct(merged.before)}</b> → <b style={{ color: merged.after <= 1 ? "var(--green)" : "var(--red)" }}>{pct(merged.after)}</b>
              {merged.after > 1 && <span style={{ color: "var(--red)" }}> · ⚠ vượt tải</span>}
            </p>
            <div className="rt-wrap">
              <table className="route-table">
                <thead><tr><th>#</th><th>Điểm / Kho</th><th>Loại hình</th><th>Tới</th><th>Rời</th><th>Km</th><th>Phút chạy</th></tr></thead>
                <tbody>
                  {merged.result.rows.map((r, i) => (
                    <tr key={i} style={r.name === bc.trim() ? { background: "var(--orange-soft)" } : undefined}>
                      <td className="num">{i + 1}</td>
                      <td className="rt-kho">{r.name}{r.name === bc.trim() ? " ⬅ mới" : ""}</td>
                      <td className="rt-type">{r.loaiHinh}</td>
                      <td className="num">{r.toi}</td>
                      <td className="num">{r.roi}</td>
                      <td className="num km">{r.km == null ? "—" : r.km.toFixed(1)}</td>
                      <td className="num">{i === 0 || !r.min ? "—" : r.min + "′"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <AssistantChat chatId="ghep" context={ctx} interpret={ghepInterpret} onTemplate={() => {}} onUpload={() => {}} />
        </div>
      </div>

      <div className="map-panel">
        <MapPanel routes={mapRoutes} title={merged ? merged.label : "Bản đồ ghép tải"} mapMode={mapMode} setMapMode={setMapMode} placeIds={placeIds} />
      </div>
    </div>
  );
}
