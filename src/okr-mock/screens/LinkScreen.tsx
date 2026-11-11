import { tasks } from "../fixtures";
import { SYNERGY_LABEL } from "../logic";
import { useMock } from "../state";
import type { Synergy } from "../types";
import { Avatar, DueLabel, memberOf, StatusChip } from "../ui";

export function SynergyBody({ s }: { s: Synergy }) {
  const { items } = useMock();
  const krLabels = s.krIds.map((id) => items.find((i) => i.id === id)?.label ?? id).join("・");
  const evidence = s.taskIds.map((id) => tasks.find((t) => t.id === id)).filter((t) => !!t);
  return (
    <>
      <div className="mk-row">
        <span className="mk-chip mk-chip-blue">{SYNERGY_LABEL[s.type]}</span>
        <strong>{krLabels}</strong>
        {s.fixed && <span className="mk-chip mk-chip-yellow">AIの提案（モックでは固定の例）</span>}
      </div>
      <p style={{ margin: "6px 0" }}>{s.summary}</p>
      <table className="mk-table">
        <tbody>
          {evidence.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>
                <span className="mk-row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <Avatar id={t.assigneeId} />
                  <span className="mk-small">{memberOf(t.assigneeId)?.name}</span>
                </span>
              </td>
              <td>
                <DueLabel task={t} />
              </td>
              <td>
                <StatusChip status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function LinkScreen() {
  const { synergies, synergyStatus, setSynergyStatus, showToast } = useMock();
  const pending = synergies.filter((s) => !synergyStatus[s.id]);
  const decided = synergies.filter((s) => synergyStatus[s.id]);

  const card = (s: Synergy) => {
    const st = synergyStatus[s.id];
    return (
      <div key={s.id} className="mk-card" style={st === "skipped" ? { opacity: 0.65 } : undefined}>
        <SynergyBody s={s} />
        <div className="mk-row" style={{ marginTop: 8 }}>
          {!st ? (
            <>
              <button
                type="button"
                className="mk-btn mk-btn-primary mk-btn-sm"
                onClick={() => {
                  setSynergyStatus(s.id, "picked");
                  showToast("チェックインで取り上げます（事前レポートと会議モードに出ます）");
                }}
              >
                チェックインで取り上げる
              </button>
              <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSynergyStatus(s.id, "skipped")}>
                今回は見送る
              </button>
            </>
          ) : (
            <>
              <span className={`mk-chip ${st === "picked" ? "mk-chip-green" : ""}`}>{st === "picked" ? "チェックインで取り上げる" : "今回は見送り"}</span>
              <button type="button" className="mk-btn mk-btn-sm" onClick={() => setSynergyStatus(s.id, undefined)}>
                取り上げ待ちに戻す
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h1 className="mk-h1">つながり（KRをまたぐシナジーの候補）</h1>
      <p className="mk-lead">
        別々のKRで進んでいる仕事の中から、つなげると良さそうなものを候補として出します。取り上げるかどうかを決めるのは人です。
        種類は4つ：同じ相手・対象／受け渡し／重複／集中。
      </p>
      <h2 className="mk-h2">取り上げ待ち（{pending.length}件）</h2>
      {pending.length === 0 && <p className="mk-muted">取り上げ待ちの候補はありません。</p>}
      <div className="mk-grid mk-grid-2">{pending.map(card)}</div>
      <h2 className="mk-h2">決めたもの（{decided.length}件）</h2>
      {decided.length === 0 && <p className="mk-muted">まだありません。</p>}
      <div className="mk-grid mk-grid-2">{decided.map(card)}</div>
    </div>
  );
}
