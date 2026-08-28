/* Parser CSV chịu được dấu phẩy/xuống dòng trong ngoặc kép. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Tìm chỉ số cột theo danh sách từ khoá (khớp tuyệt đối rồi mới khớp chứa). */
export function findCol(header: string[], keys: string[]): number {
  const norm = (s: string) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
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
