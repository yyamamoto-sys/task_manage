import { tasks } from "../fixtures";
import { formatMd, movement, pjsForKr, tasksForKr, TODAY, weeklyCompleted } from "../logic";
import { useMock, useWeek } from "../state";
import { memberOf, DueLabel, StatusChip, Avatar, ScopeBadge, SharedMark, WeekNote } from "../ui";
import { TfStatus } from "./TfStatus";

const WEEK_LABELS = ["3週前", "2週前", "先週", "今週"];

export function KrDetailScreen() {
  const { items, pjs, selectedKr, setSelectedKr, synergies, synergyStatus, setScreen } = useMock();
  const { win } = useWeek();
  const krs = items.filter((i) => i.kind === "kr");
  const kr = krs.find((k) => k.id === selectedKr) ?? krs[0];
  const list = tasksForKr(tasks, pjs, items, kr.id).sort((a, b) => a.due.localeCompare(b.due));
  const krPjs = pjsForKr(pjs, items, kr.id);
  const bars = weeklyCompleted(list, TODAY, 4);
  const max = Math.max(1, ...bars);
  const mv = movement(list, TODAY, win);
  const krSynergies = synergies.filter((s) => s.krIds.includes(kr.id));
  const krPending = krSynergies.filter((s) => !synergyStatus[s.id]).length;
  const pjName = (id: string) => pjs.find((p) => p.id === id)?.name ?? "";

  return (
    <div>
      <h1 className="mk-h1">④ KR詳細</h1>
      <div className="mk-tabs" role="tablist" aria-label="KRの選択">
        {krs.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={k.id === kr.id} className={`mk-tab${k.id === kr.id ? " is-active" : ""}`} onClick={() => setSelectedKr(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <WeekNote />
      <div className="mk-card">
        <strong style={{ fontSize: 17 }}>
          {kr.label} {kr.text}
        </strong>{" "}
        <span className="mk-lock">🔒 半期の間は変更不可</span> <ScopeBadge tasks={list} />
        <div className="mk-stats" style={{ marginTop: 8 }}>
          <span>PJ {krPjs.length}件</span>
          <span>タスク {list.length}件（共有PJは1回だけ数えています）</span>
          <span className="mk-chip">今週：更新 {mv.updated}</span>
          <span className="mk-chip mk-chip-green">完了 {mv.completed}</span>
          <span className={`mk-chip ${mv.overdue ? "mk-chip-red" : ""}`}>期日超過 {mv.overdue}</span>
        </div>
      </div>

      <div className="mk-grid mk-grid-2" style={{ marginTop: 12 }}>
        <div className="mk-card">
          <strong>直近4週の完了件数</strong>
          <div className="mk-bars" role="img" aria-label={`直近4週の完了件数：${bars.join("、")}`}>
            {bars.map((n, i) => (
              <div key={i} className="mk-bar-col">
                <span>{n}</span>
                <div className="mk-bar" style={{ height: `${(n / max) * 60}px` }} />
                <span className="mk-muted">{WEEK_LABELS[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mk-card">
          <strong>つながりの候補</strong>
          <p style={{ margin: "6px 0" }}>
            このKRに関わる候補が{krSynergies.length}件あります（取り上げ待ち {krPending}件）。
          </p>
          <button type="button" className="mk-btn mk-btn-sm" onClick={() => setScreen("link")}>
            つながりの画面を開く
          </button>
        </div>
      </div>

      <h2 className="mk-h2">TFの状況（タスクの動き・リーダーの申告・今月のチェックポイント）</h2>
      <div className="mk-card">
        <TfStatus krId={kr.id} />
      </div>

      <h2 className="mk-h2">紐づくPJ</h2>
      <div>
        {krPjs.map((p) => (
          <span key={p.id} style={{ marginRight: 10, display: "inline-block", marginBottom: 4 }}>
            <span className="mk-chip mk-chip-blue">{p.name}</span>
            <SharedMark pj={p} items={items} />
          </span>
        ))}
      </div>

      <h2 className="mk-h2">タスク一覧（期日の近い順）</h2>
      <div className="mk-card mk-table-wrap" style={{ padding: 0 }}>
        <table className="mk-table">
          <thead>
            <tr>
              <th>タスク</th>
              <th>PJ</th>
              <th>担当</th>
              <th>期日</th>
              <th>状態</th>
              <th>最終更新</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td className="mk-small">{pjName(t.pjId)}</td>
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
                <td className="mk-small">{formatMd(t.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
