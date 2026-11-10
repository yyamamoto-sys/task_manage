import { canLock, resolvedTexts } from "../logic";
import { useCompareRows, useMock } from "../state";
import { DiffText } from "../ui";

export function ImportScreen() {
  const { locked, lockedAt, imported, setImported, resolutions, setResolution, lock, unlockDemo, showToast, items } = useMock();
  const rows = useCompareRows();
  const diffRows = rows.filter((r) => !r.same);
  const ready = canLock(rows, resolutions);

  return (
    <div>
      <h1 className="mk-h1">② 取り込み・突き合わせ</h1>
      <p className="mk-lead">Kintoneで確定したOKRのページをPDFにして読み込み、アプリ側の案と見比べます。</p>

      {locked ? (
        <div className="mk-card">
          <div className="mk-row">
            <span aria-hidden="true" style={{ fontSize: 22 }}>
              🔒
            </span>
            <strong>確定済み（{lockedAt}）・変更不可</strong>
            <span className="mk-spacer" />
            <button type="button" className="mk-btn mk-btn-sm" onClick={unlockDemo}>
              デモ用：確定待ち状態に戻す
            </button>
          </div>
          <p className="mk-muted">OKR本体の文言は編集できません。期中は「PJ・タスクの紐づけ」と「状況」だけを動かします。</p>
          <table className="mk-diff-table">
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <th style={{ width: 90 }}>{i.label}</th>
                  <td>{i.text}</td>
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
              {imported ? "Kintone_OKR_2026下期.pdf を読み込みました（模擬データ・実際には読みません）" : "まだ読み込んでいません"}
            </span>
          </div>

          {imported && (
            <>
              <h2 className="mk-h2">アプリの案と、Kintoneの内容を比べる</h2>
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
                    showToast("OKRを確定してロックしました（モック）");
                  }}
                >
                  確定してロック
                </button>
                {!ready && <span className="mk-muted">違いのある行すべてで、合わせ先を選ぶと押せます。</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
