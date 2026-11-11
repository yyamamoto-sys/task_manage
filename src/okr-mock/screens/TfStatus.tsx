import { tasks } from "../fixtures";
import { checkpointOf, formatMd, inWindow, movement, tasksForTf, TODAY } from "../logic";
import { useMock, useWeek } from "../state";
import type { ReportLevel } from "../types";
import { LevelChip, memberOf, ScopeBadge } from "../ui";

const LEVELS: ReportLevel[] = ["順調", "注意", "相談したい"];
const MONTH = TODAY.slice(0, 7);

/** KRの下のTFごとに、タスクの動き・リーダーの週1回の自己申告・今月のチェックポイントを並べる */
export function TfStatus({ krId, editable = false }: { krId: string; editable?: boolean }) {
  const { items, pjs, reports, setReport, checkpoints } = useMock();
  const { win } = useWeek();
  const tfs = items.filter((i) => i.kind === "tf" && i.parentId === krId);

  return (
    <div className="mk-table-wrap">
      <table className="mk-table">
        <thead>
          <tr>
            <th>TF</th>
            <th>タスクの動き（今週）</th>
            <th>リーダーの申告（週1回）</th>
            <th>今月のチェックポイント</th>
          </tr>
        </thead>
        <tbody>
          {tfs.map((tf) => {
            const list = tasksForTf(tasks, pjs, tf.id);
            const mv = movement(list, TODAY, win);
            const rep = reports[tf.id];
            const fresh = rep && inWindow(rep.date, win);
            const cp = checkpointOf(checkpoints, tf.id, MONTH);
            return (
              <tr key={tf.id} style={{ verticalAlign: "top" }}>
                <td>
                  <span className="mk-chip">{tf.label}</span> <span className="mk-small">{tf.text}</span>
                  <div className="mk-muted">リーダー：{tf.leaderId ? memberOf(tf.leaderId)?.name : "未設定"}</div>
                </td>
                <td className="mk-small">
                  <ScopeBadge tasks={list} />
                  {list.length > 0 && (
                    <div>
                      更新 {mv.updated}／完了 {mv.completed}／期日超過 {mv.overdue}（全{list.length}件）
                    </div>
                  )}
                </td>
                <td className="mk-small">
                  {editable ? (
                    <>
                      <div className="mk-row" role="group" aria-label={`${tf.label}の申告`}>
                        {LEVELS.map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            className={`mk-btn mk-btn-sm${rep?.level === lv ? " mk-btn-primary" : ""}`}
                            aria-pressed={rep?.level === lv}
                            onClick={() => setReport(tf.id, { level: lv })}
                          >
                            {lv}
                          </button>
                        ))}
                      </div>
                      <input
                        className="mk-input"
                        style={{ marginTop: 4 }}
                        aria-label={`${tf.label}の一言`}
                        value={rep?.note ?? ""}
                        onChange={(e) => setReport(tf.id, { note: e.target.value })}
                        placeholder="一言"
                      />
                    </>
                  ) : rep ? (
                    <>
                      <LevelChip level={rep.level} /> {rep.note}
                    </>
                  ) : (
                    <span className="mk-muted">申告なし</span>
                  )}
                  {rep && (
                    <div className="mk-muted">
                      {fresh ? `${formatMd(rep.date)}の申告` : `今週はまだ申告がありません（前回：${formatMd(rep.date)}）`}
                    </div>
                  )}
                </td>
                <td className="mk-small">{cp ? cp.text : <span className="mk-muted">未取込</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
