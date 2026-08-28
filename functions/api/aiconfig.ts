/* ============================================================
   Cấu hình khoá Gemini cho trợ lý — lưu trong KV (cfg:gemini).
   GET  /api/aiconfig            -> { hasKey }
   POST /api/aiconfig {action:"set-key", token, key}  (token = ADMIN_TOKEN)
   Khoá không bao giờ trả về client; chỉ dùng server-side ở /api/assistant.
   ============================================================ */
import { isAdminReq } from "./_admin";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function countKeys(env: any, provider: string, envVar: string): Promise<number> {
  let n = 0;
  try { const v = env.QA_KV ? await env.QA_KV.get("cfg:" + provider) : null; if (v) n += v.split(/[\s,]+/).filter(Boolean).length; } catch { /* bỏ qua */ }
  if (env[envVar]) n += String(env[envVar]).split(/[\s,]+/).filter(Boolean).length;
  return n;
}

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  const geminiCount = await countKeys(env, "gemini", "GEMINI_API_KEY");
  const groqCount = await countKeys(env, "groq", "GROQ_API_KEY");
  const gmapsCount = await countKeys(env, "gmaps", "GOOGLE_MAPS_KEY");
  const openrouterCount = await countKeys(env, "openrouter", "OPENROUTER_API_KEY");
  const mistralCount = await countKeys(env, "mistral", "MISTRAL_API_KEY");
  const githubCount = await countKeys(env, "github", "GITHUB_TOKEN");
  const nvidiaCount = await countKeys(env, "nvidia", "NVIDIA_API_KEY");
  const cohereCount = await countKeys(env, "cohere", "COHERE_API_KEY");
  const sambanovaCount = await countKeys(env, "sambanova", "SAMBANOVA_API_KEY");
  const togetherCount = await countKeys(env, "together", "TOGETHER_API_KEY");
  const chutesCount = await countKeys(env, "chutes", "CHUTES_API_KEY");
  const hyperbolicCount = await countKeys(env, "hyperbolic", "HYPERBOLIC_API_KEY");
  const scalewayCount = await countKeys(env, "scaleway", "SCALEWAY_API_KEY");
  const glhfCount = await countKeys(env, "glhf", "GLHF_API_KEY");
  const deepinfraCount = await countKeys(env, "deepinfra", "DEEPINFRA_API_KEY");
  // Tài khoản Cloudflare PHỤ (mỗi cái "account_id:token") — cộng dồn thêm neuron Workers AI/ngày.
  const cfextraCount = await countKeys(env, "cfextra", "CF_EXTRA_ACCOUNTS");
  return json({
    hasKey: geminiCount + groqCount > 0,
    hasGemini: geminiCount > 0,
    hasGroq: groqCount > 0,
    geminiCount,
    groqCount,
    gmapsCount,
    openrouterCount,
    mistralCount,
    githubCount,
    nvidiaCount,
    cohereCount,
    sambanovaCount,
    togetherCount,
    chutesCount,
    hyperbolicCount,
    scalewayCount,
    glhfCount,
    deepinfraCount,
    cfextraCount,
  });
};

const PROVIDERS = ["gemini", "groq", "gmaps", "openrouter", "mistral", "github", "nvidia", "cohere", "sambanova", "together", "chutes", "hyperbolic", "scaleway", "glhf", "deepinfra", "cfextra"];

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const action = body?.action;
  // Xác thực: admin = email nội bộ @ghn.vn (header x-user-email) — hoặc ADMIN_TOKEN cũ.
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);

  let has = false;
  try {
    has = !!(env.QA_KV && (await env.QA_KV.get("cfg:gemini")));
  } catch {
    /* bỏ qua */
  }
  has = has || !!env.GEMINI_API_KEY;

  // Chỉ xác thực mật khẩu (dùng khoá đã lưu sẵn) — không cần dán lại khoá.
  if (action === "verify") return json({ ok: true, hasKey: has });

  // THÊM khoá — provider "gemini" (mặc định) hoặc "groq". Cộng dồn vào danh sách (loại trùng).
  if (action === "set-key") {
    const provider = PROVIDERS.includes(body?.provider) ? body.provider : "gemini";
    const incoming = String(body?.key || "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length >= 10);
    if (!incoming.length) return json({ error: "key_invalid" }, 400);
    if (!env.QA_KV) return json({ error: "no_kv" }, 500);
    const existing = (await env.QA_KV.get("cfg:" + provider)) || "";
    const set = new Set(existing.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean));
    let added = 0;
    for (const k of incoming) if (!set.has(k)) { set.add(k); added++; }
    const list = [...set];
    await env.QA_KV.put("cfg:" + provider, list.join(","));
    return json({ ok: true, provider, count: list.length, added });
  }

  // Xoá hết khoá của 1 nguồn.
  if (action === "clear-keys") {
    const provider = PROVIDERS.includes(body?.provider) ? body.provider : "gemini";
    if (env.QA_KV) await env.QA_KV.delete("cfg:" + provider);
    return json({ ok: true, provider, count: 0 });
  }
  return json({ error: "bad_request" }, 400);
};
