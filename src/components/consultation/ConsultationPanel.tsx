// src/components/consultation/ConsultationPanel.tsx

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Member, Project } from "../../lib/localData/types";
import type { ConsultationType } from "../../lib/localData/types";
import { useAppData } from "../../context/AppDataContext";
import { useAIConsultation } from "../../hooks/useAIConsultation";
import { ChatHistory } from "./ChatHistory";
import { FollowUpButtons } from "./FollowUpButtons";
import { LoadingView } from "./LoadingView";
import { ErrorView } from "./ErrorView";
import { ProposalCard } from "./ProposalCard";
import { ChangeHistoryModal } from "./ChangeHistoryModal";
import { GanttPreviewPanel } from "./GanttPreviewPanel";
import type { UIProposal } from "../../lib/ai/proposalMapper";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Member;
  selectedProject?: Project | null;
  projects?: Project[];
  inline?: boolean;
}

const TYPE_CONFIG: {
  value: ConsultationType;
  label: string;
  shortLabel: string;
  description: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    value: "change",
    label: "変更の影響整理",
    shortLabel: "影響整理",
    description: "メンバーの不在・異動・スケジュール変更など、何かが変わったときに影響範囲を整理します。",
    placeholder: "例：○○さんが来週から長期休みに入ります。担当しているタスクへの影響を確認してください。",
    hint: "起きた変化を伝えてください。",
  },
  {
    value: "simulate",
    label: "What-If シミュレーション",
    shortLabel: "What-If",
    description: "「もし〜したら？」という仮定を試します。実際の変更は行わず、画面上でのシミュレーションのみです。",
    placeholder: "例：もし○○プロジェクトの締め切りを1ヶ月延ばしたら、他への影響はどうなりますか？",
    hint: "まだ決定していないことを気軽に試してみてください。",
  },
  {
    value: "diagnose",
    label: "現状診断",
    shortLabel: "診断",
    description: "今のプロジェクト・タスクの状況を分析して、リスクや課題を洗い出します。",
    placeholder: "例：今のプロジェクト全体を見て、遅延リスクや問題になりそな箇所を教えてください。",
    hint: "特定の変更がなくても「今どういう状態か確認したい」ときに使います。",
  },
  {
    value: "deadline_check",
    label: "締め切り逆算",
    shortLabel: "逆算",
    description: "目標日までに完了させるには何をすればよいかを逆算します。先に下の「締め切り日」を入力してください。",
    placeholder: "例：○○プロジェクトを上の締め切り日までに完了させるには今のペースで間に合いますか？",
    hint: "まず締め切り日を入力してから相談してください。",
  },
  {
    value: "scope_change",
    label: "スコープ縮小・停止",
    shortLabel: "縮小/停止",
    description: "プロジェクトやタスクを停止・縮小するときに、影響を確認しながら整理します。",
    placeholder: "例：○○プロジェクトの優先度が下がりました。止めるとしたらどのタスクから整理すればいいですか？",
    hint: "「リソースが足りなくなった」「優先度が下がった」ものがあるときに使います。",
  },
];

