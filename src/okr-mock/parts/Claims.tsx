import { tasks } from "../fixtures";
import { claimKey } from "../userState";
import { useMock } from "../state";
import type { ClaimStatus } from "../types";
import { krLabel, nameOf } from "../ui";

/** 見ている人に届いた、資料の記述との結びつき（本人の分だけ） */
function useMyClaims() {
  const { outcomeNotes, claims } = useMock();
  const rows: { noteKey: string; taskId: string; status: ClaimStatus }[] = [];
  for (const n of outcomeNotes) {
    for (const l of n.links) {
      const st = claims[claimKey(n.key, l.taskId)];
      if (st) rows.push({ noteKey: n.key, taskId: l.taskId, status: st });
    }
  }
  const pending = rows.filter((r) => r.status === "pending").length;
  return { rows, pending };
}

export const claimBannerText = (n: number) => `あなたの仕事が成果につながったかもしれません ${n}件`;

/** 「今週ここに力を」の近くに出す件数。確かめる場所は「自分」表示の中 */
export function ClaimsBanner() {
  const { mode, setMode } = useMock();
  const { pending } = useMyClaims();
  if (pending === 0) return null;
  return (
    <div className="mk-claim-banner" role="status">
      <b aria-hidden="true">★</b>
      <span>{claimBannerText(pending)}</span>
      {mode === "self" ? (
        <a className="mk-linkbtn" href="#mk-claims-h">
          確かめる
        </a>
      ) : (
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setMode("self")}>
          「自分」表示で確かめる
        </button>
      )}
    </div>
  );
}

/** 「自分」表示の中。1件ずつ「そのとおり／違う」を選ぶ（文章入力なし）。本人の答えは本人にだけ見える */
export function ClaimsList() {
  const { outcomeNotes, answerClaim, viewerId } = useMock();
  const { rows, pending } = useMyClaims();
  return (
    <div>
      <h3 id="mk-claims-h" className="mk-h3">
        成果につながったかもしれない仕事
      </h3>
      {pending > 0 && (
        <p className="mk-small" role="status">
          <b aria-hidden="true">★</b> {claimBannerText(pending)}
        </p>
      )}
      <p className="mk-muted">AIが、資料の記述からあなたの仕事との関係を推定しました。「そのとおり」を選んだものだけが、KRの詳細と地図の★に出ます（全員に見えます）。「違う」と、まだ答えていないものは、あなた以外には見えません。</p>
      {rows.length === 0 ? (
        <p className="mk-muted">いま確かめるものはありません。「資料を読ませる」で資料を確定すると、ここに届きます。</p>
      ) : (
        rows.map((r) => {
          const n = outcomeNotes.find((x) => x.key === r.noteKey)!;
          const t = tasks.find((x) => x.id === r.taskId)!;
          const reason = n.links.find((l) => l.taskId === t.id)?.reason ?? "";
          const name = `claim-${r.noteKey}-${r.taskId}`;
          return (
            <div key={name} className="mk-claim">
              <div className="mk-small">
                <strong>{krLabel(n.krId)}</strong> {n.change} 「{n.excerpt}」 <span className="mk-muted">{n.sources.map((s) => `${s.doc} ${s.page}`).join("／")}</span>
              </div>
              <div>
                あなたの仕事：<strong>{t.title}</strong>
                <span className="mk-muted">（{nameOf(viewerId)}）</span>
              </div>
              <div className="mk-small mk-muted">AIの推定の理由：{reason}</div>
              <span className="mk-row">
                {(["yes", "no"] as const).map((v) => (
                  <label key={v} className={`mk-choice${r.status === v ? " is-on" : ""}`}>
                    <input type="radio" name={name} checked={r.status === v} onChange={() => answerClaim(r.noteKey, t, v)} /> {v === "yes" ? "そのとおり" : "違う"}
                  </label>
                ))}
                {r.status === "pending" && <span className="mk-chip mk-chip-yellow">未回答</span>}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

