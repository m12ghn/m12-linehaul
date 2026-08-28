import { CategoryTabs } from "../components/CategoryTabs";
import { MapPanel } from "../components/MapPanel";
import { StatusBar } from "../components/StatusBar";
import { usePlaceIds } from "../lib/allRoutes";
import type { SheetData } from "../types";

/** Chế độ xem bản đồ toàn vùng — vẽ mọi tuyến (mỗi tuyến 1 màu). */
export function LoTrinh({
  data,
  regionLabel,
  category,
  setCategory,
  mapMode,
  setMapMode,
}: {
  data: SheetData;
  regionLabel: string;
  category: string;
  setCategory: (c: string) => void;
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
}) {
  const routes = category ? data.routes.filter((r) => r.category === category) : data.routes;
  const placeIds = usePlaceIds(); // cho ô "Tìm vị trí" trên bản đồ gõ được mã ID bưu cục/kho
  return (
    <>
      <CategoryTabs categories={data.categories} routes={data.routes} active={category} onChange={setCategory} />
      <StatusBar lastSync={data.lastSync} error={data.error} missingGeo={data.missingGeo} />
      <div style={{ marginTop: 8 }}>
        <MapPanel
          routes={routes}
          title={`Toàn bộ lộ trình · ${regionLabel}`}
          mapMode={mapMode}
          setMapMode={setMapMode}
          placeIds={placeIds}
        />
      </div>
    </>
  );
}
