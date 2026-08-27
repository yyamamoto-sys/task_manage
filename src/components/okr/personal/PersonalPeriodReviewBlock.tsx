// src/components/okr/personal/PersonalPeriodReviewBlock.tsx
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// 1ブロック分のUI。period_kind違いで2回使う（月ブロック・四半期ブロック）。
// コピペしない＝この1コンポーネントを共有する（仕様書§W3）。
//
// 🔴 保存はv3.87/v3.93/v3.96の作法に合わせる：自動保存にしない・明示保存（保存ボタン）。
// 未変更時は🚫にせず「✓ 保存済み」表示（v3.93の決定。CLAUDE.md Section 48）。
// dirty判定・数値バリデーションは既存の monthReviewForm.ts をそのまま再利用する
// （personal_kr_months.review_text/self_eval_pct/gm_eval_pct/gm_commentと同じ形の入力の
// ため、判定ロジックを二重化しない）。
//
// 🔴 保存は既存レコードの他フィールド（id・created_at等）を消さないよう、レコードが
// 無ければ呼び出し側が渡すfallbackで新規行を組み立て、あれば既存レコードをspreadしてから
// 4フィールドだけ上書きする（このブロックが4フィールド全ての唯一の書き手のため、
// monthRecordMerge.tsのような複数ハンドラ間のマージは不要）。
//
// 🔴 「この値を入れる」ボタンは保存しない（参考値を入力欄へセットするだけ）。

import { useEffect, useId, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Member, PersonalPeriodReview, PersonalPeriodKind, Quarter } from "../../../lib/localData/types";
import type { KrPeriodRow, PeriodReference } from "../../../lib/personalOkr/periodReviewReference";
import { parseEvalPctInput, computeMonthReviewDirty } from "../../../lib/personalOkr/monthReviewForm";
import { isPeriodReviewUniqueViolation, PERIOD_REVIEW_DUPLICATE_MESSAGE } from "../../../lib/personalOkr/periodReviewSaveError";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../../lib/editing/unsavedEditorRegistry";
import type { ActualActivitiesAvailability } from "../../../lib/personalOkr/actualActivitiesAvailability";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { showToast } from "../../common/Toast";
import { ActualActivitiesBlock } from "./ActualActivitiesBlock";
import { PersonalOkrPeriodReviewDraftModal } from "./PersonalOkrPeriodReviewDraftModal";

const sectionHeadStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "9px", margin: "20px 0 9px",
  fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
};
const ruleStyle: React.CSSProperties = { flex: 1, height: "1px", background: "var(--color-border-primary)" };
const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", padding: "14px 16px",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", minHeight: "120px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
};
const numberInputStyle: React.CSSProperties = {
  width: "100px", fontFamily: "inherit", fontSize: "12.5px", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
};

interface Props {
  periodKind: PersonalPeriodKind;
  /** 例："8月の全体" / "2026年度 3Q 全体" */
  title: string;
  /** 画面に明記する算出式（例："Σ(KRの自己評価% × ウェイト) ÷ Σ(ウェイト)"） */
  formulaText: string;
  /** KRごとの行（内訳表示専用。🔴2026-08-26・v3.104：参考値そのものはreferenceで受け取る。
   *  四半期ブロックは「月ごとの参考値の平均」になり単一のkrRowsから再現できないため、
   *  参考値の算出をこの内部（computePeriodReference呼び出し）から呼び出し元へ移した）。 */
  krRows: KrPeriodRow[];
  /** 参考値（機械計算・呼び出し元が算出式に応じて組み立て済み）。 */
  reference: PeriodReference;
  /** 対象KRの月次データがまだ読み込み中のときtrue（参考値・内訳の代わりに読み込み中表示） */
  loadingKrData: boolean;
  currentUser: Member;
  record: PersonalPeriodReview | null;
  editable: boolean;
  fiscalYear: number;
  quarter: Quarter;
  month: string | null; // period_kind='quarter'のときnull
  onSave: (review: PersonalPeriodReview, expectedUpdatedAt?: string) => Promise<void>;
  /** AI下書き：材料要約・文脈（呼び出し時点で組み立て済み） */
  draftMaterialSummaryLines: string[];
  draftContextText: string;
  /** 実施記録（actual_activities列）の利用可否（仕様書§W2・2026-08-27・v3.105） */
  actualActivitiesAvailable: ActualActivitiesAvailability;
}

