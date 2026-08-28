import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MAP_CENTER, MAP_ZOOM, MAP_MID } from "../config";
import { fetchRoadGeometry } from "../lib/route-distance";
import { lookupCoord } from "../lib/geo";
import type { Route } from "../types";

const PALETTE = ["#f15a24", "#1668c7", "#1faa59", "#9b2fae", "#e2a300", "#0e7c86", "#d6336c"];

function numIcon(text: string, kind: "start" | "end" | "mid", offset?: [number, number]) {
  // offset = lệch HIỂN THỊ (pixel màn hình), dùng để tách các marker ở SÁT NHAU ra khỏi việc chồng
  // khít lên nhau (xem declutterMarkers) — không đổi toạ độ thật, chỉ dịch icon trên khung hình.
  const [ox, oy] = offset || [0, 0];
  return L.divIcon({
    className: "",
    html: `<div class="num-marker ${kind}">${text}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12 - ox, 12 - oy],
  });
}

/** Sếp báo 2026-08-25: Ghép Tải hiện tuyến có 2-3 điểm dừng CÁCH NHAU CHỈ ~10-20m ngoài đời thật
 *  (vd cụm "CK Hoà Hưng 1"/"Hoà Hưng 1"/"Hoà Hưng 2") -> toạ độ ĐÚNG cả (không thiếu), nhưng ở tầm
 *  zoom vừa đủ để thấy TRỌN tuyến (có thể dài chục km), khoảng cách đó chưa tới 1px màn hình nên các
 *  marker số ĐÈ KHÍT lên nhau, chỉ thấy 1 số -> Sếp tưởng thiếu điểm khi chụp màn hình gửi NCC.
 *  Sau khi bản đồ đã canh xong (biết đúng zoom/kích thước thật), gom các marker ở CÙNG 1 vị trí pixel
 *  (bán kính CLUSTER_PX) thành 1 cụm, dàn đều quanh 1 vòng tròn nhỏ để mỗi số vẫn thấy & bấm được
 *  riêng — chỉ dịch ICON hiển thị, KHÔNG đổi toạ độ thật (đường đi/km/phút vẫn tính đúng vị trí gốc). */
const CLUSTER_PX = 14;
const FAN_RADIUS_PX = 13;
function declutterMarkers(map: L.Map, markers: Map<number, L.Marker>, kindOf: (n: number) => "start" | "end" | "mid") {
  const entries = [...markers.entries()].sort((a, b) => a[0] - b[0]);
  const points = entries.map(([n, m]) => ({ n, m, pt: map.latLngToContainerPoint(m.getLatLng()) }));
  const clusters: { n: number; m: L.Marker; pt: L.Point }[][] = [];
  for (const p of points) {
    const c = clusters.find((cl) => cl.some((q) => q.pt.distanceTo(p.pt) <= CLUSTER_PX));
    if (c) c.push(p);
    else clusters.push([p]);
  }
  for (const cl of clusters) {
    if (cl.length < 2) {
      // Reset về đúng vị trí thật (không lệch) — QUAN TRỌNG khi hàm này chạy lại lúc Sếp zoom:
      // 1 cụm từng bị đè khít có thể đã tách ra đủ xa ở zoom mới, phải bỏ lệch cũ đi.
      cl.forEach((p) => p.m.setIcon(numIcon(String(p.n), kindOf(p.n))));
      continue;
    }
    cl.forEach((p, i) => {
      const angle = (i / cl.length) * 2 * Math.PI - Math.PI / 2;
      const dx = Math.round(Math.cos(angle) * FAN_RADIUS_PX);
      const dy = Math.round(Math.sin(angle) * FAN_RADIUS_PX);
      p.m.setIcon(numIcon(String(p.n), kindOf(p.n), [dx, dy]));
    });
  }
}

/**
 * Bản đồ Leaflet tự vẽ lộ trình.
 * - 1 tuyến: marker đánh số 1..n (xanh = đầu, đỏ = cuối) + đường nối.
 * - nhiều tuyến: mỗi tuyến 1 màu, điểm dừng là chấm tròn.
 */
export function MapPanel({
  routes,
  title,
  mapMode,
  setMapMode,
  highlightIdx,
  placeIds,
}: {
  routes: Route[];
  title: string;
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
  /** Bấm 1 điểm trong bảng lịch (thứ tự 1-based) -> mở popup + lượn bản đồ tới đúng điểm đó trên
   *  bản đồ, giống hệt khi tự bấm marker. CHỈ áp dụng khi routes.length === 1 (1 tuyến, đánh số). */
  highlightIdx?: number | null;
  /** Tên kho/bưu cục -> mã ID (usePlaceIds() ở lib/allRoutes.ts) — cho phép ô "Tìm vị trí" bên dưới
   *  gõ MÃ ID cũng tìm ra chỗ, không chỉ gõ tên. Không truyền = chỉ tìm theo tên (hành vi cũ). */
  placeIds?: Map<string, string>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const drawToken = useRef(0);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const [searchQ, setSearchQ] = useState("");
  const [searchHit, setSearchHit] = useState<{ name: string; coord: [number, number] } | null>(null);
  const [searchErr, setSearchErr] = useState("");

  // Chiều ngược lại (mã ID -> tên) để tra khi Sếp gõ thẳng mã ID vào ô tìm vị trí.
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    if (placeIds) for (const [name, id] of placeIds) if (id) m.set(id, name);
    return m;
  }, [placeIds]);

  function doSearch() {
    const raw = searchQ.trim();
    if (!raw) return;
    const q = idToName.get(raw) || raw; // gõ đúng mã ID -> đổi ra tên thật trước khi tra toạ độ
    const c = lookupCoord(q);
    if (c) {
      setSearchErr("");
      if (mapMode !== "auto") setMapMode("auto"); // MyMap không điều khiển được -> chuyển sang bản đồ định vị
      setSearchHit({ name: q, coord: c });
    } else {
      setSearchHit(null);
      setSearchErr(`Không tìm thấy “${raw}”. Thử gõ đúng tên hoặc mã ID bưu cục/kho hơn.`);
    }
  }

  // Khởi tạo map ở chế độ auto; cleanup đầy đủ (an toàn với StrictMode).
  useEffect(() => {
    if (mapMode !== "auto" || !elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(
      MAP_CENTER,
      MAP_ZOOM
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [mapMode]);

  // Vẽ lại khi danh sách tuyến đổi
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    const token = ++drawToken.current;
    const bounds: L.LatLngExpression[] = [];
    const single = routes.length === 1;
    let singleTotal = 0; // tổng điểm dừng CÓ toạ độ của tuyến (khi single) -> suy ra "end" cho declutterMarkers

    routes.forEach((r, ri) => {
      const coords = r.stops.filter((s) => s.coord).map((s) => s.coord!) as [number, number][];
      if (coords.length === 0) return;
      const color = single ? "#f15a24" : PALETTE[ri % PALETTE.length];

      if (single) singleTotal = coords.length;

      if (coords.length > 1) {
        // Vẽ tạm đường thẳng mảnh, rồi thay bằng đường ĐI THỰC TẾ khi OSRM trả về.
        const provisional = L.polyline(coords, {
          color,
          weight: single ? 3 : 2,
          opacity: 0.35,
          dashArray: "4 6",
        }).addTo(layer);
        fetchRoadGeometry(coords).then((geom) => {
          if (token !== drawToken.current) return; // đã vẽ lại -> bỏ
          layer.removeLayer(provisional);
          L.polyline(geom && geom.length > 1 ? geom : coords, {
            color,
            weight: single ? 4 : 3,
            opacity: 0.85,
          }).addTo(layer);
        });
      }

      let n = 0;
      r.stops.forEach((s) => {
        if (!s.coord) return;
        n++;
        const kind = single ? (n === 1 ? "start" : n === coords.length ? "end" : "mid") : "mid";
        const popup = `<b>${n}. ${s.kho}</b><br/>${[s.toi && "Tới " + s.toi, s.roi && "Rời " + s.roi]
          .filter(Boolean)
          .join(" · ")}<br/><i>${r.route}</i>`;
        if (single) {
          const marker = L.marker(s.coord, { icon: numIcon(String(n), kind) }).bindPopup(popup).addTo(layer);
          markersRef.current.set(n, marker);
        } else {
          L.circleMarker(s.coord, {
            radius: 5,
            color,
            fillColor: color,
            fillOpacity: 0.9,
            weight: 1,
          })
            .bindPopup(popup)
            .addTo(layer);
        }
        bounds.push(s.coord);
      });
    });

    // Điểm tìm kiếm: marker nổi bật + phóng tới (ưu tiên hơn fit tuyến).
    if (searchHit) {
      const [glat, glng] = searchHit.coord;
      const gdir = `https://www.google.com/maps/dir/?api=1&destination=${glat},${glng}`;
      L.marker(searchHit.coord, {
        icon: L.divIcon({ className: "", html: `<div class="search-pin">📍</div>`, iconSize: [30, 30], iconAnchor: [15, 28] }),
        zIndexOffset: 1000,
      })
        .bindPopup(`<b>🔎 ${searchHit.name}</b><br/><a href="${gdir}" target="_blank" rel="noopener">🧭 Chỉ đường (Google Maps)</a>`)
        .addTo(layer)
        .openPopup();
    }
    // QUAN TRỌNG: invalidateSize() PHẢI chạy TRƯỚC fitBounds/setView, không phải sau — Sếp báo
    // 2026-08-24 bấm chọn lịch khác làm bản đồ hiện lệch tâm (không giữa khung), lý do là code cũ
    // canh giữa (fitBounds) bằng kích thước khung CŨ rồi mới cập nhật lại kích thước THẬT (invalidateSize)
    // ngay sau đó — canh giữa xong mới đổi kích thước thì dĩ nhiên bị lệch. Gộp lại đúng thứ tự trong
    // cùng 1 setTimeout để canh giữa luôn dùng đúng kích thước khung hiện tại (Sếp chụp màn hình gửi
    // NCC cần bản đồ giữa khung, không lệch góc).
    // {pan:false}: invalidateSize() MẶC ĐỊNH tự lượn (pan) để giữ nguyên tâm CŨ khi đổi kích thước —
    // lượn này CHẠY ĐÈ (animation) cùng lúc với fitBounds/setView ngay sau, 2 lượn tranh nhau khiến vị
    // trí dừng cuối cùng ra sai lệch không đoán trước được. Tắt hẳn lượn của invalidateSize, chỉ để
    // fitBounds/setView làm ĐÚNG 1 lần canh giữa duy nhất theo tâm MỚI (điểm vừa chọn).
    setTimeout(() => {
      map.invalidateSize({ pan: false });
      // animate:false -> canh giữa NGAY LẬP TỨC, không lượn từ từ — Sếp cần chụp màn hình gửi NCC
      // ngay sau khi bấm chọn lịch, lượn có hoạt ảnh dễ bị chụp trúng lúc đang lượn dở, chưa vào giữa.
      if (searchHit) map.setView(searchHit.coord, 16, { animate: false });
      else if (bounds.length === 1) map.setView(bounds[0], 14, { animate: false });
      else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.15), { animate: false });
      // Phải chạy SAU fitBounds/setView (cần đúng zoom/kích thước cuối để tính pixel chính xác).
      declutter();
    }, 30);

    // Sếp tự zoom in/out sau khi bản đồ đã canh xong (không chỉ đúng lúc chụp màn hình đầu tiên) ->
    // khoảng cách pixel giữa các marker đổi theo zoom, phải tính lại cụm mỗi lần đổi zoom (kéo/lê
    // (pan) không đổi zoom -> không cần tính lại, khoảng cách tương đối giữa các marker không đổi).
    function declutter() {
      if (map && single && markersRef.current.size > 1) {
        declutterMarkers(map, markersRef.current, (n) => (n === 1 ? "start" : n === singleTotal ? "end" : "mid"));
      }
    }
    map.on("zoomend", declutter);
    return () => { map.off("zoomend", declutter); };
  }, [routes, mapMode, searchHit]);

  // Bấm 1 dòng trong bảng lịch (ScheduleTable) -> mở popup + lượn tới đúng marker đó, y hệt bấm
  // trực tiếp trên bản đồ (Sếp yêu cầu 2 chiều đồng bộ với nhau).
  useEffect(() => {
    if (highlightIdx == null) return;
    const map = mapRef.current;
    const marker = markersRef.current.get(highlightIdx);
    if (!map || !marker) return;
    map.panTo(marker.getLatLng());
    marker.openPopup();
  }, [highlightIdx]);

  const totalMapped = routes.reduce((a, r) => a + r.mappedCount, 0);

  return (
    <div className="map-card">
      <div className="map-head">
        <div className="t">
          <span>📍</span> {title}
        </div>
        <div className="map-toggle">
          <button className={mapMode === "auto" ? "active" : ""} onClick={() => setMapMode("auto")}>
            Lộ trình
          </button>
          <button className={mapMode === "mymap" ? "active" : ""} onClick={() => setMapMode("mymap")}>
            MyMap
          </button>
        </div>
      </div>

      <div className="map-search">
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="🔎 Tìm vị trí: tên hoặc mã ID kho / bưu cục…"
        />
        <button onClick={doSearch}>Định vị</button>
        {searchHit && <button className="map-search-clear" onClick={() => { setSearchHit(null); setSearchQ(""); }} title="Xoá">✕</button>}
      </div>
      {searchErr && <div className="map-search-err">{searchErr}</div>}
      {searchHit && (
        <div className="map-search-hit">
          <span>📍 {searchHit.name}</span>
          <a
            className="map-dir"
            href={`https://www.google.com/maps/dir/?api=1&destination=${searchHit.coord[0]},${searchHit.coord[1]}`}
            target="_blank"
            rel="noopener"
          >🧭 Chỉ đường (Google Maps)</a>
        </div>
      )}

      {mapMode === "mymap" ? (
        <iframe
          title="MyMap GHN Miền Nam"
          src={`https://www.google.com/maps/d/embed?mid=${MAP_MID}`}
          loading="lazy"
        />
      ) : (
        <div style={{ position: "relative" }}>
          <div id="leafletMap" ref={elRef} />
          {routes.length === 0 && !searchHit && (
            <div className="map-empty overlay">
              <div>
                <div className="ic">🗺️</div>
                <div style={{ fontWeight: 700, color: "#1f2d3d", marginBottom: 6 }}>
                  Chọn một tuyến để xem lộ trình
                </div>
                <div>Bấm vào thẻ tuyến bên trái — bản đồ sẽ vẽ thứ tự các điểm dừng.</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="map-foot">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        {mapMode === "mymap"
          ? "Bản đồ MyMap gốc của hệ thống bưu cục."
          : routes.length === 0
          ? "Nguồn nền: OpenStreetMap."
          : `${totalMapped} điểm hiển thị trên bản đồ · nền OpenStreetMap.`}
      </div>
    </div>
  );
}
