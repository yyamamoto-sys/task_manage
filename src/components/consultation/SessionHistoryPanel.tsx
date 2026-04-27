// src/components/consultation/SessionHistoryPanel.tsx
//
// 【設計意図】
// AI相談の過去セッション一覧と詳細を表示するオーバーレイパネル。
// localStorageから自ユーザー分の履歴のみ読み込む。
// 詳細表示はread-only（反映ボタンなし）。

import { useState } from "react";
import type { SavedChatSession } from "../../lib/ai/chatHistoryStorage";
import { loadChatHistory, deleteChatSession } from "../../lib/ai/chatHistoryStorage";

interface Props {
  userId: string;
  onClose: () => void;
}

const CONSULT_TYPE_LABELS: Record<string, string> = {
  change: "影響整理",
  simulate: "What-If",
  diagnose: "診断",
  deadline_check: "逆算",
  scope_change: "縮小/停止",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diffDays === 1) return `昨日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseProposalTitles(content: string): string[] {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.proposals)) {
      return (parsed.proposals as { title?: string }[]).map(p => p.title ?? "").filter(Boolean);
    }
  } catch { /* ignore */ }
  return [];
}

export function SessionHistoryPanel({ userId, onClose }: Props) {
  const [history, setHistory] = useState<SavedChatSession[]>(() => loadChatHistory(userId));
  const [selectedSession, setSelectedSession] = useState<SavedChatSession | null>(null);

  const handleDelete = (sessionId: string) => {
    deleteChatSession(userId, sessionId);
    setHistory(prev => prev.filter(s => s.id !== sessionId));
    if (selectedSession?.id === sessionId) setSelectedSession(null);
  };

  // ===== 詳細ビュー =====
  if (selectedSession) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* ヘッダー */}
        <div style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
          flexShrink: 0,
        }}>
          <button
            onClick={() => setSelectedSession(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "16px", color: "var(--color-text-tertiary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedSession.title || "（タイトルなし）"}
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "1px" }}>
              {CONSULT_TYPE_LABELS[selectedSession.consultationType] ?? selectedSession.consultationType}
              　·　{formatDate(selectedSession.savedAt)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ×
          </button>
        </div>

        {/* 会話内容（read-only） */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {selectedSession.turns.map((turn, i) => {
            if (turn.role === "user") {
              return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "85%",
                    padding: "8px 12px",
                    background: "var(--color-brand-light)",
                    border: "1px solid var(--color-brand-border)",
                    borderRadius: "var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)",
                    fontSize: "12px", color: "var(--color-text-primary)",
                    lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {turn.content}
                  </div>
                </div>
              );
            }

            // assistantターン：提案タイトル一覧をテキストで表示
            const titles = parseProposalTitles(turn.content);
            return (
              <div key={i} style={{
                padding: "8px 12px",
                background: "var(--color-bg-secondary)",
                borderRadius: "var(--radius-md)",
                fontSize: "11px", color: "var(--color-text-secondary)",
                lineHeight: 1.6,
              }}>
                {titles.length > 0 ? (
                  <>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                      AIの提案（{titles.length}件）
                    </div>
                    {titles.map((t, ti) => (
                      <div key={ti} style={{ paddingLeft: "8px", borderLeft: "2px solid var(--color-border-secondary)", marginBottom: "3px" }}>
                        {t}
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ color: "var(--color-text-tertiary)" }}>AIからの返信</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== 一覧ビュー =====
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ヘッダー */}
      <div style={{
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--color-border-primary)",
        display: "flex", alignItems: "center", gap: "8px",
        flexShrink: 0,
      }}>
        <ClockIcon size={14} color="var(--color-text-purple)" />
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          相談履歴
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          {history.length} / 10件
        </span>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--color-text-tertiary)", lineHeight: 1, padding: "2px 4px" }}
        >
          ×
        </button>
      </div>

      {/* 一覧 */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {history.length === 0 ? (
          <div style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--color-text-tertiary)",
            fontSize: "12px",
            lineHeight: 1.8,
          }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>💬</div>
            まだ相談履歴がありません。<br />
            AIに相談すると、ここに記録されます。
          </div>
        ) : (
          history.map(session => (
            <div
              key={session.id}
              onClick={() => setSelectedSession(session)}
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border-primary)",
                cursor: "pointer",
                display: "flex", alignItems: "flex-start", gap: "8px",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-secondary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: "12px", fontWeight: "500",
                  color: "var(--color-text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  marginBottom: "3px",
                }}>
                  {session.title || "（タイトルなし）"}
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", display: "flex", gap: "6px", alignItems: "center" }}>
                  <span style={{
                    padding: "1px 6px", borderRadius: "var(--radius-full)",
                    background: "var(--color-bg-tertiary)",
                    color: "var(--color-text-secondary)",
                    fontSize: "9px", fontWeight: "500",
                  }}>
                    {CONSULT_TYPE_LABELS[session.consultationType] ?? session.consultationType}
                  </span>
                  <span>{formatDate(session.savedAt)}</span>
                  <span style={{ color: "var(--color-border-secondary)" }}>·</span>
                  <span>{Math.ceil(session.turns.length / 2)}往復</span>
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(session.id); }}
                title="この履歴を削除"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "14px", color: "var(--color-text-tertiary)",
                  padding: "2px 4px", flexShrink: 0,
                  lineHeight: 1,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-danger)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-tertiary)"; }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ClockIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.3"/>
      <path d="M8 4.5V8l2.5 2" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
