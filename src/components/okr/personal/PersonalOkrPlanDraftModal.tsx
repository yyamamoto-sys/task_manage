// src/components/okr/personal/PersonalOkrPlanDraftModal.tsx
//
// 【設計意図】
// 個人OKR「前月をふまえて下書き」（翌月の計画ドラフト。v3.99・CLAUDE.md Section 24 Step P）
// の入口モーダル。入口は PersonalKrPanel.tsx の「✦ 前月をふまえて下書き」ボタン。
//
// 🔴 生成→提示→反映の3段階（いきなり計画欄を書き換えない。DBへは書かない）：
// ①材料の要約（機械計算・即時描画。AIを待たない）
// ②生成ボタン（初回は「下書きを生成」・生成済みなら「再生成」）
// ③生成結果を4欄＋バンド提案で表示。各欄はその場で編集できるtextarea
// ④「計画欄に反映」→ 親（PersonalKrPanel）のstateへセットするだけ（保存は人が別途行う）。
//    既に記入がある欄が1つでもあればConfirmModalで確認する
//    （cancel側＝安全側＝反映しない。CLAUDE.md Section 21・v3.88の教訓）。
// ⑤バンド提案は別扱い：「この値を狙いに入れる」ボタンを4欄の反映とは別に置く
//    （数値は人が明示的に選ぶ、という既存方針を維持するため）。
//
// 🔴 Section 21準拠（modalStyles.ts）：中央寄せは箱側のmargin:"auto"（modalBoxStyle経由）。
// このモーダルはKintone等の外部保存先を持たないため、personalOkrReviewDraftModalのような
// DB由来のキャッシュ（draftRow）は無い。生成結果はこのモーダルのローカルstateだけで保持し、
// 閉じれば消える（山本さんの設計判断＝新しいテーブル・新しい列は作らない）。

import { useState } from "react";
import type { PersonalKrBand } from "../../../lib/localData/types";
import {
  generatePersonalKrPlanDraft,
  type PersonalOkrPlanDraftResult,
} from "../../../lib/ai/personalOkrPlanDraftExtractor";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../../common/modalStyles";
import { BAND_LABELS } from "../../../lib/personalOkr/bandOptions";
import { buildKintonePlanCopyText } from "../../../lib/personalOkr/kintoneFormat";
import { type PlanDraftFields, resolveOverwrittenPlanFieldLabels } from "../../../lib/personalOkr/planDraftContext";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { showToast } from "../../common/Toast";
import { GuestAiQuotaNotice } from "../../common/GuestAiQuotaNotice";
import { confirmDialog } from "../../../lib/dialog";

export type { PlanDraftFields };

interface Props {
  krLabel: string;
  /** 例："8月" */
  targetMonthLabel: string;
  /** 実際の月番号（1〜12）。「全文をコピー」の見出しに使う（month_indexではない） */
  monthNumber: number;
  /** ①材料の要約（過去月ごとに1行。過去月が無ければ空配列） */
  materialSummaryLines: string[];
  /** AIへ渡す文脈（546対策の文字数調整済み。src/lib/personalOkr/planDraftContext.tsが組み立て済み） */
  contextText: string;
  /** 計画欄の現在の入力内容（保存済みかどうかは問わない）。反映時の上書き確認に使う */
  existingPlanFields: PlanDraftFields;
  onApply: (fields: PlanDraftFields) => void;
  onSetBandTarget: (band: PersonalKrBand) => void;
  onClose: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px",
};

const textareaStyle: React.CSSProperties = {
  width: "100%", minHeight: "64px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
};

const FIELD_DEFS: { key: keyof PlanDraftFields; label: string }[] = [
  { key: "positioning", label: "位置づけ" },
  { key: "activities", label: "取り組む内容" },
  { key: "targetAndEvidence", label: "当月末の達成目標と、その証拠" },
  { key: "risks", label: "リスクと依存関係" },
];

const EMPTY_FIELDS: PlanDraftFields = { positioning: "", activities: "", targetAndEvidence: "", risks: "" };