export function PersonalPeriodReviewBlock({
  periodKind, title, formulaText, krRows, reference, loadingKrData, currentUser, record, editable,
  fiscalYear, quarter, month, onSave, draftMaterialSummaryLines, draftContextText, actualActivitiesAvailable,
}: Props) {
  const [reviewText, setReviewText] = useState("");
  const [selfEvalRaw, setSelfEvalRaw] = useState("");
  const [gmEvalRaw, setGmEvalRaw] = useState("");
  const [gmComment, setGmComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);

  useEffect(() => {
    setReviewText(record?.review_text ?? "");
    setSelfEvalRaw(record?.self_eval_pct != null ? String(record.self_eval_pct) : "");
    setGmEvalRaw(record?.gm_eval_pct != null ? String(record.gm_eval_pct) : "");
    setGmComment(record?.gm_comment ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKind, fiscalYear, quarter, month, record?.id, record?.review_text]);

  const dirty = computeMonthReviewDirty(
    { reviewText, selfEvalRaw, gmEvalRaw, gmComment },
    {
      reviewText: record?.review_text, selfEvalPct: record?.self_eval_pct,
      gmEvalPct: record?.gm_eval_pct, gmComment: record?.gm_comment,
    },
  );

  // 🔴 未保存編集レジストリへの登録（仕様書§W3・CLAUDE.md Section 46）。
  const registryId = useId();
  const isDirtyRef = useRef(dirty);
  isDirtyRef.current = dirty;
  useEffect(() => {
    registerUnsavedEditor(registryId, () => isDirtyRef.current);
    return () => unregisterUnsavedEditor(registryId);
  }, [registryId]);

  const canComputeReference = reference.selfEvalPct != null || reference.gmEvalPct != null;

  const handleUseReference = () => {
    if (reference.selfEvalPct != null) setSelfEvalRaw(String(Math.round(reference.selfEvalPct * 10) / 10));
    if (reference.gmEvalPct != null) setGmEvalRaw(String(Math.round(reference.gmEvalPct * 10) / 10));
  };

  const handleSave = async () => {
    if (!editable) return;
    const selfEval = parseEvalPctInput(selfEvalRaw);
    const gmEval = parseEvalPctInput(gmEvalRaw);
    if (selfEval.error) { setError(`全体の自己評価%：${selfEval.error}`); return; }
    if (gmEval.error) { setError(`GM評価%：${gmEval.error}`); return; }

    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const fallback: PersonalPeriodReview = {
      id: uuidv4(), member_id: currentUser.id, period_kind: periodKind,
      fiscal_year: fiscalYear, quarter, month, is_deleted: false, created_at: now,
    };
    const next: PersonalPeriodReview = {
      ...(record ?? fallback),
      self_eval_pct: selfEval.value,
      gm_eval_pct: gmEval.value,
      review_text: reviewText || null,
      gm_comment: gmComment || null,
      updated_by: currentUser.id,
    };
    try {
      await onSave(next, record?.updated_at);
      showToast(`${title}を保存しました`);
    } catch (e) {
      // 🔴 部分ユニークインデックス（idx_personal_period_reviews_month_unique／
      // idx_personal_period_reviews_quarter_unique）に衝突した場合（23505）は、
      // 生のPostgrestエラーではなく「画面を再読み込みしてから保存し直す」という
      // 正しい手順を案内する（AdminView.tsxのisMemberEmailUniqueViolationと同じ考え方。
      // 統括のレビュー・2026-08-26で追加）。
      setError(isPeriodReviewUniqueViolation(e) ? PERIOD_REVIEW_DUPLICATE_MESSAGE : formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  // 🔴🔴 実施記録（仕様書§W2・2026-08-27・v3.105）の保存は、自己評価%・GM評価%・
  // 全体の振り返り本文・GMコメント（handleSave）とは完全に独立した保存関数にする。
  // actual_activities列が未適用でも他の保存が壊れないことの根幹（このnextオブジェクトは
  // 既存recordを丸ごと引き継ぎ、actual_activitiesとupdated_byの2フィールドだけ上書きする）。
  const handleSaveActualActivities = async (next: string | null) => {
    if (!editable) return;
    const now = new Date().toISOString();
    const fallback: PersonalPeriodReview = {
      id: uuidv4(), member_id: currentUser.id, period_kind: periodKind,
      fiscal_year: fiscalYear, quarter, month, is_deleted: false, created_at: now,
    };
    const nextRecord: PersonalPeriodReview = { ...(record ?? fallback), actual_activities: next, updated_by: currentUser.id };
    await onSave(nextRecord, record?.updated_at);
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={sectionHeadStyle}>
        <span>{title}</span><span style={ruleStyle} />
      </div>
      <div style={cardStyle}>
        {/* 参考値（機械計算・即時描画） */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
            参考値（機械計算）
          </div>
          <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
            算出式：{formulaText}
          </div>
          {loadingKrData ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>
          ) : canComputeReference ? (
            <div style={{
              display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", fontSize: "12.5px",
              background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)", padding: "10px 13px",
            }}>
              <span>自己評価：{reference.selfEvalPct != null ? `${Math.round(reference.selfEvalPct * 10) / 10}%` : "算出不可"}</span>
              <span>GM評価：{reference.gmEvalPct != null ? `${Math.round(reference.gmEvalPct * 10) / 10}%` : "算出不可"}</span>
              {editable && (
                <button
                  onClick={handleUseReference}
                  style={{ fontFamily: "inherit", fontSize: "11px", fontWeight: 700, padding: "4px 11px", background: "var(--color-brand-light)", color: "var(--color-brand)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                >この値を入れる</button>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
              参考値を出せません（KRのウェイトまたは自己評価が未記入です）
            </div>
          )}
          {krRows.length > 0 && (
            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer", fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>
                KRごとの内訳
              </summary>
              <table style={{ width: "100%", marginTop: "6px", fontSize: "11.5px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--color-text-tertiary)", textAlign: "left" }}>
                    <th style={{ padding: "3px 6px 3px 0", fontWeight: 600 }}>KR</th>
                    <th style={{ padding: "3px 6px", fontWeight: 600 }}>ウェイト</th>
                    <th style={{ padding: "3px 6px", fontWeight: 600 }}>自己評価%</th>
                    <th style={{ padding: "3px 6px", fontWeight: 600 }}>GM評価%</th>
                  </tr>
                </thead>
                <tbody>
                  {krRows.map(row => (
                    <tr key={row.krId} style={{ borderTop: "1px solid var(--color-border-primary)" }}>
                      <td style={{ padding: "4px 6px 4px 0" }}>{row.label}</td>
                      <td style={{ padding: "4px 6px" }}>{row.weightPct}%</td>
                      <td style={{ padding: "4px 6px" }}>{row.selfEvalPct != null ? `${row.selfEvalPct}%` : "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{row.gmEvalPct != null ? `${row.gmEvalPct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>

        {/* 入力欄：自己評価% / GM評価% */}
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "14px" }}>
          <div>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>全体の自己評価%</div>
            {editable ? (
              <input type="number" min={0} max={100} step="any" value={selfEvalRaw} onChange={e => setSelfEvalRaw(e.target.value)} style={numberInputStyle} />
            ) : (
              <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>{selfEvalRaw ? `${selfEvalRaw}%` : "（未記入）"}</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>GM評価%</div>
            {editable ? (
              <input type="number" min={0} max={100} step="any" value={gmEvalRaw} onChange={e => setGmEvalRaw(e.target.value)} style={numberInputStyle} />
            ) : (
              <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>{gmEvalRaw ? `${gmEvalRaw}%` : "（未記入）"}</div>
            )}
          </div>
        </div>

        {/* 実施記録（仕様書§W3・2026-08-27・v3.105）。参考値・自己評価%/GM評価%の入力と、
            全体の振り返り本文との間に配置する。 */}
        <ActualActivitiesBlock
          resetKey={`${periodKind}::${fiscalYear}::${quarter}::${month ?? ""}`}
          value={record?.actual_activities ?? null}
          editable={editable}
          availability={actualActivitiesAvailable}
          onSave={handleSaveActualActivities}
          mapError={e => (isPeriodReviewUniqueViolation(e) ? PERIOD_REVIEW_DUPLICATE_MESSAGE : null)}
          helperText="計画外の対応・方針転換・追加で実施したことなど、実際に起きたことを書いてください。AIの下書きの材料になります。どのKRにも属さない業務（突発の依頼・他部署応援など）もここに書けます。"
          variant="embedded"
        />

        {/* 全体の振り返り本文 */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>全体の振り返り本文</div>
            {editable && (
              <button
                onClick={() => setDraftModalOpen(true)}
                style={{ fontFamily: "inherit", fontSize: "11px", cursor: "pointer", padding: "4px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)" }}
              >✦ 振り返りの下書きを生成</button>
            )}
          </div>
          {editable ? (
            <textarea value={reviewText} onChange={e => setReviewText(e.target.value)} style={textareaStyle} />
          ) : (
            <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{reviewText || "（記録なし）"}</div>
          )}
        </div>

        {/* GMコメント */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>GMコメント</div>
          {editable ? (
            <textarea value={gmComment} onChange={e => setGmComment(e.target.value)} style={{ ...textareaStyle, minHeight: "72px" }} />
          ) : (
            <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{gmComment || "（未記入）"}</div>
          )}
          <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "5px" }}>
            月次面談でGMから受け取ったコメントを記録する欄です。
          </div>
        </div>

        {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{error}</div>}

        {editable && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              fontSize: "12px", fontWeight: 700, padding: "7px 16px", borderRadius: "var(--radius-md)",
              border: "none", cursor: saving ? "wait" : !dirty ? "default" : "pointer",
              background: !dirty ? "var(--color-bg-tertiary)" : "var(--color-brand)",
              color: !dirty ? "var(--color-text-tertiary)" : "#fff",
            }}
            title={!dirty ? "保存済みです。変更するとこのボタンが押せるようになります。" : undefined}
          >
            {saving ? "保存中…" : !dirty ? "✓ 保存済み" : "保存"}
          </button>
        )}
        {!editable && (
          <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
            未来の期間はまだ編集できません。
          </div>
        )}
      </div>

      {draftModalOpen && (
        <PersonalOkrPeriodReviewDraftModal
          periodLabel={title.replace(/の全体$| 全体$/, "")}
          materialSummaryLines={draftMaterialSummaryLines}
          contextText={draftContextText}
          existingReviewText={reviewText}
          onApply={text => setReviewText(text)}
          onClose={() => setDraftModalOpen(false)}
        />
      )}
    </div>
  );
}
