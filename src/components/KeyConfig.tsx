import { useEffect, useState } from "react";
import { adminHeaders } from "../lib/useUser";

interface Counts {
  geminiCount: number; groqCount: number; gmapsCount: number; openrouterCount: number; mistralCount: number; githubCount: number; nvidiaCount: number; cohereCount: number;
  sambanovaCount: number; togetherCount: number; chutesCount: number; hyperbolicCount: number; scalewayCount: number; glhfCount: number; deepinfraCount: number; cfextraCount: number;
}
type ProvName = "gemini" | "groq" | "gmaps" | "openrouter" | "mistral" | "github" | "nvidia" | "cohere" | "sambanova" | "together" | "chutes" | "hyperbolic" | "scaleway" | "glhf" | "deepinfra" | "cfextra";

/**
 * Cấu hình khoá AI (chỉ admin). Pool nhiều nhà MIỄN PHÍ chạy song song: Workers AI (sẵn) + Gemini + OpenRouter + Mistral.
 * Mỗi lần Lưu sẽ CỘNG DỒN khoá vào danh sách (tự loại trùng) -> xoay vòng + tự nhảy nhà khi 1 nhà hết lượt.
 */
const EDIT_PW = "t1111"; // mật khẩu để mở khoá việc thêm/xoá khoá AI

