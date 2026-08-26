// src/components/okr/personal/MonthReviewBlock.tsx
//
// 【設計意図】
// 個人OKRビュー「振り返り」ブロック（山本さんの依頼・2026-08-26）。
// 月次振り返りの結果（review_text／self_eval_pct／gm_eval_pct／gm_comment）を
// 記入・記録できるようにする。当月・過去月で表示する（未来月では呼び出し元が描画しない）。
//
// 🔴 保存はv3.87/v3.93の作法に合わせる：自動保存にしない・明示保存（保存ボタン）。
// 未変更時は🚫（cursor:not-allowed）にせず「✓ 保存済み」表示にする（v3.93の決定。
// CLAUDE.md Section 48）。dirty判定・数値バリデーションは monthReviewForm.ts（純粋関数）。
//
// 🔴 保存は既存レコードの他フィールド（計画欄・バンド決定・Kintone取込情報等）を
// 消さないよう mergeMonthRecord を経由する（Step 0で確認した実際の不具合の芽。
// CLAUDE.md Section 24参照）。
//
// 🔴 過去月のみ、達成度バンドの「決定」UIをここに置く（当月はAheadBlock側にある。
// 両方に出すと同じ操作の入口が2つになるため、当月ではここに出さない）。

import { useEffect, useId, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Member, PersonalKr, PersonalKrBand, PersonalKrMonth } from "../../../lib/localData/types";
import type { MonthTemporalStatus } from "../../../lib/personalOkr/quarterMonths";
import { mergeMonthRecord } from "../../../lib/personalOkr/monthRecordMerge";
import { parseEvalPctInput, computeMonthReviewDirty } from "../../../lib/personalOkr/monthReviewForm";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../../lib/editing/unsavedEditorRegistry";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { BandOverridePicker } from "./BandOverridePicker";

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
  width: "100%", minHeight: "140px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
};
const numberInputStyle: React.CSSProperties = {
  width: "100px", fontFamily: "inherit", fontSize: "12.5px", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
};

interface Props {
  kr: PersonalKr;
  currentUser: Member;
  monthStr: string;
  monthIndex: 1 | 2 | 3;
  monthRecord: PersonalKrMonth | null;
  monthStatus: MonthTemporalStatus; // "future"では呼び出し元が描画しない
  readOnly: boolean;
  onSaveMonth: (month: PersonalKrMonth, expectedUpdatedAt?: string) => Promise<void>;
  onSetBandOverride: (value: PersonalKrBand | null) => Promise<void>;
  onOpenDraftModal: () => void;
}