export function PersonalOkrPlanDraftModal({
  krLabel, targetMonthLabel, monthNumber, materialSummaryLines, contextText, existingPlanFields,
  onApply, onSetBandTarget, onClose,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalOkrPlanDraftResult | null>(null);
  const [fields, setFields] = useState<PlanDraftFields>(EMPTY_FIELDS);

  const hasDraft = !!result;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generatePersonalKrPlanDraft(contextText);
      setResult(res);
      setFields({
        positioning: res.positioning,
        activities: res.activities,
        targetAndEvidence: res.target_and_evidence,
        risks: res.risks,
      });
    } catch (e) {
      setError(formatErrorForUser("下書きの生成に失敗しました", e));
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    const overwrittenLabels = resolveOverwrittenPlanFieldLabels(existingPlanFields);
    if (overwrittenLabels.length > 0) {
      const ok = await confirmDialog(
        `${overwrittenLabels.join("・")}の${overwrittenLabels.length}欄を書き換えます。よろしいですか？`,
        { tone: "danger", confirmLabel: "上書きして反映する", cancelLabel: "反映しない" },
      );
      if (!ok) return;
    }
    onApply(fields);
    showToast(`${targetMonthLabel}の計画欄に反映しました（保存するには「${targetMonthLabel}の計画を保存」を押してください）`);
  };

  const handleSetBand = () => {
    if (result?.band_target == null) return;
    onSetBandTarget(result.band_target);
    showToast(`狙いのバンドに${result.band_target}を反映しました（保存するには「${targetMonthLabel}の計画を保存」を押してください）`);
  };

  // 🔴 Kintoneへ貼るための「全文をコピー」（山本さんの依頼・v3.103）：モーダル内で編集中の
  // 4欄＋バンド提案を対象にする（計画欄へ反映・保存しなくてもコピーできる）。
  const planCopyText = hasDraft
    ? buildKintonePlanCopyText({
        positioning: fields.positioning, activities: fields.activities,
        targetAndEvidence: fields.targetAndEvidence, risks: fields.risks,
        bandTarget: result?.band_target ?? null, monthNumber,
      })
    : "";
  const handleCopyPlanText = () => {
    navigator.clipboard.writeText(planCopyText).then(
      () => showToast("計画の全文をコピーしました"),
      () => showToast("コピーに失敗しました。手動で選択してコピーしてください。", "error"),
    );
  };

  return (
    <div style={{ ...modalOverlayStyle(400), background: "rgba(0,0,0,0.45)" }}>
      <div style={{ ...modalBoxStyle("min(660px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)" }}>
        <div style={{ flexShrink: 0, padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border-primary)" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>✦ 前月をふまえて下書き</div>
          <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{krLabel}・{targetMonthLabel}の計画</div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 20px" }}>
          {/* ①材料の要約（機械計算・即時描画） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={labelStyle}>材料（機械計算）</div>
            {materialSummaryLines.length > 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", gap: "5px", fontSize: "12.5px",
                color: "var(--color-text-primary)", background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "11px 13px",
              }}>
                {materialSummaryLines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            ) : (
              <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
                過去月の記録はまだありません。KRの内容（達成基準等）から下書きします。
              </div>
            )}
          </div>

          {/* ②生成／再生成ボタン */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                fontFamily: "inherit", fontSize: "12px", fontWeight: 700, padding: "7px 16px",
                background: generating ? "var(--color-bg-tertiary)" : "var(--color-brand)",
                color: generating ? "var(--color-text-tertiary)" : "#fff",
                border: "none", borderRadius: "var(--radius-md)",
                cursor: generating ? "default" : "pointer",
              }}
            >{generating ? "生成中…" : hasDraft ? "再生成" : "下書きを生成"}</button>
            <GuestAiQuotaNotice variant="inline" />
            {error && !generating && (
              <span style={{ fontSize: "11px", color: "var(--color-text-danger)" }}>{error}</span>
            )}
          </div>

          {/* ③生成結果（4欄。編集可能） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div style={labelStyle}>計画の下書き（編集できます）</div>
              {hasDraft && (
                <button
                  onClick={handleCopyPlanText}
                  disabled={!planCopyText}
                  title={!planCopyText ? "記入がまだありません" : "Kintoneの見出し形式で計画欄の全文をコピーします"}
                  style={{
                    fontFamily: "inherit", fontSize: "10.5px", fontWeight: 700, padding: "4px 10px",
                    background: "transparent", border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-sm)",
                    color: planCopyText ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                    cursor: planCopyText ? "pointer" : "default", whiteSpace: "nowrap",
                  }}
                >📋 全文をコピー（Kintone用）</button>
              )}
            </div>
            {generating ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[1, 0.9, 0.75, 0.85].map((w, i) => (
                  <div key={i} style={{ height: "44px", width: `${w * 100}%`, borderRadius: "var(--radius-sm)", background: "var(--color-bg-tertiary)", opacity: 0.7 }} />
                ))}
              </div>
            ) : hasDraft ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {FIELD_DEFS.map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{f.label}</div>
                    <textarea
                      value={fields[f.key]}
                      onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      style={textareaStyle}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px dashed var(--color-border-secondary)", fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                上の「下書きを生成」を押すと、AIが翌月の計画の下書きを作成します。
              </div>
            )}
          </div>

          {/* ⑤バンド提案（4欄の反映とは別扱い） */}
          {hasDraft && (
            <div style={{ marginBottom: "16px" }}>
              <div style={labelStyle}>狙いのバンド（AIの提案）</div>
              {result.band_target != null ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "12.5px",
                  color: "var(--color-text-primary)", background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "11px 13px",
                }}>
                  <span>
                    AIの提案：{result.band_target}（{BAND_LABELS[result.band_target]}）
                    {result.band_target_reason && <span style={{ color: "var(--color-text-tertiary)" }}>（根拠：{result.band_target_reason}）</span>}
                  </span>
                  <button
                    onClick={handleSetBand}
                    style={{ fontFamily: "inherit", fontSize: "11.5px", fontWeight: 700, padding: "5px 12px", background: "var(--color-brand-light)", color: "var(--color-brand)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", whiteSpace: "nowrap" }}
                  >この値を狙いに入れる</button>
                </div>
              ) : (
                <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
                  判断材料が乏しいため、バンドの提案はありません。
                  {result.band_target_reason && `（${result.band_target_reason}）`}
                </div>
              )}
            </div>
          )}

          {/* basis（折りたたみ） */}
          {hasDraft && result.basis.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
                根拠（確認用・貼り付け対象外）
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "11.5px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                {result.basis.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </details>
          )}
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)" }}>
          <button
            onClick={onClose}
            style={{ fontFamily: "inherit", fontSize: "12px", padding: "7px 16px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >閉じる</button>
          <button
            onClick={handleApply}
            disabled={!hasDraft}
            style={{
              fontFamily: "inherit", fontSize: "12px", fontWeight: 700, padding: "7px 16px",
              background: hasDraft ? "var(--color-brand)" : "var(--color-bg-tertiary)",
              color: hasDraft ? "#fff" : "var(--color-text-tertiary)",
              border: "none", borderRadius: "var(--radius-md)", cursor: hasDraft ? "pointer" : "default",
            }}
          >計画欄に反映</button>
        </div>
      </div>
    </div>
  );
}
