import { tasks } from "../fixtures";
import { movement, pjsForKr, tasksForKr, tasksForTf, TODAY, unconnectedPjs } from "../logic";
import { useMock } from "../state";
import type { Task } from "../types";
import { Avatars } from "../ui";

function Stats({ list, pjCount }: { list: Task[]; pjCount: number }) {
  const mv = movement(list, TODAY);
  return (
    <div className="mk-stats">
      <span>PJ {pjCount}件</span>
      <span>タスク {list.length}件</span>
      <span className="mk-chip">直近7日：更新 {mv.updated}</span>
      <span className="mk-chip mk-chip-green">完了 {mv.completed}</span>
      <span className={`mk-chip ${mv.overdue > 0 ? "mk-chip-red" : ""}`}>期日超過 {mv.overdue}</span>
    </div>
  );
}

const memberIds = (list: Task[]) => [...new Set(list.map((t) => t.assigneeId))];

export function MapScreen() {
  const { items, pjs, locked, linkPj, unlinkPj, openKr } = useMock();
  const obj = items.find((i) => i.kind === "objective")!;
  const krs = items.filter((i) => i.kind === "kr");
  const loose = unconnectedPjs(pjs);
  const tfOptions = items.filter((i) => i.kind === "tf");

  return (
    <div>
      <h1 className="mk-h1">③ OKRマップ</h1>
      <p className="mk-lead">どのPJ・タスクが、どの目標に効いているかを見る画面です。目標の文言は変えられません。紐づけだけ付け替えられます。</p>

      <div className="mk-card mk-obj">
        <div className="mk-row">
          <span className="mk-chip mk-chip-blue">目標</span>
          <strong style={{ fontSize: 17 }}>{obj.text}</strong>
          <span className="mk-spacer" />
          <span className="mk-lock">{locked ? "🔒 確定済み・文言は変更不可" : "未確定（②で確定します）"}</span>
        </div>
      </div>

      {krs.map((kr) => {
        const krTasks = tasksForKr(tasks, pjs, items, kr.id);
        const krPjs = pjsForKr(pjs, items, kr.id);
        const tfs = items.filter((i) => i.kind === "tf" && i.parentId === kr.id);
        return (
          <section key={kr.id} className="mk-card mk-kr" aria-label={kr.label}>
            <div className="mk-row">
              <span className="mk-chip mk-chip-blue">{kr.label}</span>
              <strong>{kr.text}</strong>
              <span className="mk-lock">{locked ? "🔒" : ""}</span>
              <span className="mk-spacer" />
              <Avatars ids={memberIds(krTasks)} />
              <button type="button" className="mk-btn mk-btn-sm" onClick={() => openKr(kr.id)}>
                詳細を見る
              </button>
            </div>
            <Stats list={krTasks} pjCount={krPjs.length} />
            <div className="mk-tfs">
              {tfs.map((tf) => {
                const tfTasks = tasksForTf(tasks, pjs, tf.id);
                const linked = pjs.filter((p) => p.tfIds.includes(tf.id));
                const candidates = pjs.filter((p) => !p.tfIds.includes(tf.id));
                return (
                  <div key={tf.id} className="mk-tf">
                    <div className="mk-row">
                      <span className="mk-chip">{tf.label}</span>
                      <strong className="mk-small">{tf.text}</strong>
                      <span className="mk-lock">{locked ? "🔒" : ""}</span>
                    </div>
                    <Stats list={tfTasks} pjCount={linked.length} />
                    <div style={{ margin: "4px 0 6px" }}>
                      <Avatars ids={memberIds(tfTasks)} />
                    </div>
                    <div>
                      {linked.length === 0 && <span className="mk-muted">紐づくPJはありません</span>}
                      {linked.map((p) => (
                        <span key={p.id} className="mk-pj-pill">
                          {p.name}
                          {p.tfIds.length > 1 && <span title="複数の取り組みに紐づいています">＊</span>}
                          <button type="button" aria-label={`${p.name}の紐づけを外す`} onClick={() => unlinkPj(p.id, tf.id)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <select
                      className="mk-select mk-small"
                      style={{ marginTop: 6 }}
                      aria-label={`${tf.label}にPJを紐づける`}
                      value=""
                      onChange={(e) => e.target.value && linkPj(e.target.value, tf.id)}
                    >
                      <option value="">＋ PJを紐づける…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <h2 className="mk-h2">未接続のPJ</h2>
      <div className="mk-card">
        {loose.length === 0 ? (
          <span className="mk-muted">すべてのPJがどこかの取り組みにつながっています。</span>
        ) : (
          loose.map((p) => {
            const n = tasks.filter((t) => t.pjId === p.id).length;
            return (
              <div key={p.id} className="mk-row" style={{ padding: "6px 0" }}>
                <strong>{p.name}</strong>
                <span className="mk-muted">タスク {n}件・どの目標にも効いていません</span>
                <span className="mk-spacer" />
                <select
                  className="mk-select"
                  style={{ width: 260 }}
                  aria-label={`${p.name}をつなぐ先`}
                  value=""
                  onChange={(e) => e.target.value && linkPj(p.id, e.target.value)}
                >
                  <option value="">つなぐ先の取り組みを選ぶ…</option>
                  {tfOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} {t.text}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
