/* Client bộ nhớ kiến thức trợ lý (/api/knowledge). */
export interface Fact {
  id: string;
  text: string;
  cat?: string;
  ts: number;
}

export async function getKnowledge(): Promise<Fact[]> {
  try {
    const r = await fetch("/api/knowledge", { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()).items || [];
  } catch {
    return [];
  }
}

export async function addKnowledge(text: string, cat?: string): Promise<Fact[]> {
  const r = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, cat }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).items || [];
}

export async function updateKnowledge(id: string, text: string, cat?: string): Promise<Fact[]> {
  const r = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "update", id, text, cat }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).items || [];
}

export async function delKnowledge(id: string): Promise<Fact[]> {
  const r = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).items || [];
}

/** Nhận diện câu "dạy:/nhớ:/ghi nhớ:" — dùng để dạy kiến thức từ MỌI mục chat. */
const TEACH_RE = /^(d[aạ]y|nh[oớ]|ghi nh[oớ])\b\s*[:：]?\s*/i;
export const isTeach = (s: string) => TEACH_RE.test((s || "").trim());
export const stripTeach = (s: string) => (s || "").trim().replace(TEACH_RE, "").trim();

/**
 * Dạy 1 kiến thức cho trợ lý (chắt lọc + gộp nếu trùng) — kho dùng CHUNG cho mọi chat.
 * Trả về câu xác nhận để hiển thị trong chat.
 */
export async function teachKnowledge(rawOrText: string): Promise<string> {
  const text = stripTeach(rawOrText);
  if (!text) return "Dạ Sếp muốn dạy em điều gì ạ?";
  try {
    const facts = await getKnowledge();
    const org = await organizeKnowledge(text, facts);
    if (org && org.action === "merge" && org.mergeId) {
      await updateKnowledge(org.mergeId, org.text, org.cat);
      return `🔄 Dạ, ý này trùng nên em đã GỘP vào mục “${org.cat}”: “${org.text}”. (Kiến thức dùng chung cho mọi mục chat ạ.)`;
    }
    if (org && org.text) {
      await addKnowledge(org.text, org.cat);
      return `📌 Dạ, em đã ghi nhớ vào mục “${org.cat}”: “${org.text}”. (Mọi mục chat đều dùng chung kiến thức này ạ.)`;
    }
    await addKnowledge(text);
    return `📌 Dạ, em đã ghi nhớ: “${text}” (lát em tự sắp vào mục phù hợp ạ).`;
  } catch {
    try { await addKnowledge(text); return `📌 Dạ, em đã ghi nhớ: “${text}”.`; }
    catch { return "Dạ em chưa lưu được, Sếp thử lại giúp em nhé."; }
  }
}

/** Nhờ AI chắt lọc: kiến thức mới trùng/chồng kho cũ thì gộp, gán chủ đề. */
export async function organizeKnowledge(
  text: string,
  facts: Fact[]
): Promise<{ action: "new" | "merge"; mergeId: string; text: string; cat: string } | null> {
  try {
    const r = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "organize", text, facts: facts.map((f) => ({ id: f.id, text: f.text })) }),
    });
    const d = await r.json();
    let raw = String(d?.reply || "").trim();
    const m = raw.match(/\{[\s\S]*\}/); // bóc JSON nếu có chữ thừa
    if (m) raw = m[0];
    const o = JSON.parse(raw);
    if (o && (o.action === "new" || o.action === "merge") && o.text) {
      return { action: o.action, mergeId: String(o.mergeId || ""), text: String(o.text), cat: String(o.cat || "Khác") };
    }
  } catch {
    /* fallback */
  }
  return null;
}
