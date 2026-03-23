// src/components/consultation/ConsultationPanel.tsx
//
// 【設計意図】
// AI相談パネルのメインコンポーネント。右側からスライドして開く。
// 内部でuseAIConsultationを使う（唯一の呼び出し口）。
// CLAUDE.md Section 6-12参照。

import { useState, useRef } from "react";
import type { Member } from "../../lib/localData/types";
import type { ConsultationType } from "../../lib/localData/types";
import { useAIConsultation } from "../../hooks/useAIConsultation";
import { ChatHistory } from "./ChatHistory";
import { FollowUpButtons } from "./FollowUpButtons";
import { LoadingView } from "./LoadingView";
import { ErrorView } from "./ErrorView";
import { ProposalCard } from "./ProposalCard";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Member;
}

const CONSULTATION_TYPE_OPTIONS: { value: ConsultationType; label: string }[] = [
  { value: "change",         label: "変更の影響整理" },
  { value: "simulate",       label: "What-If シミュレーション" },
  { value: "diagnose",       label: "現状診断" },
  { value: "deadline_check", label: "締め切り逆算" },
  { value: "scope_change",   label: "スコープ縮小・停止" },
];

export function ConsultationPanel({ isOpen, onClose, currentUser }: Props) {
  const [consultationType, setConsultationType] =
    useState<ConsultationType>("change");
  const [inputText, setInputText] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    callState,
    session,
    tokenStatus,
    loadingMessage,
    shortIdMap,
    proposals,
    followUpSuggestions,
    errorMessage,
    submit,
    reset,
  } = useAIConsultation([]);

  const handleSubmit = async () => {
    if (!inputText.trim() || callState === "loading") return;
    const text = inputText;
    setInputText("");
    await submit({
      consultation: text,
      consultationType,
      targetDeadline: targetDeadline || null,
    });
  };

  const handleFollowUpSelect = (text: string) => {
    setInputText(text);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter または Cmd+Enter で送信
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      {/* オーバーレイ（モバイル時） */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.2)",
            zIndex: 90,
            // PC幅では非表示（パネル幅が400pxのためオーバーレイは見えにくいが保険として配置）
          }}
        />
      )}

      {/* パネル本体 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(400px, 100vw)",
          background: "var(--color-bg-primary)",
          borderLeft: "1px solid var(--color-border-primary)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 100,
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s ease",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid var(--color-border-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--color-text-purple)", fontSize: "14px" }}>
              ✦
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: "600",
                color: "var(--color-text-primary)",
              }}
            >
              AIに変更を相談
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {session.turns.length > 0 && (
              <button
                onClick={reset}
                style={{
                  fontSize: "11px",
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                }}
              >
                リセット
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="相談パネルを閉じる"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "18px",
                color: "var(--color-text-tertiary)",
                lineHeight: 1,
                padding: "2px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* トークン警告バナー */}
        {tokenStatus === "warning" && (
          <div
            style={{
              padding: "8px 16px",
              background: "var(--color-bg-warning)",
              borderBottom: "1px solid var(--color-border-warning)",
              fontSize: "11px",
              color: "var(--color-text-warning)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>⚠</span>
            <span>
              会話が長くなっています。「リセット」で新しい相談を始めると精度が上がります。
            </span>
          </div>
        )}

        {/* スクロール可能な中身 */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* consultation_typeセレクター */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label
              style={{
                fontSize: "10px",
                fontWeight: "500",
                color: "var(--color-text-tertiary)",
                letterSpacing: "0.03em",
              }}
            >
              相談の種類
            </label>
            <select
              value={consultationType}
              onChange={(e) =>
                setConsultationType(e.target.value as ConsultationType)
              }
              style={{
                fontSize: "12px",
                padding: "6px 10px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              {CONSULTATION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* deadline_checkモード時のみ日付入力を表示 */}
          {consultationType === "deadline_check" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label
                style={{
                  fontSize: "10px",
                  fontWeight: "500",
                  color: "var(--color-text-tertiary)",
                  letterSpacing: "0.03em",
                }}
              >
                締め切り日（必須）
              </label>
              <input
                type="date"
                value={targetDeadline}
                onChange={(e) => setTargetDeadline(e.target.value)}
                style={{
                  fontSize: "12px",
                  padding: "6px 10px",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-secondary)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>
          )}

          {/* テキストエリア */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label
              style={{
                fontSize: "10px",
                fontWeight: "500",
                color: "var(--color-text-tertiary)",
                letterSpacing: "0.03em",
              }}
            >
              相談内容
            </label>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例：田中さんが来週から産休に入ります。影響を確認して..."
              rows={4}
              disabled={callState === "loading"}
              style={{
                fontSize: "12px",
                padding: "8px 10px",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                background:
                  callState === "loading"
                    ? "var(--color-bg-tertiary)"
                    : "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                resize: "vertical",
                lineHeight: 1.6,
                minHeight: "80px",
              }}
            />
            <div
              style={{
                fontSize: "10px",
                color: "var(--color-text-tertiary)",
                textAlign: "right",
              }}
            >
              Ctrl+Enter で送信
            </div>
          </div>

          {/* 送信ボタン */}
          <button
            onClick={handleSubmit}
            disabled={!inputText.trim() || callState === "loading"}
            style={{
              fontSize: "12px",
              padding: "8px 16px",
              background:
                inputText.trim() && callState !== "loading"
                  ? "var(--color-brand)"
                  : "var(--color-bg-tertiary)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color:
                inputText.trim() && callState !== "loading"
                  ? "#fff"
                  : "var(--color-text-tertiary)",
              cursor:
                inputText.trim() && callState !== "loading"
                  ? "pointer"
                  : "not-allowed",
              fontWeight: "500",
              transition: "opacity 0.15s",
            }}
          >
            {callState === "loading" ? "AIが考えています..." : "AIに相談する"}
          </button>

          {/* ローディング */}
          {callState === "loading" && (
            <LoadingView message={loadingMessage} />
          )}

          {/* エラー */}
          {callState === "error" && (
            <ErrorView
              message={errorMessage}
              onRetry={() => {
                if (inputText.trim()) {
                  handleSubmit();
                }
              }}
            />
          )}

          {/* 最新の提案（成功時） */}
          {callState === "success" && proposals.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: "500",
                  color: "var(--color-text-tertiary)",
                  letterSpacing: "0.03em",
                }}
              >
                最新の提案 ({proposals.length}件)
              </div>
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.proposal_id}
                  proposal={proposal}
                  shortIdMap={shortIdMap}
                  currentUserId={currentUser.id}
                />
              ))}
            </div>
          )}

          {/* フォローアップボタン */}
          {followUpSuggestions.length > 0 && (
            <FollowUpButtons
              suggestions={followUpSuggestions}
              onSelect={handleFollowUpSelect}
            />
          )}

          {/* 会話履歴 */}
          {session.turns.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: "500",
                  color: "var(--color-text-tertiary)",
                  letterSpacing: "0.03em",
                  marginBottom: "8px",
                  paddingTop: "8px",
                  borderTop: "1px solid var(--color-border-primary)",
                }}
              >
                会話履歴
              </div>
              <ChatHistory
                session={session}
                shortIdMap={shortIdMap}
                currentUserId={currentUser.id}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
