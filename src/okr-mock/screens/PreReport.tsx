import { useMemo, useState } from "react";
import { members, tasks } from "../fixtures";
import { buildMatrix, buildPreReport, buildReportMarkdown, checkpointOf, diffDays, formatMd, formatWindow, SYNERGY_LABEL, tasksForKr, TODAY, type MemberTasks } from "../logic";
import { useMock } from "../state";
import type { Task, Team } from "../types";
import { DueLabel, StatusChip } from "../ui";
import { SynergyBody } from "./LinkScreen";
import { ReminderModal } from "./ReminderModal";
import { TfStatus } from "./TfStatus";

export function PreReport({ team }: { team: Team }) {
  const { items, pjs, reminded, markReminded, showToast, pickedSynergies, reports, checkpoints } = useMock();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const [includeManager, setIncludeManager] = useState(true);

  const report = useMemo(() => buildPreReport({ team, members, items, pjs, tasks, today: TODAY }), [team, items, pjs]);
  const krs = items.filter((i) => i.kind === "kr");
  const teamMembers = members.filter((m) => m.teamId === team.id);
  const matrixMembers = includeManager
    ? [...teamMembers, ...members.filter((m) => m.isManager && m.teamId !== team.id)]
    : teamMembers.filter((m) => !m.isManager);
  const matrix = useMemo(() => {
    const byKr = Object.fromEntries(krs.map((k) => [k.id, tasksForKr(tasks, pjs, items, k.id)]));
    return buildMatrix(matrixMembers, krs.map((k) => k.id), byKr, report.window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, items, pjs, includeManager, report]);
  const pjName = (id: string) => pjs.find((p) => p.id === id)?.name ?? "";
  const label = (id: string) => items.find((i) => i.id === id)?.label ?? "";
  const text = (id: string) => items.find((i) => i.id === id)?.text ?? "";

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectedTasks = tasks.filter((t) => picked.has(t.id));

  const TaskRow = ({ t }: { t: Task }) => (
    <tr>
      <td className="print-hide" style={{ width: 32 }}>
        <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`${t.title}を催促の対象にする`} />
      </td>
      <td>{t.title}</td>
      <td className="mk-small">{pjName(t.pjId)}</td>
      <td>
        <DueLabel task={t} />
      </td>
      <td>
        <StatusChip status={t.status} />
      </td>
      <td>{reminded.has(t.id) && <span className="mk-chip mk-chip-yellow">文面コピー済み</span>}</td>
    </tr>
  );

  const Group = ({ groups, empty }: { groups: MemberTasks[]; empty: string }) =>
    groups.length === 0 ? (
      <p className="mk-muted">{empty}</p>
    ) : (
      <>
        {groups.map((g) => (
          <div key={g.member.id} style={{ marginBottom: 8 }}>
            <strong className="mk-small">
              {g.member.name}（{g.tasks.length}件）
            </strong>
            <table className="mk-table">
              <tbody>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    );

  const selfLines = items
    .filter((i) => i.kind === "tf")
    .map((tf) => {
      const r = reports[tf.id];
      const cp = checkpointOf(checkpoints, tf.id, TODAY.slice(0, 7));
      return `- ${tf.label} ${tf.text}：${r ? `${r.level}（${formatMd(r.date)}）${r.note}` : "申告なし"}／今月のチェックポイント：${cp?.text ?? "未取込"}`;
    });
  const linkLines = pickedSynergies.map((s) => `- [${SYNERGY_LABEL[s.type]}] ${s.krIds.map(label).join("・")}：${s.summary}`);
  const md = () => buildReportMarkdown({ report, krLabel: label, tfLabel: label, pjName, today: TODAY, selfLines, linkLines });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md());
      showToast("レポートをテキスト（Markdown）でコピーしました");
    } catch {
      showToast("コピーできませんでした。ブラウザの許可を確認してください");
    }
  };

  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3);

  return (
    <div>
      <div className="mk-row print-hide" style={{ marginBottom: 10 }}>
        <button type="button" className="mk-btn mk-btn-primary" disabled={picked.size === 0} onClick={() => setModal(true)}>
          催促の文面を作る（{picked.size}件選択中）
        </button>
        <span className="mk-spacer" />
        <button type="button" className="mk-btn" onClick={copy}>
          テキストでコピー
        </button>
        <button type="button" className="mk-btn" onClick={() => window.print()}>
          レポートを出力（印刷）
        </button>
      </div>
      <div className="mk-card">
        <h2 className="mk-h2" style={{ marginTop: 0 }}>
          {team.name} 事前レポート（チェックイン {formatMd(report.checkin)}）
        </h2>

        <p className="mk-small" style={{ margin: "0 0 4px" }}>
          今週の動きの期間：<strong>{formatWindow(report.window)}</strong>（前回チェックインの翌日〜今回のチェックイン日）
        </p>

        <h3 className="mk-h2">
          チェックイン日までに期日が来る未完了のタスク <span className="mk-chip">{report.dueSoon.reduce((n, g) => n + g.tasks.length, 0)}件</span>
        </h3>
        <Group groups={report.dueSoon} empty="該当するタスクはありません。" />

        <h3 className="mk-h2">
          期日を過ぎているタスク <span className="mk-chip mk-chip-red">{report.overdue.reduce((n, g) => n + g.tasks.length, 0)}件</span>
        </h3>
        <Group groups={report.overdue} empty="期日超過はありません。" />

        <h3 className="mk-h2">7日以上動きのないもの</h3>
        {report.staleKrIds.length + report.staleTfIds.length + report.staleTasks.length === 0 && <p className="mk-muted">ありません。</p>}
        <div style={{ marginBottom: 6 }}>
          {report.staleKrIds.map((id) => (
            <span key={id} className="mk-chip mk-chip-yellow" style={{ marginRight: 6 }}>
              {label(id)} {text(id)}（全体が停滞）
            </span>
          ))}
          {report.staleTfIds.map((id) => (
            <span key={id} className="mk-chip mk-chip-yellow" style={{ marginRight: 6 }}>
              {label(id)} {text(id)}（全体が停滞）
            </span>
          ))}
        </div>
        {report.staleTasks.length > 0 && (
          <table className="mk-table">
            <tbody>
              {report.staleTasks.map((t) => (
                <tr key={t.id}>
                  <td className="print-hide" style={{ width: 32 }}>
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`${t.title}を催促の対象にする`} />
                  </td>
                  <td>{t.title}</td>
                  <td className="mk-small">{pjName(t.pjId)}</td>
                  <td className="mk-small">{members.find((m) => m.id === t.assigneeId)?.name}</td>
                  <td className="mk-small">{diffDays(TODAY, t.updated)}日動きなし</td>
                  <td>{reminded.has(t.id) && <span className="mk-chip mk-chip-yellow">文面コピー済み</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mk-h2">タスク未登録</h3>
        {report.unregisteredKrIds.length + report.unregisteredTfIds.length === 0 ? (
          <p className="mk-muted">ありません。</p>
        ) : (
          <div style={{ marginBottom: 6 }}>
            {[...report.unregisteredKrIds, ...report.unregisteredTfIds].map((id) => (
              <span key={id} className="mk-chip mk-chip-yellow" style={{ marginRight: 6 }}>
                {label(id)} {text(id)}（タスク未登録）
              </span>
            ))}
          </div>
        )}

        <h3 className="mk-h2">TFリーダーの申告と今月のチェックポイント</h3>
        {krs.map((k) => (
          <div key={k.id} style={{ marginBottom: 8 }}>
            <strong className="mk-small">
              {k.label} {k.text}
            </strong>
            <TfStatus krId={k.id} />
          </div>
        ))}

        <h3 className="mk-h2">つながり（チェックインで取り上げるもの）</h3>
        {pickedSynergies.length === 0 ? (
          <p className="mk-muted">取り上げると決めた候補はありません。「つながり」の画面で選べます。</p>
        ) : (
          pickedSynergies.map((s) => (
            <div key={s.id} className="mk-card" style={{ boxShadow: "none" }}>
              <SynergyBody s={s} />
            </div>
          ))
        )}

        <div className="mk-row" style={{ margin: "20px 0 8px" }}>
          <h3 className="mk-h2" style={{ margin: 0 }}>メンバー × KR（今週の更新／未完了）</h3>
          <span className="mk-spacer" />
          <label className="mk-small print-hide">
            <input type="checkbox" checked={includeManager} onChange={(e) => setIncludeManager(e.target.checked)} /> マネージャー本人を含める
          </label>
        </div>
        <div className="mk-table-wrap">
          <table className="mk-table mk-matrix">
            <thead>
              <tr>
                <th>メンバー</th>
                {krs.map((k) => (
                  <th key={k.id} style={{ textAlign: "center" }}>
                    {k.label}
                  </th>
                ))}
                <th style={{ textAlign: "center" }}>合計（重複なし）</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.member.id}>
                  <td>
                    {r.member.name}
                    {r.member.isManager && <span className="mk-muted">（マネージャー）</span>}
                  </td>
                  {krs.map((k) => {
                    const c = r.cells[k.id];
                    const warn = c.open > 0 && c.updated === 0;
                    return (
                      <td key={k.id} className={`mk-cell mk-cell-l${level(c.updated)}${warn ? " mk-cell-warn" : ""}`}>
                        {c.updated === 0 && c.open === 0 ? "—" : `更新${c.updated}／未完了${c.open}`}
                      </td>
                    );
                  })}
                  <td className="mk-cell">
                    <strong>{r.total.updated === 0 && r.total.open === 0 ? "—" : `更新${r.total.updated}／未完了${r.total.open}`}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>合計</strong>
                </td>
                {krs.map((k) => (
                  <td key={k.id} className="mk-cell">
                    更新{matrix.footer.cells[k.id].updated}／未完了{matrix.footer.cells[k.id].open}
                  </td>
                ))}
                <td className="mk-cell">
                  <strong>
                    更新{matrix.footer.total.updated}／未完了{matrix.footer.total.open}
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mk-muted">
          色が濃いほど今週の更新が多い。黄色の枠は、未完了があるのに今週まったく動いていないところ。複数のKRにまたがる共有PJのタスクは、KRごとには数えますが、右端と下の合計では1回だけ数えています。
        </p>
      </div>

      {modal && (
        <ReminderModal
          selected={selectedTasks}
          checkin={report.checkin}
          onClose={() => setModal(false)}
          onCopied={(ids) => markReminded(ids)}
        />
      )}
    </div>
  );
}
