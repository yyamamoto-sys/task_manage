import { OWNER_ID, tasks } from "../fixtures";
import { krGap, krIdsOfTask, tfIdsOfTask } from "../logic";
import { useMock } from "../state";
import { nameOf, signed, valueText } from "../ui";

export function MapScreen() {
  const { items, records, isOwner, linkCtx, openKrRow } = useMock();
  const obj = items.find((i) => i.kind === "objective")!;
  const krs = items.filter((i) => i.kind === "kr");

  const mine = tasks.filter((t) => t.assigneeId === OWNER_ID);
  const myKrs = new Set(mine.flatMap((t) => krIdsOfTask(t, linkCtx)));
  const myTfs = new Set(mine.flatMap((t) => tfIdsOfTask(t, linkCtx)));

  const tfMembers = (tfId: string, leaderId?: string) => {
    const pjIds = new Set(linkCtx.pjs.filter((p) => p.tfIds.includes(tfId)).map((p) => p.id));
    const ids = [...new Set(tasks.filter((t) => pjIds.has(t.pjId)).map((t) => t.assigneeId))];
    return ids.filter((id) => id !== leaderId);
  };

  return (
    <div>
      <h1 className="mk-h1">地図</h1>
      <p className="mk-lead">
        目標からKR、TFまでを1枚で見る画面です。KRを押すと、対照表のその行へ移ります。
        {isOwner ? `太い枠は、${nameOf(OWNER_ID)}さんの仕事がつながるKRとTFです。` : "他の人として見ているため、枠の強調は出しません。"}
      </p>

      <div className="mk-card mk-obj">
        <span className="mk-chip mk-chip-blue">目標</span> <strong style={{ fontSize: 17 }}>{obj.text}</strong>
      </div>

      {krs.map((kr) => {
        const r = records[kr.id];
        const gap = krGap(r);
        const tfs = items.filter((i) => i.kind === "tf" && i.parentId === kr.id);
        const isMine = isOwner && myKrs.has(kr.id);
        return (
          <section key={kr.id} className={`mk-card mk-kr${isMine ? " is-mine" : ""}`} aria-label={kr.label}>
            <button type="button" className="mk-krbtn" onClick={() => openKrRow(kr.id)} aria-label={`${kr.label}を対照表で開く`}>
              <span className="mk-chip mk-chip-blue">{kr.label}</span> <strong>{kr.text}</strong>
              <span className="mk-krnums">
                目標 {valueText(r, r.target)}／現状 {valueText(r, r.value)}／差 {r.kind === "number" ? signed(gap, r.unit) : `${signed(gap)}段`}
              </span>
              {isMine && <span className="mk-chip mk-chip-green">あなたの仕事がつながる</span>}
            </button>
            <div className="mk-tfs">
              {tfs.map((tf) => {
                const tfMine = isOwner && myTfs.has(tf.id);
                const ms = tfMembers(tf.id, tf.leaderId);
                return (
                  <div key={tf.id} className={`mk-tf${tfMine ? " is-mine" : ""}`}>
                    <div>
                      <span className="mk-chip">{tf.label}</span> {tf.text}
                    </div>
                    <div className="mk-small" style={{ marginTop: 4 }}>
                      リーダー：{nameOf(tf.leaderId ?? null)}
                    </div>
                    <div className="mk-small">メンバー：{ms.length > 0 ? ms.map(nameOf).join("、") : "なし"}</div>
                    {tfMine && <span className="mk-chip mk-chip-green">あなたの仕事がつながる</span>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
