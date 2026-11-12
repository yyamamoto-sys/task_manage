import { useEffect, useRef, useState } from "react";
import { resources } from "../fixtures";
import { BANDS } from "../logic";
import { useMock } from "../state";
import type { Band } from "../types";
import { krLabel, krName, nameOf, valueText } from "../ui";

/** 「資料を読ませる」の引き出し。資料を選ぶ → AIの下書き → まとめて確定。確定すると閉じる */
export function DocDrawer() {
  const { records, items, confirmImport, setDrawerOpen, showToast } = useMock();
  const [resId, setResId] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, number | Band>>({});
  const ref = useRef<HTMLDivElement>(null);
  const res = resources.find((r) => r.id === resId);
  const krs = items.filter((i) => i.kind === "kr");
  const close = () => setDrawerOpen(false);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const pick = (id: string) => {
    setResId(id);
    setRead(false);
    setValues({});
  };

  return (
    <div
      className="mk-drawer-wrap print-hide"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <button type="button" className="mk-drawer-scrim" aria-label="引き出しを閉じる" tabIndex={-1} onClick={close} />
      <div ref={ref} tabIndex={-1} className="mk-drawer" role="dialog" aria-modal="true" aria-labelledby="mk-drawer-h">
        <div className="mk-row">
          <h2 id="mk-drawer-h" className="mk-h2" style={{ margin: 0 }}>
            資料を読ませる
          </h2>
          <span className="mk-spacer" />
          <button type="button" className="mk-btn mk-btn-sm" onClick={close}>
            閉じる
          </button>
        </div>
        <p className="mk-muted">チェックインの資料からKRの現状・決定事項・宿題の下書きを取り出し、直したい行だけ直して、まとめて確定します。誰でも操作できます。</p>
        <div className="mk-card mk-note" role="note">
          モックです。実際のファイルは読み込まず、AIも呼び出しません。下の結果は固定のデータです。
        </div>

        <h3 className="mk-h3">1. 資料を選ぶ</h3>
        <fieldset className="mk-fieldset">
          <legend className="mk-small">読ませる資料（架空の2件）</legend>
          {resources.map((r) => (
            <label key={r.id} className={`mk-opt${resId === r.id ? " is-on" : ""}`}>
              <input type="radio" name="res" checked={resId === r.id} onChange={() => pick(r.id)} /> {r.name} <span className="mk-muted">{r.kind}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="mk-btn mk-btn-primary" style={{ marginTop: 8 }} disabled={!res} onClick={() => setRead(true)}>
          読み取る（模擬）
        </button>

        {res && read && (
          <>
            <h3 className="mk-h3">2. AIが読み取った下書き</h3>
            <p className="mk-muted">直したい行だけ、数値やバンドを直してください。直さなければ下書きのまま確定します。</p>
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>KR</th>
                    <th>前回</th>
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
                                style={{ width: 80 }}
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
                              <select className="mk-select" style={{ width: 80 }} value={String(cur)} onChange={(e) => setValues((p) => ({ ...p, [d.krId]: e.target.value as Band }))}>
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
            </div>
            {krs.some((k) => !res.drafts.some((d) => d.krId === k.id)) && (
              <p className="mk-muted">
                資料に出てこなかったKR：{krs.filter((k) => !res.drafts.some((d) => d.krId === k.id)).map((k) => krLabel(k.id)).join("、")}（前回の値のまま、表で「未更新」と表示します）
              </p>
            )}

            <h3 className="mk-h3">3. 決定事項と宿題の取り出し結果</h3>
            <ul className="mk-list">
              {res.decisions.map((d, i) => (
                <li key={i}>
                  <span className={`mk-chip ${d.kind === "決定" ? "mk-chip-blue" : "mk-chip-yellow"}`}>{d.kind}</span> {d.text}
                  {d.ownerId ? ` 担当：${nameOf(d.ownerId)}` : ""}{" "}
                  <span className="mk-muted">
                    {d.source.doc} {d.source.page}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mk-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="mk-btn mk-btn-primary"
                onClick={() => {
                  const found = confirmImport(res.id, values);
                  setDrawerOpen(false);
                  showToast(found.length > 0 ? `図に反映しました。${found.map((c) => `${krLabel(c.krId)}が${c.kind === "half" ? "半分を越えました" : "目標に届きました"}`).join("、")}` : "図に反映し、決定事項と宿題の欄に加えました");
                }}
              >
                まとめて確定
              </button>
              <span className="mk-muted">確定すると、図と帯が新しい値になります。</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