export function KeyConfig() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");

  function refresh() {
    fetch("/api/aiconfig").then((r) => r.json()).then((d) => setCounts({
      geminiCount: d.geminiCount || 0, groqCount: d.groqCount || 0, gmapsCount: d.gmapsCount || 0, openrouterCount: d.openrouterCount || 0, mistralCount: d.mistralCount || 0, githubCount: d.githubCount || 0, nvidiaCount: d.nvidiaCount || 0, cohereCount: d.cohereCount || 0,
      sambanovaCount: d.sambanovaCount || 0, togetherCount: d.togetherCount || 0, chutesCount: d.chutesCount || 0, hyperbolicCount: d.hyperbolicCount || 0, scalewayCount: d.scalewayCount || 0, glhfCount: d.glhfCount || 0, deepinfraCount: d.deepinfraCount || 0,
      cfextraCount: d.cfextraCount || 0,
    })).catch(() => {});
  }
  useEffect(refresh, []);

  function tryUnlock() {
    if (pw.trim() === EDIT_PW) { setUnlocked(true); setPwErr(""); setPw(""); }
    else setPwErr("Sai mật khẩu.");
  }

  // Số NHÀ đang hoạt động = Workers AI (luôn có) + mỗi nhà có ≥1 khoá.
  const provCounts = counts
    ? [counts.geminiCount, counts.openrouterCount, counts.mistralCount, counts.githubCount, counts.nvidiaCount, counts.cohereCount,
       counts.sambanovaCount, counts.togetherCount, counts.chutesCount, counts.hyperbolicCount, counts.scalewayCount, counts.glhfCount, counts.deepinfraCount, counts.cfextraCount]
    : [];
  const poolCount = 1 + provCounts.filter((n) => n > 0).length;

  return (
    <details className="section-card keycfg" style={{ marginBottom: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15 }}>
        ⚙️ Khoá AI {counts === null ? "" : `· Pool ${poolCount} nhà ✓`}
      </summary>
      <div style={{ marginTop: 10 }}>
        <p className="lead" style={{ fontSize: 14, margin: "0 0 10px" }}>
          Trợ lý dùng <b>pool nhiều nhà AI miễn phí</b> chạy song song (xoay vòng + tự nhảy nhà khi 1 nhà hết lượt) — nhưng <b>chung một bộ não</b>: cùng kiến thức Sếp dạy & cùng tính năng. Càng nhiều nhà, càng chịu được đông người mà vẫn free.
        </p>
        <p className="lead" style={{ fontSize: 13, margin: "0 0 10px", color: "var(--muted)" }}>
          Đang có (keyless, không cần khoá): <b>Workers AI</b> ✓ · <b>Pollinations</b> ✓ — chạy được ngay cả khi chưa thêm khoá. · Gemini <b>{counts?.geminiCount ?? 0}</b> · OpenRouter <b>{counts?.openrouterCount ?? 0}</b> · Mistral <b>{counts?.mistralCount ?? 0}</b> · GitHub <b>{counts?.githubCount ?? 0}</b> · NVIDIA <b>{counts?.nvidiaCount ?? 0}</b> · Cohere <b>{counts?.cohereCount ?? 0}</b> · SambaNova <b>{counts?.sambanovaCount ?? 0}</b> · Together <b>{counts?.togetherCount ?? 0}</b> · Chutes <b>{counts?.chutesCount ?? 0}</b> · Hyperbolic <b>{counts?.hyperbolicCount ?? 0}</b> · Scaleway <b>{counts?.scalewayCount ?? 0}</b> · GLHF <b>{counts?.glhfCount ?? 0}</b> · DeepInfra <b>{counts?.deepinfraCount ?? 0}</b> khoá · Tài khoản Cloudflare phụ <b>{counts?.cfextraCount ?? 0}</b>.
        </p>

        {!unlocked ? (
          <div className="keycfg-lock">
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>🔒 Nhập mật khẩu để chỉnh khoá:</span>
            <input
              className="pl-in"
              type="password"
              name="m12-aikey-pw"
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              style={{ maxWidth: 180 }}
              placeholder="mật khẩu…"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            />
            <button className="pl-calc" style={{ flex: "0 0 auto", width: "auto", padding: "8px 18px" }} onClick={tryUnlock}>Mở khoá</button>
            {pwErr && <span style={{ color: "var(--red)", fontSize: 14, fontWeight: 700 }}>{pwErr}</span>}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: "var(--green)", fontWeight: 700, marginBottom: 8 }}>✓ Đã mở khoá chỉnh sửa</div>
            <KeyField
              provider="gemini"
              label="Khoá Gemini"
              count={counts?.geminiCount ?? 0}
              hint="Tạo tại aistudio.google.com/apikey (khoá dạng AIza…). Tạo NHIỀU tài khoản Google → nhiều khoá → nhân hạn mức free."
              onChanged={refresh}
            />
            <KeyField
              provider="openrouter"
              label="Khoá OpenRouter (model :free)"
              count={counts?.openrouterCount ?? 0}
              hint="Tạo MIỄN PHÍ tại openrouter.ai/keys (khoá dạng sk-or-…). Dùng model :free (llama 70B, deepseek)."
              onChanged={refresh}
            />
            <KeyField
              provider="mistral"
              label="Khoá Mistral (free tier)"
              count={counts?.mistralCount ?? 0}
              hint="Tạo MIỄN PHÍ tại console.mistral.ai → API Keys. Free tier hạn mức rộng theo tháng."
              onChanged={refresh}
            />
            <KeyField
              provider="github"
              label="Khoá GitHub Models (free)"
              count={counts?.githubCount ?? 0}
              hint="Tạo MIỄN PHÍ: github.com/settings/tokens → Fine-grained / classic token (chỉ cần quyền mặc định). Dùng GPT-4o-mini, Llama 70B… qua GitHub Models — túi quota free riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="nvidia"
              label="Khoá NVIDIA NIM (free)"
              count={counts?.nvidiaCount ?? 0}
              hint="Tạo MIỄN PHÍ tại build.nvidia.com (đăng nhập → API key, dạng nvapi-…). Llama 70B/8B — túi quota free riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="cohere"
              label="Khoá Cohere (free trial)"
              count={counts?.cohereCount ?? 0}
              hint="Tạo MIỄN PHÍ tại dashboard.cohere.com/api-keys (Trial key). Model Command R — túi quota free riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="sambanova"
              label="Khoá SambaNova (free, rất nhanh)"
              count={counts?.sambanovaCount ?? 0}
              hint="Tạo MIỄN PHÍ tại cloud.sambanova.ai → API Keys. Llama 3.3 70B siêu nhanh — túi quota free riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="together"
              label="Khoá Together AI (có model free)"
              count={counts?.togetherCount ?? 0}
              hint="Tạo tại api.together.ai → API Keys. Có model Llama 3.3 70B Turbo FREE — túi quota riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="chutes"
              label="Khoá Chutes.ai (free)"
              count={counts?.chutesCount ?? 0}
              hint="Tạo MIỄN PHÍ tại chutes.ai. DeepSeek V3 / Llama 4 — túi quota free riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="hyperbolic"
              label="Khoá Hyperbolic (free credit)"
              count={counts?.hyperbolicCount ?? 0}
              hint="Tạo tại app.hyperbolic.xyz → Settings → API key. Llama 70B/8B — túi quota riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="scaleway"
              label="Khoá Scaleway (free beta)"
              count={counts?.scalewayCount ?? 0}
              hint="Tạo tại console.scaleway.com → Generative APIs → API key (secret). Llama 70B — túi quota riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="glhf"
              label="Khoá GLHF.chat (free)"
              count={counts?.glhfCount ?? 0}
              hint="Tạo MIỄN PHÍ tại glhf.chat → API. Chạy mọi model HuggingFace (Llama 70B…) — túi quota riêng."
              onChanged={refresh}
            />
            <KeyField
              provider="deepinfra"
              label="Khoá DeepInfra (free credit)"
              count={counts?.deepinfraCount ?? 0}
              hint="Tạo tại deepinfra.com → API Tokens. Llama 70B/8B — túi quota riêng."
              onChanged={refresh}
            />
            <p className="lead" style={{ fontSize: 13.5, margin: "14px 0 8px", fontWeight: 700 }}>
              🚀 Nhân đôi nguồn CHÍNH (Workers AI) — mỗi tài khoản Cloudflare free thêm hẳn 10.000 neuron/ngày riêng, y hệt cách "nhiều tài khoản Google → nhiều khoá Gemini":
            </p>
            <KeyField
              provider="cfextra"
              label="Tài khoản Cloudflare phụ (thêm 10.000 neuron/ngày/tài khoản)"
              count={counts?.cfextraCount ?? 0}
              hint={'Dán theo dạng "account_id:api_token" (1 hoặc nhiều cặp, cách nhau dấu phẩy). Lấy account_id ở trang tổng quan Workers & Pages (góc phải) của tài khoản Cloudflare PHỤ (email khác); lấy token ở My Profile → API Tokens → Create Token → chọn quyền "Workers AI - Edit" cho tài khoản đó.'}
              onChanged={refresh}
            />
            <p className="lead" style={{ fontSize: 13, margin: "2px 0 0", color: "var(--muted)" }}>
              🗺️ Bản đồ &amp; định tuyến dùng <b>OpenStreetMap + OSRM</b> (miễn phí, không cần khoá). Lúc OSRM bận thì tự ước lượng theo đường chim bay nên luôn có km/giờ.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

function KeyField({ provider, label, count, hint, onChanged }: { provider: ProvName; label: string; count: number; hint: string; onChanged: () => void }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function call(action: string, key?: string) {
    const r = await fetch("/api/aiconfig", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action, provider, key }),
    });
    return r.json();
  }

  async function add() {
    const key = val.trim();
    if (key.length < 10) { setMsg("⚠ Khoá quá ngắn."); return; }
    setBusy(true); setMsg("");
    try {
      const d = await call("set-key", key);
      if (d.ok) { setVal(""); setMsg(`✓ Đã thêm ${d.added} khoá (tổng ${d.count}).`); onChanged(); }
      else setMsg("Lỗi: " + (d.error || "không lưu được"));
    } catch (e) {
      setMsg("Lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  async function clearAll() {
    if (!confirm(`Xoá toàn bộ ${count} khoá ${provider}?`)) return;
    setBusy(true); setMsg("");
    try { const d = await call("clear-keys"); if (d.ok) { setMsg("✓ Đã xoá hết."); onChanged(); } }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{label}</span>
        <span style={{ color: count > 0 ? "var(--green)" : "var(--muted)", fontWeight: 800 }}>{count > 0 ? `· đã lưu ${count} khoá ✓` : "· chưa có"}</span>
        {count > 0 && <button className="da-clear" style={{ width: "auto", height: "auto", padding: "2px 8px", fontSize: 13 }} onClick={clearAll} disabled={busy}>Xoá hết</button>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="pl-in" style={{ flex: 1, minWidth: 220 }} placeholder="dán 1 hoặc nhiều khoá, cách nhau dấu phẩy…" value={val} onChange={(e) => setVal(e.target.value)} />
        <button className="pl-calc" onClick={add} disabled={busy}>{busy ? "Đang lưu…" : "Thêm khoá"}</button>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      {msg && <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
    </div>
  );
}
