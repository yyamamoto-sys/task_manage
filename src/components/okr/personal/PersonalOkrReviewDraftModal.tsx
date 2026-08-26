// src/components/okr/personal/PersonalOkrReviewDraftModal.tsx
//
// 【設計意図】
// 個人OKRビュー「月末の振り返り下書き」（Phase 4・docs/dev/okr-redesign-plan.md §8・
// CLAUDE.md Section 24 Step M）の入口モーダル。入口はPersonalKrPanel.tsxの
// 「📝 振り返りの下書き」ボタン。
//
// 🔴 Section 21準拠（modalStyles.ts）：中央寄せは箱側のmargin:"auto"（modalBoxStyle経由）。
// 🔴 機械計算分（material）は即時描画し、AIが書く部分（review_text/evidence/carryover）
// だけをスケルトンにする（Step H・AheadBlock.tsxと同じ）。undefined（未取得）とnull
// （未生成）を区別する——draftRow===undefinedのときだけ読み込み中の扱いにする。
// 🔴 過去月でも生成できる（D3）：monthStatusによる非活性化はこのモーダルでは行わない
// （呼び出し元＝PersonalKrPanel.tsxが「未来月ではこのボタン自体を出さない」ことで対処する）。
// 生成ボタンの非活性判定は「材料が無いか」（isReviewMaterialEmpty）だけで行う。
//
// 🔴 W2（2026-08-26・下書き→振り返り本文の1本化）：
// - 初期値の優先順位は「①月のreview_text ②旧draftRow.edited_text（救済） ③draft_json.review_text」。
//   これは「モーダルを開いた最初の1回」だけに適用し、その後「再生成」で新しいdraftRowが来た
//   ときは常に新しい生成結果を表示する（再生成しても月のreview_textは自動上書きしないため、
//   優先順位のまま出すと古い保存値に戻ってしまう）。initializedRefで両者を区別する。
// - 「編集を保存」は月の review_text に保存する（personal_kr_review_drafts へは書かない）。
// - 既に review_text に本文がある状態で「再生成」を押すとConfirmModalで確認する
//   （cancel側＝安全側＝再生成しない。CLAUDE.md Section 21・v3.88の教訓）。

