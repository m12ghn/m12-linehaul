/* Hook tải thông tin xe (realtime, poll 60s) + cache module. */
import { useEffect, useState } from "react";
import { loadFleet, type Vehicle } from "./fleet";
import { startPoll } from "./poll";
import { REFRESH_MS } from "../config";

let cache: Map<string, Vehicle> | null = null;

export function useFleet() {
  const [byRoute, setByRoute] = useState<Map<string, Vehicle> | null>(cache);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = await loadFleet();
        if (!alive) return;
        cache = res.byRoute;
        setByRoute(res.byRoute);
      } catch {
        /* giữ dữ liệu cũ */
      }
    };
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  return byRoute;
}
