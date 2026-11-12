import { useState } from "react";
import { CURRENT_QUARTER, LOCKED_AT, okrItems3Q, PERIOD_NAME, QUARTER_INFO } from "../fixtures";
import { diffCount, formatFull, type RowStatus } from "../logic";
import { useCompareRows, useMock } from "../state";
import type { Quarter } from "../types";
import { DiffText } from "../ui";

const QUARTERS: Quarter[] = ["3Q", "4Q"];

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  same: { label: "一致", cls: "mk-chip-green" },
  changed: { label: "文言が違う", cls: "mk-chip-yellow" },
  kintoneOnly: { label: "Kintoneにだけある", cls: "mk-chip-blue" },
  appOnly: { label: "アプリにだけある", cls: "mk-chip-red" },
};

/** Kintone を正として取り込む画面。アプリ側に合わせる操作は無く、違いを見せて取り込むだけ */
export function GoalsScreen() {
  const { locked, lockedAt, imported, setImported, importFromKintone, unlockDemo, showToast, items } = useMock();
  const [q, setQ] = useState<Quarter>(CURRENT_QUARTER);
  const rows = useCompareRows();
  const diffs = diffCount(rows);
  const half = items.filter((i) => i.kind !== "tf");

  return (
    <div>
      <h1 className="mk-h1">O・KRの取り込み</h1>
      <p className="mk-lead">
        O（めざす姿）とKRは半期の間ずっと固定です。TFは四半期ごとに、Kintoneで確定した内容を正として取り込み、ロックします。
      </p>

      <div className="mk-card">
        <div className="mk-row">
          <span aria-hidden="true">🔒</span>
          <strong>{PERIOD_NAME}のO・KR：{formatFull(LOCKED_AT)}に確定・半期の間は変更不可</strong>
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
        {QUARTERS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={q === x} className={`mk-tab${q === x ? " is-active" : ""}`} onClick={() => setQ(x)}>
            {x}（{QUARTER_INFO[x].range}）{QUARTER_INFO[x].ended ? "・終了" : "・今期"}
          </button>
        ))}
      </div>

      {q === "3Q" ? (
        <div className="mk-card">
          <div className="mk-row">
            <span aria-hidden="true" style={{ fontSize: 22 }}>
              🔒
            </span>
            <strong>3Q：確定済み（{QUARTER_INFO["3Q"].lockedAt}）・終了・読み取り専用</strong>
          </div>
          <p className="mk-muted">終了した四半期は見るだけです。このときのTF構成は、今期（4Q）とは違います。3Qだけにあった取り組みの仕事は、完了した時点のつながりで今期の地図にも残ります。</p>
          <table className="mk-diff-table">
            <tbody>
              {okrItems3Q
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
            <strong>4Q：確定済み（{lockedAt}）・変更不可</strong>
            <span className="mk-spacer" />
            <button type="button" className="mk-btn mk-btn-sm" onClick={unlockDemo}>
              デモ用：確定待ち状態に戻す
            </button>
          </div>
          <p className="mk-muted">TFの文言は編集できません。期中は「PJと仕事の紐づけ」と「状況」だけを動かします。3Qから増えたTFもあります。</p>
          <table className="mk-diff-table">
            <tbody>
              {items
                .filter((i) => i.kind === "tf")
                .map((i) => (
                  <tr key={i.id}>
                    <th style={{ width: 90 }}>{i.label}</th>
                    <td>
                      {i.text}
                      {!okrItems3Q.some((x) => x.id === i.id) && <span className="mk-chip mk-chip-blue" style={{ marginLeft: 6 }}>4Qで追加</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mk-card mk-row">
            <button
              type="button"
              className="mk-btn mk-btn-primary"
              onClick={() => {
                setImported(true);
                showToast("Kintoneのページを読み込みました（模擬データ）");
              }}
            >
              PDFを選ぶ
            </button>
            <span className="mk-muted">
              {imported ? "Kintone_OKR_2026下期_4Q.pdf を読み込みました（模擬データ・実際には読みません）" : "まだ読み込んでいません"}
            </span>
          </div>

          {imported && (
            <>
              <h2 className="mk-h2">Kintone（正）とアプリの違い（4QのTF）</h2>
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
                      <th>Kintone（正）</th>
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
                    showToast("Kintoneの内容を取り込み、4QのTFをロックしました（モック）");
                  }}
                >
                  Kintoneの内容を取り込んでロック
                </button>
                <span className="mk-muted">Kintoneが正です。アプリ側に合わせる操作はありません。</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
