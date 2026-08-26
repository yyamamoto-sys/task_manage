// src/components/okr/personal/PersonalOkrPeriodReviewDraftModal.tsx
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// AI下書き入口モーダル。入口は PersonalPeriodReviewBlock.tsx の
// 「✦ 振り返りの下書きを生成」ボタン。
//
// 🔴 生成→提示→反映の3段階（いきなり本文欄を書き換えない。DBへは書かない）：
// ①材料の要約（機械計算・即時描画。AIを待たない）
// ②生成ボタン
// ③生成結果を編集可能なtextareaで表示
// ④「本文欄に反映」→ 親（PersonalPeriodReviewBlock）のstateへセットするだけ
//    （保存は人が別途「振り返りを保存」ボタンを押す）。既に本文がある場合は
//    ConfirmModalで確認する（cancel側＝安全側＝反映しない。CLAUDE.md Section 21・v3.88の教訓）。
//
// 🔴 このAI機能は新しいテーブル（下書きキャッシュ）を持たない（山本さんの依頼原文
// 「AI生成履歴のテーブルは作らない」。仕様書§3）。生成結果はこのモーダルのローカルstateだけで
// 保持し、閉じれば消える（PersonalOkrPlanDraftModal.tsxと同じ設計）。
//
// 🔴 Section 21準拠（modalStyles.ts）：中央寄せは箱側のmargin:"auto"（modalBoxStyle経由）。

import { useState } from "react";
import {
  generatePersonalPeriodReviewDraft,
} from "../../../lib/ai/personalOkrPeriodReviewDraftExtractor";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../../common/modalStyles";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { showToast } from "../../common/Toast";
import { GuestAiQuotaNotice } from "../../common/GuestAiQuotaNotice";
import { confirmDialog } from "../../../lib/dialog";

interface Props {
  /** 例："8月" または "2026年度 3Q" */
  periodLabel: string;
  /** ①材料の要約（KRごとの1行。機械計算・即時描画） */
  materialSummaryLines: string[];
  /** AIへ渡す文脈（546対策の文字数調整済み。periodReviewDraftContext.tsが組み立て済み） */
  contextText: string;
  /** 本文欄の現在の入力内容（保存済みかどうかは問わない）。反映時の上書き確認に使う */
  existingReviewText: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px",
};

export function PersonalOkrPeriodReviewDraftModal({
  periodLabel, materialSummaryLines, contextText, existingReviewText, onApply, onClose,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reviewText: string; basis: string[] } | null>(null);
  const [text, setText] = useState("");

  const hasDraft = !!result;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generatePersonalPeriodReviewDraft(contextText);
      setResult({ reviewText: res.review_text, basis: res.basis });
      setText(res.review_text);
    } catch (e) {
      setError(formatErrorForUser("下書きの生成に失敗しました", e));
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (existingReviewText.trim()) {
      const ok = await confirmDialog(
        "全体の振り返り本文を書き換えます。よろしいですか？",
        { tone: "danger", confirmLabel: "上書きして反映する", cancelLabel: "反映しない" },
      );
      if (!ok) return;
    }
    onApply(text);
    showToast(`${periodLabel}の全体の振り返り本文に反映しました（保存するには「振り返りを保存」を押してください）`);
  };

  return (
    <div style={{ ...modalOverlayStyle(400), background: "rgba(0,0,0,0.45)" }}>
      <div style={{ ...modalBoxStyle("min(620px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)" }}>
        <div style={{ flexShrink: 0, padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border-primary)" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>✦ 振り返りの下書きを生成</div>
          <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{periodLabel}の全体</div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 20px" }}>
          {/* ①材料の要約（機械計算・即時描画） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={labelStyle}>材料（KRごとの記録・機械計算）</div>
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
                対象期間のKRに記録がまだありません。
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

          {/* ③生成結果（編集可能） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={labelStyle}>全体の振り返り本文の下書き（編集できます）</div>
            {generating ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[1, 0.9, 0.7, 0.85].map((w, i) => (
                  <div key={i} style={{ height: "11px", width: `${w * 100}%`, borderRadius: "var(--radius-sm)", background: "var(--color-bg-tertiary)", opacity: 0.7 }} />
                ))}
              </div>
            ) : hasDraft ? (
              <>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  style={{
                    width: "100%", minHeight: "140px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.7,
                    padding: "10px 12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
                  自己評価%・GM評価%の数値は含まれていません（人が決めてください）。
                </div>
              </>
            ) : (
              <div style={{ padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px dashed var(--color-border-secondary)", fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                上の「下書きを生成」を押すと、AIが全体の振り返り本文の下書きを作成します。
              </div>
            )}
          </div>

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
          >本文欄に反映</button>
        </div>
      </div>
    </div>
  );
}
