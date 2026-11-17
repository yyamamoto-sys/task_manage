import { useState } from "react";
import { CURRENT_QUARTER, DEMO, PERIOD_NAME, PREV_QUARTER } from "../dataset";
import { diffCount, formatFull, type RowStatus } from "../logic";
import { useCompareRows, useMock } from "../state";
import type { Quarter } from "../types";
import { DiffText } from "../ui";

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  same: { label: "一致", cls: "mk-chip-green" },
  changed: { label: "文言が違う", cls: "mk-chip-yellow" },
  kintoneOnly: { label: "Kintoneにだけある", cls: "mk-chip-blue" },
  appOnly: { label: "アプリにだけある", cls: "mk-chip-red" },
};

/** Kintone の内容を正式なものとして取り込む画面。アプリ側に合わせる操作は無く、違いを見せて取り込むだけ */
export function GoalsScreen() {
  const { locked, lockedAt, imported, setImported, importFromKintone, unlockDemo, showToast, items, data } = useMock();
  const cur = CURRENT_QUARTER;
  const prev = PREV_QUARTER;
  const [q, setQ] = useState<Quarter>(cur.quarter);
  const rows = useCompareRows();
  const diffs = diffCount(rows);
  const half = items.filter((i) => i.kind !== "tf");
  const tabs = [...(prev ? [prev.info] : []), cur];
  // Kintone の PDF を読む仕組み（段階3）が無いあいだは、読み込みの操作を出さない
  const canRead = data.kintoneRows !== null;

  return (
    <div>
      <h1 className="mk-h1">O・KRの取り込み</h1>
      <p className="mk-lead">
        O（めざす姿）とKRは半期の間ずっと固定です。TFは四半期ごとに、Kintoneで確定した内容を正式なものとして取り込み、ロックします。
      </p>

      <div className="mk-card">
        <div className="mk-row">
          <span aria-hidden="true">🔒</span>
          <strong>{PERIOD_NAME}のO・KR：半期の間は変更しません</strong>
        </div>
        <table className="mk-diff-table" style={{ marginTop: 8 }}>
          <tbody>
            {half.map((i) => (
              <tr key={i.id}>
                <th style={{ width: 90 }}>{i.label}</th>
                <td>{i.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mk-tabs" role="tablist" aria-label="四半期の選択">
        {tabs.map((x) => (
          <button key={x.quarter} type="button" role="tab" aria-selected={q === x.quarter} className={`mk-tab${q === x.quarter ? " is-active" : ""}`} onClick={() => setQ(x.quarter)}>
            {x.quarter}（{x.range}）{x.ended ? "・終了" : "・今期"}
          </button>
        ))}
      </div>

      {prev && q === prev.info.quarter ? (
        <div className="mk-card">
          <div className="mk-row">
            <span aria-hidden="true" style={{ fontSize: 22 }}>
              🔒
            </span>
            <strong>{prev.info.quarter}：終了・読み取り専用</strong>
          </div>
          <p className="mk-muted">
            終了した四半期は見るだけです。このときのTF構成は、今期（{cur.quarter}）と違うことがあります。{prev.info.quarter}だけにあった取り組みの仕事は、完了した時点のつながりで今期の地図にも残ります。
          </p>
          <table className="mk-diff-table">
            <tbody>
              {prev.items
                .filter((i) => i.kind === "tf")
                .map((i) => (
                  <tr key={i.id}>
                    <th style={{ width: 90 }}>{i.label}</th>
                    <td>{i.text}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : locked ? (
        <div className="mk-card">
          <div className="mk-row">
            <span aria-hidden="true" style={{ fontSize: 22 }}>
              🔒
            </span>
            <strong>
              {cur.quarter}：確定済み{lockedAt ? `（${formatFull(lockedAt)}）` : ""}・変更不可
            </strong>
            <span className="mk-spacer" />
            {DEMO && (
              <button type="button" className="mk-btn mk-btn-sm" onClick={unlockDemo}>
                デモ用：確定待ち状態に戻す
              </button>
            )}
          </div>
          <p className="mk-muted">TFの文言は編集できません。期中は「PJと仕事の紐づけ」と「状況」だけを動かします。</p>
          <TfTable />
        </div>
      ) : !canRead ? (
        <div className="mk-card">
          <div className="mk-row">
            <strong>{cur.quarter}のTF（いまアプリにある内容）</strong>
          </div>
          <p className="mk-muted">Kintone の内容を読み込んで確定する機能は、準備ができしだい使えるようになります。いまはアプリにあるTFをそのまま地図に使っています。</p>
          <TfTable />
        </div>
      ) : (
        <>
          <div className="mk-card mk-row">
            <button
              type="button"
              className="mk-btn mk-btn-primary"
              onClick={() => {
                setImported(true);
                showToast("Kintoneのページを読み込みました");
              }}
            >
              PDFを選ぶ
            </button>
            <span className="mk-muted">{imported ? "Kintone の PDF を読み込みました" : "まだ読み込んでいません"}</span>
          </div>

          {imported && (
            <>
              <h2 className="mk-h2">
                Kintone（正式な内容）とアプリの違い（{cur.quarter}のTF）
              </h2>
              {diffs === 0 ? (
                <p className="mk-chip mk-chip-green">違いはありません。取り込んでロックできます。</p>
              ) : (
                <p className="mk-chip mk-chip-yellow">違いが{diffs}か所あります。取り込むと、アプリの内容がKintoneと同じになります。</p>
              )}
              <div className="mk-table-wrap" style={{ marginTop: 10 }}>
                <table className="mk-diff-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}></th>
                      <th>アプリにある内容（いま）</th>
                      <th>Kintone（正式な内容）</th>
                      <th style={{ width: 150 }}>違い</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <th>{r.label}</th>
                        <td>{r.status === "kintoneOnly" ? <span className="mk-muted">（アプリにはありません）</span> : <DiffText segs={r.left} kind="del" />}</td>
                        <td>{r.status === "appOnly" ? <span className="mk-muted">（Kintoneにはありません）</span> : <DiffText segs={r.right} kind="ins" />}</td>
                        <td>
                          <span className={`mk-chip ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                          {r.status === "appOnly" && <div className="mk-small mk-muted">取り込むと、アプリから外れます</div>}
                          {r.status === "kintoneOnly" && <div className="mk-small mk-muted">取り込むと、アプリに加わります</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mk-row" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="mk-btn mk-btn-primary"
                  onClick={() => {
                    importFromKintone();
                    showToast(`Kintoneの内容を取り込み、${cur.quarter}のTFをロックしました`);
                  }}
                >
                  Kintoneの内容を取り込んでロック
                </button>
                <span className="mk-muted">Kintoneの内容が正式です。アプリ側に合わせる操作はありません。</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TfTable() {
  const { items } = useMock();
  // 本番のTFは四半期ごとに別の行なので、IDではなく番号（TF1-2 など）で比べる
  const prevLabels = new Set((PREV_QUARTER?.items ?? []).filter((i) => i.kind === "tf").map((i) => i.label));
  const tfs = items.filter((i) => i.kind === "tf");
  if (tfs.length === 0) return <p className="mk-muted">今期のTFは、まだ登録されていません。</p>;
  return (
    <table className="mk-diff-table">
      <tbody>
        {tfs.map((i) => (
          <tr key={i.id}>
            <th style={{ width: 90 }}>{i.label}</th>
            <td>
              {i.text}
              {PREV_QUARTER && !prevLabels.has(i.label) && (
                <span className="mk-chip mk-chip-blue" style={{ marginLeft: 6 }}>
                  {CURRENT_QUARTER.quarter}で追加
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