import { useEffect, useRef, useState } from "react";
import type { PersonalKrReviewDraft } from "../../../lib/localData/types";
import type { ReviewMaterial } from "../../../lib/personalOkr/reviewMaterial";
import { isGenerationMaterialEmpty } from "../../../lib/personalOkr/reviewMaterial";
import { readStoredReviewDraftPayload } from "../../../lib/ai/personalOkrReviewDraftExtractor";
import { modalOverlayStyle, modalBoxStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../../common/modalStyles";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { showToast } from "../../common/Toast";
import { GuestAiQuotaNotice } from "../../common/GuestAiQuotaNotice";
import { confirmDialog } from "../../../lib/dialog";

interface Props {
  krLabel: string;
  monthLabel: string;
  material: ReviewMaterial;
  /** 月の計画欄（positioning/activities/target_and_evidence/risks）のいずれかに記入があるか */
  hasPlanContent: boolean;
  /** その月のメモ件数 */
  memoCount: number;
  /** 月の振り返り本文（personal_kr_months.review_text）。初期値の第1優先。 */
  monthReviewText: string | null;
  /** undefined=DBから未取得（初回のensureReviewDraftLoaded完了前）／null=まだ生成していない */
  draftRow: PersonalKrReviewDraft | null | undefined;
  analyzing: boolean;
  error: string | null;
  onEnsureLoaded: () => void;
  onGenerate: (force: boolean) => void;
  /** 🔴 月のreview_textへ保存する（personal_kr_review_drafts.edited_textへは書かない） */
  onSaveEdit: (editedText: string) => Promise<void>;
  onClose: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px",
};

export function PersonalOkrReviewDraftModal({
  krLabel, monthLabel, material, hasPlanContent, memoCount, monthReviewText, draftRow, analyzing, error,
  onEnsureLoaded, onGenerate, onSaveEdit, onClose,
}: Props) {
  useEffect(() => { onEnsureLoaded(); }, [onEnsureLoaded]);

  const draftPayload = draftRow ? readStoredReviewDraftPayload(draftRow.draft_json) : null;
  const hasDraft = !!draftRow;
  const hasEditableContent = hasDraft || !!(monthReviewText && monthReviewText.trim());

  // 初期値：①月のreview_text ②旧draftRow.edited_text（救済） ③draft_json.review_text
  const initialText = monthReviewText ?? draftRow?.edited_text ?? draftPayload?.review_text ?? "";
  const [editedText, setEditedText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 「初回の同期（優先順位で決める）」と「再生成による同期（常に新しい生成結果で上書き）」を
  // 区別するためのフラグ（draftRowが未取得＝undefinedの間は初期化しない）。
  const initializedRef = useRef(false);

  useEffect(() => {
    if (draftRow === undefined) return; // まだensureReviewDraftLoaded完了前
    if (!initializedRef.current) {
      initializedRef.current = true;
      setEditedText(initialText);
      return;
    }
    // 🔴 再生成時：review_textは自動上書きしないため、優先順位のままだと古い保存値に
    // 戻ってしまう。ここでは常に新しい生成結果をテキストエリアへ差し替える（保存は人が押す）。
    setEditedText(draftPayload?.review_text ?? draftRow?.edited_text ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRow]);

  const materialEmpty = isGenerationMaterialEmpty(material, hasPlanContent, memoCount);
  const isLoading = analyzing || draftRow === undefined;
  // 🔴 dirtyの基準は「実際に保存済みの月のreview_text」。旧draftRow.edited_text等の救済値が
  // 表示されているだけで review_text 自体は未保存、というケースでも保存ボタンを押せるようにする。
  const dirty = editedText !== (monthReviewText ?? "");

  const handleGenerateClick = async () => {
    // 🔴 既に振り返り本文がある状態で再生成すると、確認なしにテキストエリアの表示が
    // 新しい生成結果に置き換わってしまう。保存側の安全（cancel＝再生成しない）を優先する
    // （CLAUDE.md Section 21・v3.88の教訓＝ConfirmModalは背景クリックで必ずcancel扱い）。
    if (hasDraft && monthReviewText && monthReviewText.trim()) {
      const proceed = await confirmDialog(
        "既に振り返り本文があります。再生成すると、この画面の下書き表示が新しい内容に置き換わります（保存を押すまで本文は変わりません）。再生成しますか？",
        { tone: "neutral", confirmLabel: "再生成する", cancelLabel: "このままにする" },
      );
      if (!proceed) return;
    }
    onGenerate(hasDraft);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveEdit(editedText);
      showToast("振り返り本文に保存しました");
    } catch (e) {
      setSaveError(formatErrorForUser("編集の保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedText).then(
      () => showToast("下書きをコピーしました"),
      () => showToast("コピーに失敗しました。手動で選択してコピーしてください。", "error"),
    );
  };

  return (
    <div style={{ ...modalOverlayStyle(400), background: "rgba(0,0,0,0.45)" }}>
      <div style={{ ...modalBoxStyle("min(620px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)" }}>
        <div style={{ flexShrink: 0, padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border-primary)" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>📝 振り返りの下書き</div>
          <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{krLabel}・{monthLabel}</div>
        </div>

        <div style={{ ...MODAL_BODY_STYLE, padding: "16px 20px" }}>
          {/* ①材料（機械計算・即時描画） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={labelStyle}>材料（機械計算）</div>
            <div style={{
              display: "flex", flexDirection: "column", gap: "5px", fontSize: "12.5px",
              color: "var(--color-text-primary)", background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "11px 13px",
            }}>
              {/* 🔴 週の自己評価は任意の補助機能。◯△✕が全て0なら週の行ごと出さない
                  （週数の内訳＝全N週中・設定済みN週・未評価N週、は削除した。CLAUDE.md Section 24） */}
              {(material.ratingCounts.o > 0 || material.ratingCounts.t > 0 || material.ratingCounts.x > 0) && (
                <div>週の自己評価：◯{material.ratingCounts.o}／△{material.ratingCounts.t}／✕{material.ratingCounts.x}</div>
              )}
              <div>紐づくタスク：完了{material.completedTaskCount}件・未完了{material.incompleteTaskCount}件（計{material.linkedTaskCount}件）</div>
              {(material.taskStats.delayedCount > 0 || material.taskStats.stagnantCount > 0 || material.taskStats.blockedCount > 0) && (
                <div style={{ color: "var(--color-text-warning)" }}>
                  うち遅延{material.taskStats.delayedCount}件・停滞{material.taskStats.stagnantCount}件・先行待ち{material.taskStats.blockedCount}件
                </div>
              )}
            </div>
          </div>

          {/* 生成／再生成ボタン */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
            <button
              onClick={handleGenerateClick}
              disabled={analyzing || materialEmpty}
              style={{
                fontFamily: "inherit", fontSize: "12px", fontWeight: 700, padding: "7px 16px",
                background: analyzing || materialEmpty ? "var(--color-bg-tertiary)" : "var(--color-brand)",
                color: analyzing || materialEmpty ? "var(--color-text-tertiary)" : "#fff",
                border: "none", borderRadius: "var(--radius-md)",
                cursor: analyzing || materialEmpty ? "default" : "pointer",
              }}
            >{analyzing ? "生成中…" : hasDraft ? "再生成" : "下書きを生成"}</button>
            <GuestAiQuotaNotice variant="inline" />
            {materialEmpty && (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                まだ材料がありません（計画・週の記録・タスク・メモのいずれかを書いてから生成してください）
              </span>
            )}
            {error && !analyzing && (
              <span style={{ fontSize: "11px", color: "var(--color-text-danger)" }}>{error}</span>
            )}
          </div>

          {/* ②AIの下書き（編集可能） */}
          <div style={{ marginBottom: "16px" }}>
            <div style={labelStyle}>下書き（編集できます）</div>
            {isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[1, 0.9, 0.7, 0.85].map((w, i) => (
                  <div key={i} style={{ height: "11px", width: `${w * 100}%`, borderRadius: "var(--radius-sm)", background: "var(--color-bg-tertiary)", opacity: 0.7 }} />
                ))}
              </div>
            ) : hasEditableContent ? (
              <>
                <textarea
                  value={editedText}
                  onChange={e => setEditedText(e.target.value)}
                  style={{
                    width: "100%", minHeight: "140px", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.7,
                    padding: "10px 12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
                  Kintoneの「個人OKR_月次振返り記録」の「振り返り」欄に貼り付けてください。自己評価の割合・達成度バンドの数値は含まれていません（人が決めてください）。
                  保存すると、この画面の「振り返り」にも記録されます。
                </div>
                {saveError && <div style={{ fontSize: "11px", color: "var(--color-text-danger)", marginTop: "6px" }}>{saveError}</div>}
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    onClick={handleCopy}
                    disabled={!editedText.trim()}
                    style={{ fontFamily: "inherit", fontSize: "11.5px", padding: "6px 13px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", cursor: editedText.trim() ? "pointer" : "default", opacity: editedText.trim() ? 1 : 0.5 }}
                  >コピー</button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !dirty}
                    style={{
                      fontFamily: "inherit", fontSize: "11.5px", fontWeight: 700, padding: "6px 13px",
                      background: saving || !dirty ? "var(--color-bg-tertiary)" : "var(--color-brand-light)",
                      color: saving || !dirty ? "var(--color-text-tertiary)" : "var(--color-brand)",
                      border: `1px solid ${saving || !dirty ? "var(--color-border-primary)" : "var(--color-brand-border)"}`,
                      borderRadius: "var(--radius-sm)", cursor: saving || !dirty ? "default" : "pointer",
                    }}
                  >{saving ? "保存中…" : "編集を保存"}</button>
                </div>
              </>
            ) : (
              <div style={{ padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", border: "1px dashed var(--color-border-secondary)", fontSize: "11.5px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                上の「下書きを生成」を押すと、AIが振り返りの下書きを作成します。
              </div>
            )}
          </div>

          {/* ③evidence（折りたたみ） */}
          {hasDraft && draftPayload && draftPayload.evidence.length > 0 && (
            <details style={{ marginBottom: "12px" }}>
              <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
                根拠（評価の確認用・貼り付け対象外）
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "11.5px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                {draftPayload.evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}

          {/* ④carryover */}
          {hasDraft && draftPayload && draftPayload.carryover.length > 0 && (
            <div>
              <div style={labelStyle}>来月への申し送り</div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                {draftPayload.carryover.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div style={{ ...MODAL_FOOTER_STYLE, display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px 20px", borderTop: "1px solid var(--color-border-primary)" }}>
          <button
            onClick={onClose}
            style={{ fontFamily: "inherit", fontSize: "12px", padding: "7px 16px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >閉じる</button>
        </div>
      </div>
    </div>
  );
}
