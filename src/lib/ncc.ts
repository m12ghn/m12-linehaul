/* ============================================================
   Nhà cung cấp (NCC) tăng cường: link room Telegram báo lịch +
   gom các tuyến TC theo tên NCC (tách Lấy / Giao).
   ============================================================ */
import type { TCRoute } from "./tangcuong";

/** Room Telegram báo lịch cho từng NCC (admin gửi lịch vào đây). */
export const NCC_TELEGRAM: { name: string; url: string }[] = [
  { name: "An Logistics", url: "https://web.telegram.org/k/#-4287099695" },
  { name: "An Hợp Tín", url: "https://web.telegram.org/k/#-4927738509" },
  { name: "Vạn Lợi", url: "https://web.telegram.org/k/#-5134245191" },
  { name: "Huy Bảo Phát", url: "https://web.telegram.org/k/#-873627090" },
  { name: "Quân Khang Phát", url: "https://web.telegram.org/k/#-5060086620" },
  { name: "Võ Gia", url: "https://web.telegram.org/k/#-582874209" },
  { name: "Hoàng Minh", url: "https://web.telegram.org/k/#-2302041014" },
  { name: "Kim Huệ", url: "https://web.telegram.org/k/#-3288513512" },
  { name: "Minh Đăng Khoa", url: "https://web.telegram.org/k/#-4886498182" },
  { name: "Việt Phong", url: "https://web.telegram.org/k/#-4722800862" },
];

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();

/** Tìm link Telegram khớp tên NCC (khớp gần đúng theo chuẩn hoá). */
export function nccTelegram(ncc: string): string | null {
  const n = norm(ncc);
  if (!n) return null;
  const hit = NCC_TELEGRAM.find((x) => {
    const xn = norm(x.name);
    return xn === n || n.includes(xn) || xn.includes(n);
  });
  return hit?.url || null;
}

export interface NccGroup {
  name: string;        // tên NCC hiển thị (lấy từ dữ liệu)
  url: string | null;  // link Telegram nếu khớp
  lay: TCRoute[];
  giao: TCRoute[];
}

/** Gom tuyến Lấy + Giao theo NCC. NCC trống -> nhóm "(Chưa gán NCC)". */
export function groupByNcc(lay: TCRoute[], giao: TCRoute[]): NccGroup[] {
  const map = new Map<string, NccGroup>();
  const add = (r: TCRoute, kind: "lay" | "giao") => {
    const name = (r.ncc || "").trim() || "(Chưa gán NCC)";
    const key = norm(name) || "__none__";
    let g = map.get(key);
    if (!g) { g = { name, url: nccTelegram(name), lay: [], giao: [] }; map.set(key, g); }
    g[kind].push(r);
  };
  lay.forEach((r) => add(r, "lay"));
  giao.forEach((r) => add(r, "giao"));
  // Sắp xếp: nhóm có NCC trước (theo alphabet), nhóm chưa gán cuối.
  return [...map.values()].sort((a, b) => {
    const na = a.name.startsWith("("), nb = b.name.startsWith("(");
    if (na !== nb) return na ? 1 : -1;
    return a.name.localeCompare(b.name, "vi");
  });
}
