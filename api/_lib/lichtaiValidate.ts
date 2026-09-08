/* ============================================================
   Kiểm tra dữ liệu vào cho Lịch Tải (tuyến + điểm dừng) — TÁCH RA từ api/lichtai.ts
   (03/09/2026) để dùng chung với api/lichtai-bulk.ts (tải lên hàng loạt), tránh
   2 bản logic lệch nhau. Giữ NGUYÊN luật cũ (bản cũ lichTaiEdit.ts / api/lichtai.ts).
   ============================================================ */

export const LOAI_HINH = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];
const TIME_RE = /^\d{1,2}:\d{2}$/;

export const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

/** Làm sạch biển số — GIỮ NGUYÊN cleanBks() của src/lib/sheet.ts. */
export function cleanBks(s: string): string {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}

/** Chuẩn hoá giờ: "7:5" -> "07:05", "" giữ rỗng. Trả null nếu sai định dạng. */
export function normTime(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return "";
  if (!TIME_RE.test(s)) return null;
  const [h, m] = s.split(":");
  const hh = Number(h), mm = Number(m);
  if (hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

export class BadInput extends Error {
  /** `code` cho phép trả mã lỗi riêng (vd route_unnamed) thay vì invalid_value chung. */
  constructor(public field: string, public code = "invalid_value") { super(code); }
}

/** Ánh xạ tên trường từ client (camelCase) sang cột DB + kiểm tra giá trị. */
export function routePatch(p: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if ("code" in p) {
    const v = String(p.code || "").trim();
    // Mã tuyến rỗng có mã lỗi RIÊNG -> người dùng thấy đúng câu "Tuyến chưa có tên",
    // không bị gộp vào lỗi "giá trị không hợp lệ" chung chung.
    if (!v) throw new BadInput("code", "route_unnamed");
    if (v.length > 80) throw new BadInput("code");
    out.code = v;
  }
  if ("category" in p) out.category = String(p.category || "").trim().slice(0, 80);
  if ("load" in p) {
    const v = String(p.load ?? "").trim();
    if (v !== "" && !/^\d{1,6}$/.test(v) && !/^van$/i.test(v)) throw new BadInput("load");
    out.load = v;
  }
  if ("ncc" in p) {
    const v = String(p.ncc || "").trim();
    if (v.length > 60) throw new BadInput("ncc");
    out.ncc = v;
  }
  if ("bks" in p) {
    const v = String(p.bks || "").trim();
    if (v.length > 20) throw new BadInput("bks");
    out.bks = cleanBks(v);
  }
  if ("driver" in p) out.driver = String(p.driver || "").trim().slice(0, 80);
  if ("driverPhone" in p) out.driver_phone = String(p.driverPhone || "").trim().slice(0, 30);
  if ("note" in p) out.note = String(p.note || "").slice(0, 500);
  if ("sort" in p) out.sort = Number(p.sort) || 0;
  if ("active" in p) out.active = !!p.active;
  return out;
}

export function stopPatch(p: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if ("kho" in p) {
    const v = String(p.kho || "").trim();
    if (!v || v.length > 120) throw new BadInput("kho");
    out.kho = v;
  }
  if ("loaiHinh" in p) {
    const v = String(p.loaiHinh || "").trim();
    if (v) {
      const hit = LOAI_HINH.find((c) => norm(c) === norm(v));
      if (!hit) throw new BadInput("loaiHinh");
      out.loai_hinh = hit;
    } else out.loai_hinh = "";
  }
  for (const f of ["toi", "roi"] as const) {
    if (f in p) {
      const v = normTime(String(p[f] ?? ""));
      if (v === null) throw new BadInput(f);
      out[f] = v;
    }
  }
  if ("seq" in p) out.seq = Number(p.seq) || 0;
  if ("note" in p) out.note = String(p.note || "").slice(0, 300);
  return out;
}
