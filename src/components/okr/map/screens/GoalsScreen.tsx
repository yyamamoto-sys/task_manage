import { useEffect, useMemo, useRef, useState } from "react";
import { formatErrorForUser } from "../../../../lib/errorMessage";
import { CURRENT_QUARTER, DEMO, PERIOD_NAME, PREV_QUARTER } from "../dataset";
import { headDiffs, krChanges, krCountMismatch } from "../kintone";
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
  const { locked, lockedAt, imported, setImported, importFromKintone, unlockDemo, showToast, items, data, aiReady, readKintone, kintoneReading } = useMock();
  const cur = CURRENT_QUARTER;
  const prev = PREV_QUARTER;
  const [q, setQ] = useState<Quarter>(cur.quarter);
  const rows = useCompareRows();
  const heads = kintoneReading ? headDiffs(kintoneReading, items) : [];
  const diffs = diffCount(rows) + heads.length;
  const mismatch = kintoneReading ? krCountMismatch(kintoneReading, items) : null;
  const objectiveDiff = heads.find((h) => h.label === "O") ?? null;
  // KR ごとの題名・段の基準文の旧／新。最初は違うものをすべて選んだ状態にし、利用者が外したものは書かない
  const krRows = useMemo(() => (kintoneReading ? krChanges(kintoneReading, items, data.krDefs) : []), [kintoneReading, items, data.krDefs]);
  const [pickTitles, setPickTitles] = useState<string[]>([]);
  const [pickBands, setPickBands] = useState<string[]>([]);
  useEffect(() => {
    setPickTitles(krRows.filter((k) => k.titleChanged).map((k) => k.krId));
    setPickBands(krRows.filter((k) => k.bandsChanged).map((k) => k.krId));
  }, [kintoneReading]); // eslint-disable-line react-hooks/exhaustive-deps
  const half = items.filter((i) => i.kind !== "tf");
  const tabs = [...(prev ? [prev.info] : []), cur];
  // 読み込みの操作は、AI を使えるとき（本番）か、テストの架空データがあるときだけ出す（ゲストは出さない）
  const canRead = aiReady || data.kintoneRows !== null;
  const [busy, setBusy] = useState<"read" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("read");
    setError(null);
    try {
      await readKintone(file);
      showToast("Kintoneの内容を読み込みました");
    } catch (e) {
      setError(formatErrorForUser("Kintoneの内容を読み込めませんでした", e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
          <div className="mk-card mk-row" style={{ flexWrap: "wrap" }}>
            {aiReady ? (
              <>
                <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.docx,.html,.htm" className="mk-sr" aria-label="Kintone の OKR のファイル" onChange={(e) => void onFile(e.target.files?.[0])} />
                <button type="button" className="mk-btn mk-btn-primary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                  {busy === "read" ? "読み込み中…" : "PDFを選ぶ"}
                </button>
                <span className="mk-muted">{kintoneReading ? `${kintoneReading.fileName} を読み込みました` : "Kintone の OKR の画面を PDF（またはテキスト）にして選びます。AI が O・KR・TF と段の基準文を読み取ります"}</span>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          {error && (
            <div className="mk-card mk-note" role="alert" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </div>
          )}

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
                          {r.status === "appOnly" && <div className="mk-small mk-muted">{kintoneReading ? "合わせても、アプリからは消しません" : "取り込むと、アプリから外れます"}</div>}
                          {r.status === "kintoneOnly" && <div className="mk-small mk-muted">取り込むと、アプリに加わります</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mismatch && (
                <div className="mk-card mk-note" role="alert">
                  KRの数が違います（Kintone {mismatch.kintone}件・アプリ {mismatch.app}件）。KR は並び順で対応づけるので、このままでは合わせられません。アプリの KR をそろえてから、もう一度読み込んでください。
                </div>
              )}
              {objectiveDiff && (
                <>
                  <h3 className="mk-h3">Oの文言の違い</h3>
                  <table className="mk-diff-table">
                    <tbody>
                      <tr>
                        <th style={{ width: 70 }}>O</th>
                        <td>{objectiveDiff.app}</td>
                        <td>{objectiveDiff.kintone}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {!mismatch && krRows.length > 0 && (
                <>
                  <h3 className="mk-h3">KRの題名と段の基準文の違い（合わせるものを選んでください）</h3>
                  {krRows.map((k) => (
                    <fieldset key={k.krId} className="mk-fieldset mk-card" style={{ marginBottom: 8 }}>
                      <legend className="mk-small">
                        <strong>{k.label}</strong>
                      </legend>
                      {k.titleChanged && (
                        <label className={`mk-opt${pickTitles.includes(k.krId) ? " is-on" : ""}`}>
                          <input type="checkbox" checked={pickTitles.includes(k.krId)} onChange={() => setPickTitles((p) => toggleId(p, k.krId))} /> 題名を合わせる
                          <div className="mk-small">いま：{k.oldTitle}</div>
                          <div className="mk-small">Kintone：{k.newTitle}</div>
                        </label>
                      )}
                      {k.bandsChanged && k.newBands && (
                        <label className={`mk-opt${pickBands.includes(k.krId) ? " is-on" : ""}`}>
                          <input type="checkbox" checked={pickBands.includes(k.krId)} onChange={() => setPickBands((p) => toggleId(p, k.krId))} /> 段の基準文を合わせる
                          {BAND_STEPS.filter((s) => (k.newBands?.[s] ?? "") !== "" || (k.oldBands?.[s] ?? "") !== "").map((s) => (
                            <div key={s} className="mk-small">
                              {s}：いま「{k.oldBands?.[s] || "（なし）"}」→ Kintone「{k.newBands?.[s] || "（なし）"}」
                            </div>
                          ))}
                        </label>
                      )}
                    </fieldset>
                  ))}
                </>
              )}
              {kintoneReading && !kintoneReading.krs.some((k) => k.bands) && <p className="mk-muted">段の基準文は読み取れませんでした（KRの詳細から手で入れられます）。</p>}
              {kintoneReading && kintoneReading.skipped.length > 0 && (
                <p className="mk-muted">アプリに対応するKRが無いため取り込めないTF：{kintoneReading.skipped.join("、")}</p>
              )}
              <div className="mk-row" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="mk-btn mk-btn-primary"
                  disabled={busy !== null || mismatch !== null}
                  onClick={async () => {
                    setBusy("apply");
                    const ok = await importFromKintone(kintoneReading ? { titles: pickTitles, bands: pickBands } : undefined);
                    setBusy(null);
                    if (ok) showToast(`Kintoneの内容に合わせ、${cur.quarter}のTFをロックしました`);
                  }}
                >
                  {busy === "apply" ? "合わせています…" : kintoneReading ? "Kintone に合わせる" : "Kintoneの内容を取り込んでロック"}
                </button>
                <span className="mk-muted">
                  {kintoneReading
                    ? "Kintoneの内容が正式です。押すと、TF と O の文言、選んだ KR の題名・段の基準文を Kintone に合わせ、TF をロックします。アプリにだけある TF は消さず、アプリに無い KR は作りません。"
                    : "Kintoneの内容が正式です。アプリ側に合わせる操作はありません。"}
                </span>
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

const BAND_STEPS = [60, 70, 80, 90, 100] as const;
const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
