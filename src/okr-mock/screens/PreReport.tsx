import { useMemo, useState } from "react";
import { members, tasks } from "../fixtures";
import { buildMatrix, buildPreReport, buildReportMarkdown, diffDays, formatMd, tasksForKr, TODAY, type MemberTasks } from "../logic";
import { useMock } from "../state";
import type { Task, Team } from "../types";
import { DueLabel, StatusChip } from "../ui";
import { ReminderModal } from "./ReminderModal";

export function PreReport({ team }: { team: Team }) {
  const { items, pjs, reminded, markReminded, showToast } = useMock();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);

  const report = useMemo(() => buildPreReport({ team, members, items, pjs, tasks, today: TODAY }), [team, items, pjs]);
  const krs = items.filter((i) => i.kind === "kr");
  const teamMembers = members.filter((m) => m.teamId === team.id);
  const matrix = useMemo(() => {
    const byKr = Object.fromEntries(krs.map((k) => [k.id, tasksForKr(tasks, pjs, items, k.id)]));
    return buildMatrix(teamMembers, krs.map((k) => k.id), byKr, TODAY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, items, pjs]);
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
      <td>{reminded.has(t.id) && <span className="mk-chip mk-chip-yellow">催促済み</span>}</td>
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

  const md = () => buildReportMarkdown({ report, krLabel: label, tfLabel: label, pjName, today: TODAY });
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
          催促を送る（{picked.size}件選択中）
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
                  <td>{reminded.has(t.id) && <span className="mk-chip mk-chip-yellow">催促済み</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mk-h2">メンバー × KR（直近7日の更新／未完了）</h3>
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
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.member.id}>
                  <td>{r.member.name}</td>
                  {krs.map((k) => {
                    const c = r.cells[k.id];
                    const warn = c.open > 0 && c.updated === 0;
                    return (
                      <td key={k.id} className={`mk-cell mk-cell-l${level(c.updated)}${warn ? " mk-cell-warn" : ""}`}>
                        {c.updated === 0 && c.open === 0 ? "—" : `更新${c.updated}／未完了${c.open}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mk-muted">色が濃いほど今週の更新が多い。黄色の枠は、未完了があるのに今週まったく動いていないところ。</p>
      </div>

      {modal && (
        <ReminderModal
          selected={selectedTasks}
          checkin={report.checkin}
          onClose={() => setModal(false)}
          onSend={() => {
            markReminded(selectedTasks.map((t) => t.id));
            setPicked(new Set());
            setModal(false);
            showToast("送信済み（モック）");
          }}
        />
      )}
    </div>
  );
}
