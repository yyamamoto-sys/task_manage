// src/components/okr/personal/ActualActivitiesBlock.tsx
//
// 【設計意図】
// 「実施記録」欄（山本さんの依頼・2026-08-27・v3.105）。振返りを下書きする際の材料が
// 「計画」と「毎週の目標」しか無く、途中で生じた緊急対応・方針転換・計画外の追加業務が
// 反映されない、という依頼に対応する。KR×月（personal_kr_months.actual_activities）と
// 月全体・四半期全体（personal_period_reviews.actual_activities）の両方で、この同じUIを
// 共有する（コピペしない。仕様書§W3）。
//
// 🔴🔴 最重要（仕様書§W2）：actual_activities列がまだ無い環境（マイグレーション未適用の窓）
// でも、計画欄・振り返り欄・バンド決定の保存を壊さないための設計。
// - このコンポーネントの保存（onSave）は、呼び出し元が「actual_activitiesだけを
//   パッチする」独立した保存関数を渡すこと。計画欄・振り返り欄・バンド決定の保存関数と
//   patchオブジェクトを共有しない（handleSaveMonthPlan/handleSetBandOverride/
//   MonthReviewBlock.handleSave/PersonalPeriodReviewBlock.handleSaveはこのファイルの
//   追加にあたって一切変更していない）。
// - availabilityが"available"以外（"unknown"=未確認／"unavailable"=未適用と判明）の間は
//   入力欄を出さない。"unknown"の間は案内も出さず静かに待つ（プローブは高速に解決する
//   想定のため、チラつきを避ける）。"unavailable"のときだけ案内文を出す。
// - 保存時にPGRST204（列が見つからない）を検知したときも、既定の案内文へ落ちる
//   （プローブの判定漏れに対する二重の防御）。
//
// 保存の作法はMonthReviewBlock.tsx/PersonalPeriodReviewBlock.tsxと同じ（明示保存・
// 未変更時は「✓ 保存済み」表示。CLAUDE.md Section 48）。未保存編集レジストリ
// （CLAUDE.md Section 46）にも登録する。

import { useEffect, useId, useRef, useState } from "react";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../../lib/editing/unsavedEditorRegistry";
import { computeActualActivitiesDirty, toActualActivitiesSaveValue } from "../../../lib/personalOkr/actualActivitiesForm";
import { isActualActivitiesColumnMissing, ACTUAL_ACTIVITIES_MISSING_MESSAGE } from "../../../lib/personalOkr/actualActivitiesSaveError";
import type { ActualActivitiesAvailability } from "../../../lib/personalOkr/actualActivitiesAvailability";
import { formatErrorForUser } from "../../../lib/errorMessage";

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
  width: "100%", minHeight: "88px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
};

interface Props {
  /** KR/月・期間の切替を検知するためのキー（変わったら下書きを保存済み値へ同期し直す） */
  resetKey: string;
  /** 保存済みの値 */
  value: string | null;
  editable: boolean;
  availability: ActualActivitiesAvailability;
  /** actual_activitiesだけをパッチする、呼び出し元が用意した独立の保存関数 */
  onSave: (next: string | null) => Promise<void>;
  helperText: string;
  /**
   * ドメイン固有のエラー（例：personal_period_reviewsの部分ユニークインデックス衝突）を
   * 人が読める文言に変換する。nullを返すか未指定なら既定のフォーマッタにフォールバックする。
   */
  mapError?: (e: unknown) => string | null;
  /**
   * "section"（既定）：見出し＋独立したカード（PersonalKrPanel.tsxの「今月の計画」
   * 「振り返り」と同格の1セクションとして置く場合）。
   * "embedded"：見出し・カードの外枠を出さず、中身だけを描画する（PersonalPeriodReviewBlock.tsx
   * のように、既に1枚の大きなカードの中に他の入力欄と並べて置く場合。二重の入れ子カードに
   * ならないようにするため）。
   */
  variant?: "section" | "embedded";
}

export function ActualActivitiesBlock({
  resetKey, value, editable, availability, onSave, helperText, mapError, variant = "section",
}: Props) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
    setError(null);
  }, [resetKey, value]);

  const dirty = computeActualActivitiesDirty(draft, value);

  // 🔴🔴 未保存編集レジストリへの登録（CLAUDE.md Section 46）。availabilityが
  // "available"でない間はUI自体を描画しない（下のreturn null）ため、実質的にdirtyが
  // trueになることはないが、フックは常に無条件で呼ぶ（Reactのルール）。
  const registryId = useId();
  const isDirtyRef = useRef(dirty);
  isDirtyRef.current = dirty;
  useEffect(() => {
    registerUnsavedEditor(registryId, () => isDirtyRef.current);
    return () => unregisterUnsavedEditor(registryId);
  }, [registryId]);

  // 🔴 "unknown"（未確認）の間は入力欄そのものを出さない（案内も出さず静かに待つ）。
  if (availability === "unknown") return null;

  const isEmbedded = variant === "embedded";

  if (availability === "unavailable") {
    const body = <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{ACTUAL_ACTIVITIES_MISSING_MESSAGE}</div>;
    if (isEmbedded) {
      return (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>実施記録</div>
          {body}
        </div>
      );
    }
    return (
      <div style={{ marginTop: "20px" }}>
        <div style={sectionHeadStyle}><span>実施記録</span><span style={ruleStyle} /></div>
        <div style={cardStyle}>{body}</div>
      </div>
    );
  }

  const handleSave = async () => {
    if (!editable) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(toActualActivitiesSaveValue(draft));
    } catch (e) {
      const mapped = mapError?.(e) ?? null;
      setError(mapped ?? (isActualActivitiesColumnMissing(e) ? ACTUAL_ACTIVITIES_MISSING_MESSAGE : formatErrorForUser("実施記録の保存に失敗しました", e)));
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      <p style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", margin: "0 0 8px", lineHeight: 1.6 }}>{helperText}</p>
      {editable ? (
        <textarea value={draft} onChange={e => setDraft(e.target.value)} style={textareaStyle} />
      ) : (
        <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{draft || "（記録なし）"}</div>
      )}
      {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginTop: "8px" }}>{error}</div>}
      {editable && (
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            marginTop: "10px", fontSize: "12px", fontWeight: 700, padding: "7px 16px", borderRadius: "var(--radius-md)",
            border: "none", cursor: saving ? "wait" : !dirty ? "default" : "pointer",
            background: !dirty ? "var(--color-bg-tertiary)" : "var(--color-brand)",
            color: !dirty ? "var(--color-text-tertiary)" : "#fff",
          }}
          title={!dirty ? "保存済みです。変更するとこのボタンが押せるようになります。" : undefined}
        >
          {saving ? "保存中…" : !dirty ? "✓ 保存済み" : "実施記録を保存"}
        </button>
      )}
    </>
  );

  if (isEmbedded) {
    return (
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>実施記録</div>
        {content}
      </div>
    );
  }

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={sectionHeadStyle}><span>実施記録</span><span style={ruleStyle} /></div>
      <div style={cardStyle}>{content}</div>
    </div>
  );
}
