import { useMemo } from "react";
import { eventCheckpoints, type XtcRec } from "../lib/xinTangCuong";
import { Kpi } from "./XinTcCompare";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * SO SÁNH THEO EVENT: 3 mốc cố định trong tháng (ngày 7 / 15 / 25) — vd 7/7 vs 6/6,
 * 15/7 vs 15/6, 25/7 vs 25/6. So ĐÚNG NGÀY đó (không cộng dồn) để thấy sức nóng thật
 * của từng mốc. Mốc chưa tới hôm nay -> hiện "chưa tới", KHÔNG suy đoán số.
 */
export function XinTcEventCompare({ recs, monthSel }: { recs: XtcRec[]; monthSel: string }) {
  const cps = useMemo(() => eventCheckpoints(recs, monthSel), [recs, monthSel]);
  const reached = cps.filter((c) => c.reached);

  const insight = (() => {
    if (!reached.length) return "Chưa tới mốc nào trong tháng này để so sánh.";
    const parts = reached.map((c) => {
      // Số quá nhỏ (cả 2 vế <5) -> % dễ biến dạng ảo (vd 2->3 lượt = "+50%" nhưng thực ra chỉ +1),
      // chỉ nêu % khi đủ lớn để có ý nghĩa, còn không thì nêu thẳng số tuyệt đối.
      const tinySample = c.curTotal < 5 && c.prevTotal < 5;
      const chg = c.prevTotal ? Math.round((c.curTotal / c.prevTotal - 1) * 100) : null;
      const dir = chg == null ? "" : tinySample ? " (số còn ít, % chỉ tham khảo)" : chg > 5 ? ` (tăng ${chg}%)` : chg < -5 ? ` (giảm ${Math.abs(chg)}%)` : " (≈ đi ngang)";
      return `Ngày ${c.day}: <b>${c.curTotal}</b> vs <b>${c.prevTotal}</b> lượt${dir}`;
    });
    const pending = cps.length - reached.length;
    return parts.join(" · ") + (pending ? `. Còn ${pending} mốc chưa tới.` : ".");
  })();

  return (
    <div>
      <h3 style={{ fontSize: 15.5, margin: "0 0 4px" }}>🎯 So sánh theo Event — 3 mốc ngày trong tháng</h3>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 13.5 }}>
        So <b>đúng ngày</b> (không cộng dồn) giữa tháng này và tháng trước tại 3 mốc cố định: ngày 7 · 15 · 25 — dùng theo dõi sức nóng event lặp lại theo tháng.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {cps.map((c) => (
          <div key={c.day} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", opacity: c.reached ? 1 : 0.6 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 2 }}>Mốc ngày {c.day}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>{ddmm(c.curIso)} <span style={{ opacity: .7 }}>vs {ddmm(c.prevIso)}</span></div>
            {!c.reached ? (
              <div style={{ fontSize: 13.5, color: "var(--muted)", fontStyle: "italic", padding: "10px 0" }}>⏳ Chưa tới ngày này</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Kpi
                  label="Lượt xin"
                  cur={String(c.curTotal)}
                  prev={String(c.prevTotal)}
                  delta={c.prevTotal ? `${c.curTotal >= c.prevTotal ? "+" : ""}${Math.round((c.curTotal / c.prevTotal - 1) * 100)}%` : undefined}
                  color={c.curTotal > c.prevTotal ? "var(--red)" : c.curTotal < c.prevTotal ? "var(--green)" : "var(--ink)"}
                />
                <Kpi
                  label="Đáp ứng"
                  cur={pct(c.curRate)}
                  prev={pct(c.prevRate)}
                  delta={c.curRate != null && c.prevRate != null ? `${Math.round((c.curRate - c.prevRate) * 100) >= 0 ? "+" : ""}${Math.round((c.curRate - c.prevRate) * 100)}đ` : undefined}
                  color={c.curRate != null && c.prevRate != null && c.curRate < c.prevRate ? "var(--red)" : "var(--green)"}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-body)", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}
        dangerouslySetInnerHTML={{ __html: "<b>🤖 Nhận xét:</b> " + insight }} />
    </div>
  );
}
