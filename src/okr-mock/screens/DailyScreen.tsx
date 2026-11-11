import { OWNER_ID, tasks } from "../fixtures";
import { formatMd, isNotUpdated, krGap, krIdsOfTask, latestCheckinDate } from "../logic";
import { useMock } from "../state";
import { KrDots, krName, signed, StatusChip, valueText } from "../ui";

/** 本体のダッシュボードとタスク一覧に載せる部品の、静的な見本。本体のコードには触れない */
export function DailyScreen() {
  const { records, checkins, linkCtx } = useMock();
  const latest = latestCheckinDate(checkins);
  const myKrs = [...new Set(tasks.filter((t) => t.assigneeId === OWNER_ID).flatMap((t) => krIdsOfTask(t, linkCtx)))].sort();
  const sample = tasks.filter((t) => t.assigneeId === OWNER_ID && t.status !== "完了").slice(0, 6);

  return (
    <div>
      <h1 className="mk-h1">日々の画面での見え方（見本）</h1>
      <p className="mk-lead">本体のダッシュボードとタスク一覧に載る部品の見本です。静的な絵で、本体のコードは変えていません。</p>
      <div className="mk-grid mk-grid-2">
        <section className="mk-card" aria-label="ダッシュボードの見本">
          <h2 className="mk-h2" style={{ marginTop: 0 }}>
            ダッシュボード：自分のKRの現状（見本）
          </h2>
          <ul className="mk-list">
            {myKrs.map((k) => {
              const r = records[k];
              return (
                <li key={k}>
                  <KrDots krIds={[k]} /> {krName(k)} 現状 {valueText(r, r.value)}／目標 {valueText(r, r.target)}（差 {signed(krGap(r), r.kind === "number" ? r.unit : "段")}）
                  <span className="mk-muted"> {formatMd(r.updatedAt)}更新</span>
                  {isNotUpdated(r, latest) && <span className="mk-chip mk-chip-yellow">未更新</span>}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="mk-card" aria-label="タスク一覧の見本">
          <h2 className="mk-h2" style={{ marginTop: 0 }}>
            タスク一覧：色の点（見本）
          </h2>
          <ul className="mk-tasklist">
            {sample.map((t) => (
              <li key={t.id}>
                <div className="mk-taskrow" style={{ cursor: "default" }}>
                  <span className="mk-ttitle">{t.title}</span>
                  <StatusChip status={t.status} />
                  <span className="mk-muted">{formatMd(t.due)}</span>
                  <KrDots krIds={krIdsOfTask(t, linkCtx)} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mk-muted">●＝KRにつながる（色でKRを区別）／○＝つながりなし。文字の札は出さず、点にカーソルを置くとKR名が出ます。</p>
        </section>
      </div>
    </div>
  );
}