export function MonthReviewBlock({
  kr, currentUser, monthStr, monthIndex, monthRecord, monthStatus, readOnly,
  onSaveMonth, onSetBandOverride, onOpenDraftModal,
}: Props) {
  const [reviewText, setReviewText] = useState("");
  const [selfEvalRaw, setSelfEvalRaw] = useState("");
  const [gmEvalRaw, setGmEvalRaw] = useState("");
  const [gmComment, setGmComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // kr・monthが変わったとき、または月レコードのreview_text（他画面＝下書きモーダルからの
  // 保存）が変わったときに、下書きを最新の保存済み値へ同期する。
  useEffect(() => {
    setReviewText(monthRecord?.review_text ?? "");
    setSelfEvalRaw(monthRecord?.self_eval_pct != null ? String(monthRecord.self_eval_pct) : "");
    setGmEvalRaw(monthRecord?.gm_eval_pct != null ? String(monthRecord.gm_eval_pct) : "");
    setGmComment(monthRecord?.gm_comment ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kr.id, monthStr, monthRecord?.id, monthRecord?.review_text]);

  const dirty = computeMonthReviewDirty(
    { reviewText, selfEvalRaw, gmEvalRaw, gmComment },
    {
      reviewText: monthRecord?.review_text, selfEvalPct: monthRecord?.self_eval_pct,
      gmEvalPct: monthRecord?.gm_eval_pct, gmComment: monthRecord?.gm_comment,
    },
  );

  // 🔴🔴 未保存編集レジストリへの登録（CLAUDE.md Section 46・v3.100）。既存の`dirty`
  // （保存ボタンの活性・非活性にも使っている値）をそのままgetterに渡す＝判定を二重化しない。
  const reviewRegistryId = useId();
  const isReviewDirtyRef = useRef(dirty);
  isReviewDirtyRef.current = dirty;
  useEffect(() => {
    registerUnsavedEditor(reviewRegistryId, () => isReviewDirtyRef.current);
    return () => unregisterUnsavedEditor(reviewRegistryId);
  }, [reviewRegistryId]);

  const handleSave = async () => {
    if (readOnly) return; // 🔴🔴 サンプル表示中は保存経路に入らせない
    const selfEval = parseEvalPctInput(selfEvalRaw);
    const gmEval = parseEvalPctInput(gmEvalRaw);
    if (selfEval.error) { setError(`自己評価%：${selfEval.error}`); return; }
    if (gmEval.error) { setError(`GM評価%：${gmEval.error}`); return; }

    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const fallback: PersonalKrMonth = {
      id: uuidv4(), personal_kr_id: kr.id, month: monthStr, month_index: monthIndex,
      is_deleted: false, created_at: now,
    };
    const month = mergeMonthRecord(monthRecord, fallback, {
      review_text: reviewText || null,
      self_eval_pct: selfEval.value,
      gm_eval_pct: gmEval.value,
      gm_comment: gmComment || null,
      updated_by: currentUser.id,
    });
    try {
      await onSaveMonth(month, monthRecord?.updated_at);
    } catch (e) {
      setError(formatErrorForUser("振り返りの保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-tour-id="okr-month-review" style={{ marginTop: "20px" }}>
      <div style={sectionHeadStyle}>
        <span>📝 振り返り</span><span style={ruleStyle} />
        <span>{monthStatus === "past" ? "過去月・編集可" : "今月の振り返り"}</span>
      </div>
      <div style={cardStyle}>
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>振り返り本文</div>
            {!readOnly && (
              <button
                onClick={onOpenDraftModal}
                style={{ fontFamily: "inherit", fontSize: "11px", cursor: "pointer", padding: "4px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)" }}
              >
                📝 振り返りの下書き
              </button>
            )}
          </div>
          {readOnly ? (
            <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{reviewText || "（記録なし）"}</div>
          ) : (
            <textarea value={reviewText} onChange={e => setReviewText(e.target.value)} style={textareaStyle} />
          )}
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>自己評価%</div>
          {readOnly ? (
            <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>{selfEvalRaw ? `${selfEvalRaw}%` : "（未記入）"}</div>
          ) : (
            <input
              type="number" min={0} max={100} step="any"
              value={selfEvalRaw} onChange={e => setSelfEvalRaw(e.target.value)}
              style={numberInputStyle}
            />
          )}
          <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
            Kintone「個人OKR_月次振返り記録」の［自己評価：XX%（本KR%）］に対応します
          </div>
        </div>

        <details style={{ marginBottom: "14px" }}>
          <summary style={{ cursor: "pointer", fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>
            GM評価％・GMコメント
          </summary>
          <div style={{ marginTop: "8px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>GM評価%</div>
            {readOnly ? (
              <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>{gmEvalRaw ? `${gmEvalRaw}%` : "（未記入）"}</div>
            ) : (
              <input
                type="number" min={0} max={100} step="any"
                value={gmEvalRaw} onChange={e => setGmEvalRaw(e.target.value)}
                style={numberInputStyle}
              />
            )}
          </div>
          <div style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>GMコメント</div>
            {readOnly ? (
              <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{gmComment || "（未記入）"}</div>
            ) : (
              <textarea value={gmComment} onChange={e => setGmComment(e.target.value)} style={{ ...textareaStyle, minHeight: "72px" }} />
            )}
          </div>
          <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "5px" }}>
            上長との面談後に転記する欄です。Kintone取込でも埋まります
          </div>
        </details>

        {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{error}</div>}

        {!readOnly && (
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
            {saving ? "保存中…" : !dirty ? "✓ 保存済み" : "振り返りを保存"}
          </button>
        )}

        {/* 🔴 過去月のみ：バンド決定UIをここに置く（当月はAheadBlock側に既にあるため二重にしない） */}
        {monthStatus === "past" && (
          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px dotted var(--color-border-primary)" }}>
            <BandOverridePicker
              bandOverride={monthRecord?.band_override ?? null}
              editable={!readOnly}
              onSetOverride={onSetBandOverride}
            />
          </div>
        )}
      </div>
    </div>
  );
}
