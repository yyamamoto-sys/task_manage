import { useState } from "react";
import { CURRENT_QUARTER, LOCKED_AT, okrItems3Q, PERIOD_NAME, QUARTER_INFO } from "../fixtures";
import { canLock, formatFull, resolvedTexts } from "../logic";
import { useCompareRows, useMock } from "../state";
import type { Quarter } from "../types";
import { DiffText } from "../ui";

const QUARTERS: Quarter[] = ["3Q", "4Q"];

export function ImportScreen() {
  const { locked, lockedAt, imported, setImported, resolutions, setResolution, lock, unlockDemo, showToast, items, checkpoints, decImported, importCheckpoints } = useMock();
  const [q, setQ] = useState<Quarter>(CURRENT_QUARTER);
  const rows = useCompareRows();
  const diffRows = rows.filter((r) => !r.same);
  const ready = canLock(rows, resolutions);
  const half = items.filter((i) => i.kind !== "tf");
  const months = [...new Set(checkpoints.map((c) => c.month))].sort();

  return (
    <div>
      <h1 className="mk-h1">② 取り込み・突き合わせ</h1>
      <p className="mk-lead">
        目標とKRは半期の間ずっと固定です。TFは四半期ごとに、Kintoneで確定した内容と見比べて確定し、ロックします。
      </p>

      <div className="mk-card">
        <div className="mk-row">
          <span aria-hidden="true">🔒</span>
          <strong>{PERIOD_NAME}の目標・KR：{formatFull(LOCKED_AT)}に確定・半期の間は変更不可</strong>
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
          <p className="mk-muted">終了した四半期は見るだけです。このときのTF構成は、今期（4Q）とは違います。</p>
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
          <p className="mk-muted">TFの文言は編集できません。期中は「PJ・タスクの紐づけ」と「状況」だけを動かします。3Qから増えたTFもあります。</p>
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
              <h2 className="mk-h2">アプリの案と、Kintoneの内容を比べる（4QのTF）</h2>
              {diffRows.length === 0 ? (
                <p className="mk-chip mk-chip-green">差分はありません。確定してロックできます。</p>
              ) : (
                <p className="mk-chip mk-chip-yellow">違いが{diffRows.length}か所あります。どちらに合わせるか選んでください。</p>
              )}
              <div className="mk-table-wrap" style={{ marginTop: 10 }}>
                <table className="mk-diff-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}></th>
                      <th>アプリ側の案</th>
                      <th>Kintone側（PDFから読んだ結果）</th>
                      <th style={{ width: 190 }}>どちらに合わせる？</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <th>{r.label}</th>
                        <td>
                          <DiffText segs={r.left} kind="del" />
                        </td>
                        <td>
                          <DiffText segs={r.right} kind="ins" />
                        </td>
                        <td>
                          {r.same ? (
                            <span className="mk-chip mk-chip-green">一致</span>
                          ) : (
                            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                              <legend className="mk-small" style={{ position: "absolute", left: -9999 }}>
                                {r.label}の合わせ先
                              </legend>
                              <label className="mk-small" style={{ display: "block" }}>
                                <input type="radio" name={`r-${r.id}`} checked={resolutions[r.id] === "app"} onChange={() => setResolution(r.id, "app")} /> アプリ側に合わせる
                              </label>
                              <label className="mk-small" style={{ display: "block" }}>
                                <input type="radio" name={`r-${r.id}`} checked={resolutions[r.id] === "kintone"} onChange={() => setResolution(r.id, "kintone")} /> Kintone側に合わせる
                              </label>
                            </fieldset>
                          )}
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
                  disabled={!ready}
                  onClick={() => {
                    lock(resolvedTexts(rows, resolutions));
                    showToast("4QのTFを確定してロックしました（モック）");
                  }}
                >
                  4Qを確定してロック
                </button>
                {!ready && <span className="mk-muted">違いのある行すべてで、合わせ先を選ぶと押せます。</span>}
              </div>
            </>
          )}
        </>
      )}

      <h2 className="mk-h2">月初のチェックポイント</h2>
      <div className="mk-card">
        <p className="mk-muted" style={{ marginTop: 0 }}>
          Kintoneの「月次の計画（プロセス評価基準）」に当たるものです。TFごと・月ごとに1〜2行。KR詳細とチェックインに、タスクの動きと並べて出します。
        </p>
        <div className="mk-row">
          <span>取込済み：{months.map((m) => `${Number(m.slice(5))}月`).join("・")}</span>
          <span className="mk-spacer" />
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            disabled={decImported}
            onClick={() => {
              importCheckpoints();
              showToast("今月のチェックポイントを取り込みました（モックでは12月分が入ります）");
            }}
          >
            今月のチェックポイントを取り込む
          </button>
        </div>
        <p className="mk-muted">{decImported ? "12月分を取り込みました。" : "12月分は未取込です。モックなので、押すと12月分が入ります。"}</p>
      </div>
    </div>
  );
}
