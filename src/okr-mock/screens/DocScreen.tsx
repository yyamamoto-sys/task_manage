import { useState } from "react";
import { resources } from "../fixtures";
import { BANDS } from "../logic";
import { useMock } from "../state";
import type { Band } from "../types";
import { krName, nameOf, valueText } from "../ui";

export function DocScreen() {
  const { records, items, confirmImport, setScreen, showToast } = useMock();
  const [resId, setResId] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, number | Band>>({});
  const [done, setDone] = useState(false);
  const res = resources.find((r) => r.id === resId);
  const krs = items.filter((i) => i.kind === "kr");

  const pick = (id: string) => {
    setResId(id);
    setRead(false);
    setValues({});
    setDone(false);
  };

  return (
    <div>
      <h1 className="mk-h1">資料を読ませる</h1>
      <p className="mk-lead">チェックインの資料からKRの現状・決定事項・宿題の下書きを取り出し、直したい行だけ直して、まとめて確定します。誰でも操作できます。</p>
      <div className="mk-card mk-note" role="note">
        これはモックです。実際のファイルは読み込まず、AIも呼び出しません。下の結果は固定のデータです。
      </div>

      <h2 className="mk-h2">1. 資料を選ぶ</h2>
      <div className="mk-card">
        <fieldset className="mk-fieldset">
          <legend className="mk-small">読ませる資料（架空の2件）</legend>
          {resources.map((r) => (
            <label key={r.id} style={{ display: "block", padding: "4px 0" }}>
              <input type="radio" name="res" checked={resId === r.id} onChange={() => pick(r.id)} /> {r.name} <span className="mk-muted">{r.kind}</span>
            </label>
          ))}
        </fieldset>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="mk-btn mk-btn-primary" disabled={!res} onClick={() => setRead(true)}>
            読み取る（模擬）
          </button>
        </div>
      </div>

      {res && read && (
        <>
          <h2 className="mk-h2">2. AIが読み取った下書き</h2>
          <p className="mk-muted">直したい行だけ、数値やバンドを直してください。直さなければ下書きのまま確定します。</p>
          <div className="mk-table-wrap mk-card">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>KR</th>
                  <th>前回の値</th>
                  <th>現状の案</th>
                  <th>出典の箇所</th>
                </tr>
              </thead>
              <tbody>
                {res.drafts.map((d) => {
                  const r = records[d.krId];
                  const cur = values[d.krId] ?? d.value;
                  return (
                    <tr key={d.krId}>
                      <td>{krName(d.krId)}</td>
                      <td>{valueText(r, r.value)}</td>
                      <td>
                        {r.kind === "number" ? (
                          <label>
                            <span className="mk-sr">{krName(d.krId)}の現状</span>
                            <input
                              type="number"
                              className="mk-input"
                              style={{ width: 90 }}
                              value={typeof cur === "number" ? cur : ""}
                              onChange={(e) => {
                                const n = e.target.valueAsNumber;
                                if (!Number.isNaN(n)) setValues((p) => ({ ...p, [d.krId]: n }));
                              }}
                            />{" "}
                            {r.unit}
                          </label>
                        ) : (
                          <label>
                            <span className="mk-sr">{krName(d.krId)}の達成度</span>
                            <select className="mk-select" style={{ width: 90 }} value={String(cur)} onChange={(e) => setValues((p) => ({ ...p, [d.krId]: e.target.value as Band }))}>
                              {BANDS.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>{" "}
                            <span className="mk-chip mk-chip-yellow">仮の区分</span>
                          </label>
                        )}
                      </td>
                      <td>
                        {d.source.doc} {d.source.page}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {krs.some((k) => !res.drafts.some((d) => d.krId === k.id)) && (
              <p className="mk-muted">
                資料に出てこなかったKR：{krs.filter((k) => !res.drafts.some((d) => d.krId === k.id)).map((k) => k.label).join("、")}（前回の値のまま、対照表で「未更新」と表示します）
              </p>
            )}
          </div>

          <h2 className="mk-h2">3. 決定事項と宿題の取り出し結果</h2>
          <div className="mk-card">
            <ul className="mk-list">
              {res.decisions.map((d, i) => (
                <li key={i}>
                  <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span> {d.text}
                  {d.ownerId ? ` 担当：${nameOf(d.ownerId)}` : ""} <span className="mk-muted">{d.source.doc} {d.source.page}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mk-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="mk-btn mk-btn-primary"
              onClick={() => {
                confirmImport(res.id, values);
                setDone(true);
                showToast("対照表に反映し、決定事項と宿題に追加しました（モック）");
              }}
            >
              まとめて確定
            </button>
            {done && (
              <>
                <span className="mk-chip mk-chip-green">確定しました</span>
                <button type="button" className="mk-btn mk-btn-sm" onClick={() => setScreen("table")}>
                  対照表を見る
                </button>
                <button type="button" className="mk-btn mk-btn-sm" onClick={() => setScreen("decisions")}>
                  決定事項と宿題を見る
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