export function ConsultationPanel({
  isOpen,
  onClose,
  currentUser,
  selectedProject = null,
  projects = [],
  inline = false,
}: Props) {
  const [consultationType, setConsultationType] = useState<ConsultationType>("change");
  const [inputText, setInputText] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");
  const [includeOKR, setIncludeOKR] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [ganttPreviewProposal, setGanttPreviewProposal] = useState<UIProposal | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const { reload } = useAppData();
  const {
    callState, session, tokenStatus, loadingMessage,
    shortIdMap, proposals, followUpSuggestions, errorMessage,
    submit, reset, undoStack, canUndo, pushUndoSnapshot, undo, undoUntil,
  } = useAIConsultation([], currentUser.id);

  const currentType = TYPE_CONFIG.find(t => t.value === consultationType)!;
  const hasHistory = session.turns.length > 0;

  // 提案が来たらスクロールエリアを一番下へ
  useEffect(() => {
    if (callState === "success" && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [callState, proposals.length]);

  const handleSubmit = async () => {
    if (!inputText.trim() || callState === "loading") return;
    const text = inputText;
    setInputText("");
    await submit({ consultation: text, consultationType, targetDeadline: targetDeadline || null, includeOKR });
  };

  const handleFollowUpSelect = (text: string) => {
    setInputText(text);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTypeChange = (v: ConsultationType) => {
    setConsultationType(v);
    if (v !== "deadline_check") setTargetDeadline("");
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo(currentUser.id);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, canUndo, undo, currentUser.id]);

  const panelStyle: React.CSSProperties = inline ? {
    width: "400px", height: "100%",
    background: "var(--color-bg-primary)",
    borderLeft: "1px solid var(--color-border-primary)",
    display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0,
  } : {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: "min(400px, 100vw)",
    background: "var(--color-bg-primary)",
    borderLeft: "1px solid var(--color-border-primary)",
    boxShadow: "var(--shadow-lg)", zIndex: 100,
    transform: isOpen ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.3s ease",
    display: "flex", flexDirection: "column", overflow: "hidden",
  };

  return (
    <>
      {isHistoryOpen && (
        <ChangeHistoryModal
          stack={undoStack}
          onClose={() => setIsHistoryOpen(false)}
          onUndoUntil={(id) => undoUntil(id, currentUser.id)}
        />
      )}
      {ganttPreviewProposal && createPortal(
        <GanttPreviewPanel
          proposal={ganttPreviewProposal}
          shortIdMap={shortIdMap}
          currentUser={currentUser}
          selectedProject={selectedProject}
          onClose={() => setGanttPreviewProposal(null)}
        />,
        document.body,
      )}
      {!inline && isOpen && (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 90 }} />
      )}

      <div style={panelStyle}>

        {/* ===== ヘッダー ===== */}
        <div style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
          flexShrink: 0,
        }}>
          <span style={{ color: "var(--color-text-purple)", fontSize: "14px" }}>✦</span>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
            AIに変更を相談
          </span>

          {/* アクションボタングループ */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {canUndo && (
              <button
                onClick={() => undo(currentUser.id)}
                title="最後の変更を元に戻す (Cmd+Z)"
                style={headerBtnStyle(true)}
              >
                ↩ 元に戻す
              </button>
            )}
            {undoStack.length > 0 && (
              <button onClick={() => setIsHistoryOpen(true)} style={headerBtnStyle(false)}>
                履歴
              </button>
            )}
            {hasHistory && (
              <button onClick={reset} style={headerBtnStyle(false)} title="会話をリセットして新しい相談を始める">
                リセット
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="閉じる"
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", lineHeight: 1, padding: "2px 4px", marginLeft: "2px" }}
            >
              ×
            </button>
          </div>
        </div>

        {/* トークン警告 */}
        {tokenStatus === "warning" && (
          <div style={{
            padding: "8px 14px",
            background: "var(--color-bg-warning)", borderBottom: "1px solid var(--color-border-warning)",
            fontSize: "11px", color: "var(--color-text-warning)",
            display: "flex", alignItems: "center", gap: "6px",
          }}>
            <span>⚠</span>
            <span style={{ flex: 1 }}>会話が長くなっています。</span>
            <button
              onClick={reset}
              style={{ fontSize: "10px", padding: "2px 8px", background: "var(--color-text-warning)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", flexShrink: 0 }}
            >
              リセット
            </button>
          </div>
        )}

        {/* ===== スクロール可能エリア ===== */}
        <div ref={scrollAreaRef} style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>

          {/* 相談の種類タブ */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", marginBottom: "6px", letterSpacing: "0.04em" }}>
              相談の種類
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {TYPE_CONFIG.map(t => {
                const active = consultationType === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => handleTypeChange(t.value)}
                    style={{
                      fontSize: "11px", padding: "4px 10px",
                      borderRadius: "var(--radius-full)",
                      border: active ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                      background: active ? "var(--color-brand)" : "var(--color-bg-secondary)",
                      color: active ? "#fff" : "var(--color-text-secondary)",
                      cursor: "pointer", fontWeight: active ? "600" : "400",
                      transition: "all 0.1s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 選択中の相談種類の説明（タブ直下） */}
          <div style={{
            padding: "10px 12px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
          }}>
            <div style={{ fontSize: "12px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "4px" }}>
              {currentType.label}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              {currentType.description}
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "4px", paddingTop: "4px", borderTop: "1px solid var(--color-border-primary)" }}>
              💡 {currentType.hint}
            </div>
          </div>

          {/* 締め切り日入力（逆算モード時のみ） */}
          {consultationType === "deadline_check" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.04em" }}>
                締め切り日（必須）
              </label>
              <input
                type="date"
                value={targetDeadline}
                onChange={e => setTargetDeadline(e.target.value)}
                style={{ fontSize: "12px", padding: "6px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
              />
            </div>
          )}

          {/* OKRトグル */}
          <button
            onClick={() => setIncludeOKR(v => !v)}
            style={{
              display: "flex", alignItems: "flex-start", gap: "8px",
              padding: "8px 10px",
              background: includeOKR ? "var(--color-accent-bg, #eff6ff)" : "var(--color-bg-secondary)",
              border: `1px solid ${includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-border-primary)"}`,
              borderRadius: "var(--radius-md)", cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{
              width: 14, height: 14, borderRadius: "3px", flexShrink: 0, marginTop: "1px",
              background: includeOKR ? "var(--color-accent, #3b82f6)" : "transparent",
              border: `1.5px solid ${includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-border-primary)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {includeOKR && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3l2.5 2.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <div>
              <div style={{ fontSize: "11px", fontWeight: includeOKR ? "600" : "400", color: includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-text-secondary)" }}>
                OKR・タスクフォース情報も含めて相談する
              </div>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px", lineHeight: 1.5 }}>
                KR・TFの構造をAIに渡し、OKR視点での分析が可能になります
              </div>
            </div>
          </button>

          {/* ローディング */}
          {callState === "loading" && <LoadingView message={loadingMessage} />}

          {/* エラー */}
          {callState === "error" && (
            <ErrorView
              message={errorMessage}
              onRetry={() => { if (inputText.trim()) handleSubmit(); }}
            />
          )}

          {/* 最新の提案 */}
          {callState === "success" && proposals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.04em" }}>
                最新の提案（{proposals.length}件）
              </div>
              {proposals.map(proposal => (
                <ProposalCard
                  key={proposal.proposal_id}
                  proposal={proposal}
                  shortIdMap={shortIdMap}
                  currentUserId={currentUser.id}
                  onApplied={snapshot => { pushUndoSnapshot(snapshot); reload(); }}
                  onGanttPreview={p => setGanttPreviewProposal(p)}
                  onDecline={followUpText => {
                    submit({ consultation: followUpText, consultationType, targetDeadline: targetDeadline || null });
                  }}
                />
              ))}
            </div>
          )}

          {/* フォローアップボタン */}
          {followUpSuggestions.length > 0 && (
            <FollowUpButtons suggestions={followUpSuggestions} onSelect={handleFollowUpSelect} />
          )}

          {/* 会話履歴 */}
          {hasHistory && (
            <div>
              <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "8px", paddingTop: "8px", borderTop: "1px solid var(--color-border-primary)" }}>
                会話履歴
              </div>
              <ChatHistory session={session} shortIdMap={shortIdMap} currentUserId={currentUser.id} />
            </div>
          )}

          {/* スクロール余白 */}
          <div style={{ height: "8px" }} />
        </div>

        {/* ===== 固定フッター：入力エリア ===== */}
        <div style={{
          borderTop: "1px solid var(--color-border-primary)",
          padding: "10px 14px 12px",
          background: "var(--color-bg-primary)",
          flexShrink: 0,
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentType.placeholder}
            rows={3}
            disabled={callState === "loading"}
            style={{
              fontSize: "12px", padding: "8px 10px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: callState === "loading" ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              resize: "vertical", lineHeight: 1.6, minHeight: "72px",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>
              Ctrl+Enter で送信
            </span>
            <button
              onClick={handleSubmit}
              disabled={!inputText.trim() || callState === "loading"}
              style={{
                fontSize: "12px", padding: "7px 18px",
                background: inputText.trim() && callState !== "loading" ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                border: "none", borderRadius: "var(--radius-md)",
                color: inputText.trim() && callState !== "loading" ? "#fff" : "var(--color-text-tertiary)",
                cursor: inputText.trim() && callState !== "loading" ? "pointer" : "not-allowed",
                fontWeight: "500", transition: "all 0.15s", whiteSpace: "nowrap",
              }}
            >
              {callState === "loading" ? "生成中..." : "AIに相談する"}
            </button>
          </div>
        </div>

      </div>
    </>
  );
}

function headerBtnStyle(primary: boolean): React.CSSProperties {
  return {
    fontSize: "11px", padding: "4px 9px",
    background: primary ? "var(--color-bg-secondary)" : "transparent",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-sm)",
    color: primary ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
