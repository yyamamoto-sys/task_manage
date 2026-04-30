// src/components/lab/KrWhyPanel.tsx
//
// 【設計意図】
// ラボ機能：5Whys（なぜなぜ分析）をAIと対話形式で進め、根本原因サマリーを生成する。
// KR/TFデータをAIに渡す（ラボ機能例外ルール適用）。

import { useState, useMemo, useRef, useEffect } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import { callWhyDialogue, callWhySummary, type WhyMessage } from "../../lib/ai/krWhyClient";
import { useTypingEffect } from "../../hooks/useTypingEffect";

function ThinkingDots() {
  return (
    <span className="ai-thinking-dots" style={{ fontSize: "13px" }}>
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

function TypingMessage({ text, isLatest }: { text: string; isLatest: boolean }) {
  const { displayed } = useTypingEffect(isLatest ? text : "", 12);
  const shown = isLatest ? displayed : text;
  return <span className={isLatest ? "typing-cursor" : ""}>{shown}</span>;
}

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
  initialKrId?: string;
}

type Phase = "setup" | "thinking" | "dialogue" | "summarizing" | "summary";

const MAX_TURNS = 5;

export function KrWhyPanel({ onClose, inline = false, initialKrId }: Props) {
  const { keyResults, taskForces } = useAppData();

  const activeKrs = useMemo(
    () => (keyResults ?? []).filter(kr => !kr.is_deleted),
    [keyResults],
  );

  const [selectedKrId, setSelectedKrId] = useState(initialKrId ?? activeKrs[0]?.id ?? "");
  const [issueText, setIssueText] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [messages, setMessages] = useState<WhyMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [typingIndex, setTypingIndex] = useState(-1);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;
  const relatedTfs = (taskForces ?? []).filter(tf => tf.kr_id === selectedKrId && !tf.is_deleted);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (phase === "dialogue") inputRef.current?.focus();
  }, [phase, messages.length]);

  const buildContext = () => {
    const tfLines = relatedTfs.map(tf => `  - ${tf.tf_number ? `TF${tf.tf_number}` : ""} ${tf.name}${tf.description ? `：${tf.description}` : ""}`).join("\n");
    return `KR：${selectedKr?.title ?? ""}\n関連TF：\n${tfLines || "  （なし）"}\n\n掘り下げたい課題：${issueText.trim()}`;
  };

  const handleStart = async () => {
    if (!selectedKr || !issueText.trim()) return;
    setPhase("thinking");
    setError(null);
    setMessages([]);
    setTurnCount(0);

    const context = buildContext();
    const firstUserMsg: WhyMessage = {
      role: "user",
      content: `${context}\n\nこの課題について、なぜなぜ分析を進めてください。`,
    };

    try {
      const aiReply = await callWhyDialogue([firstUserMsg]);
      const initMsgs = [firstUserMsg, { role: "assistant" as const, content: aiReply }];
      setMessages(initMsgs);
      setTypingIndex(initMsgs.length - 1);
      setTurnCount(1);
      setPhase("dialogue");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
      setPhase("setup");
    }
  };

  const handleSendAnswer = async () => {
    const answer = userInput.trim();
    if (!answer || phase !== "dialogue") return;

    setUserInput("");
    const newMessages: WhyMessage[] = [...messages, { role: "user" as const, content: answer }];
    setMessages(newMessages);
    setPhase("thinking");
    setError(null);

    try {
      const aiReply = await callWhyDialogue(newMessages);
      const updated: WhyMessage[] = [...newMessages, { role: "assistant" as const, content: aiReply }];
      setMessages(updated);
      setTypingIndex(updated.length - 1);
      const newTurn = turnCount + 1;
      setTurnCount(newTurn);
      setPhase(newTurn >= MAX_TURNS ? "dialogue" : "dialogue");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
      setPhase("dialogue");
    }
  };

  const handleGenerateSummary = async () => {
    setPhase("summarizing");
    setError(null);
    try {
      const context = buildContext();
      const result = await callWhySummary(context, messages);
      setSummary(result);
      setPhase("summary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "サマリー生成中にエラーが発生しました。");
      setPhase("dialogue");
    }
  };

  const handleCopySummary = () => {
    navigator.clipboard.writeText(summary).then(() => alert("コピーしました。"));
  };

  const handleReset = () => {
    setPhase("setup");
    setMessages([]);
    setIssueText("");
    setUserInput("");
    setSummary("");
    setTurnCount(0);
    setError(null);
  };

  const progressPct = Math.min((turnCount / MAX_TURNS) * 100, 100);

  const panelContent = (
    <div
      className={inline ? "" : "panel-slide-up"}
      style={{
        width: inline ? "100%" : "min(720px, 100vw)",
        height: "100%",
        background: "var(--color-bg-primary)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        ...(inline ? {} : { boxShadow: "-4px 0 24px rgba(0,0,0,0.18)" }),
      }}
      onClick={inline ? undefined : e => e.stopPropagation()}
    >
        {/* ヘッダー */}
        <div className="ai-shimmer" style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "18px" }}>🧪</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              KRなぜなぜ分析
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              AIとの対話で課題の根本原因を掘り下げます（最大{MAX_TURNS}回）
            </div>
          </div>
          {!inline && (
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1 }}
            >✕</button>
          )}
        </div>

        {/* コンテンツ */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* セットアップ */}
          {(phase === "setup" || phase === "thinking" && messages.length === 0) && (
            <div style={{
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-lg)",
              padding: "18px 20px",
            }}>
              {/* KR選択 */}
              <div style={{ marginBottom: "14px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                  対象KR
                </label>
                {activeKrs.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>KRが登録されていません。</div>
                ) : (
                  <select
                    value={selectedKrId}
                    onChange={e => setSelectedKrId(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px", fontSize: "13px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                    }}
                  >
                    {activeKrs.map(kr => <option key={kr.id} value={kr.id}>{kr.title}</option>)}
                  </select>
                )}
              </div>

              {/* 課題入力 */}
              <div style={{ marginBottom: "14px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                  掘り下げたい課題
                </label>
                <textarea
                  value={issueText}
                  onChange={e => setIssueText(e.target.value)}
                  placeholder={"例：チェックインで毎週「来週こそやる」と宣言するが達成できていない\n例：TF2の新規開拓タスクが2週間以上進んでいない"}
                  rows={4}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                    resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
                  }}
                />
              </div>

              {error && (
                <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)", marginBottom: "12px" }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={!selectedKr || !issueText.trim() || phase === "thinking"}
                style={{
                  width: "100%", padding: "11px", fontSize: "13px", fontWeight: "600",
                  background: !selectedKr || !issueText.trim() || phase === "thinking"
                    ? "var(--color-bg-tertiary)" : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                  border: "none", borderRadius: "var(--radius-md)",
                  color: !selectedKr || !issueText.trim() || phase === "thinking" ? "var(--color-text-tertiary)" : "#fff",
                  cursor: !selectedKr || !issueText.trim() || phase === "thinking" ? "not-allowed" : "pointer",
                  boxShadow: selectedKr && issueText.trim() && phase !== "thinking" ? "0 2px 8px rgba(124,58,237,0.35)" : "none",
                }}
              >
                {phase === "thinking" ? "⏳ AIが準備中..." : "🔍 なぜなぜ分析を始める"}
              </button>
            </div>
          )}

          {/* 対話エリア */}
          {(phase === "dialogue" || phase === "thinking" && messages.length > 0 || phase === "summarizing") && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

              {/* プログレス */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    第{turnCount}層 / 最大{MAX_TURNS}層
                  </span>
                  {turnCount >= MAX_TURNS && (
                    <span style={{ fontSize: "11px", color: "var(--color-text-warning)", fontWeight: "600" }}>
                      最大深度に到達
                    </span>
                  )}
                </div>
                <div style={{ height: 4, background: "var(--color-bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progressPct}%`, background: "linear-gradient(90deg, #8b5cf6, #7c3aed)", borderRadius: 2, transition: "width 0.3s" }} />
                </div>
              </div>

              {/* 会話履歴（setup以外） */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {messages.map((msg, originalIdx) => {
                  if (msg.role === "user" && msg.content.includes("この課題について、なぜなぜ分析を進めてください")) return null;
                  return (
                    <div key={originalIdx} className="chat-bubble-in" style={{
                      display: "flex",
                      justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    }}>
                      <div style={{
                        maxWidth: "85%",
                        padding: "10px 14px",
                        borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                        background: msg.role === "user" ? "var(--color-brand)" : "var(--color-bg-secondary)",
                        color: msg.role === "user" ? "#fff" : "var(--color-text-primary)",
                        border: msg.role === "assistant" ? "1px solid var(--color-border-primary)" : "none",
                        fontSize: "13px", lineHeight: 1.7,
                      }}>
                        {msg.role === "assistant" && (
                          <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-purple, #7c3aed)", marginBottom: "4px", opacity: 0.8 }}>AI</div>
                        )}
                        {msg.role === "assistant"
                          ? <TypingMessage text={msg.content} isLatest={originalIdx === typingIndex} />
                          : msg.content}
                      </div>
                    </div>
                  );
                })}

                {(phase === "thinking" || phase === "summarizing") && (
                  <div className="chat-bubble-in" style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{
                      padding: "10px 14px",
                      borderRadius: "12px 12px 12px 4px",
                      background: "var(--color-bg-secondary)",
                      border: "1px solid var(--color-border-primary)",
                      fontSize: "12px", color: "var(--color-text-tertiary)",
                    }}>
                      <ThinkingDots />
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* 回答入力 */}
              {phase === "dialogue" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <textarea
                    ref={inputRef}
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendAnswer(); }
                    }}
                    placeholder="回答を入力してください（Enterで送信、Shift+Enterで改行）"
                    rows={3}
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: "12px",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                      resize: "none", lineHeight: 1.6, boxSizing: "border-box",
                    }}
                  />
                  {error && (
                    <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "6px 10px", borderRadius: "var(--radius-md)" }}>
                      {error}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleSendAnswer}
                      disabled={!userInput.trim()}
                      style={{
                        flex: 1, padding: "9px", fontSize: "12px", fontWeight: "600",
                        background: userInput.trim() ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                        border: "none", borderRadius: "var(--radius-md)",
                        color: userInput.trim() ? "#fff" : "var(--color-text-tertiary)",
                        cursor: userInput.trim() ? "pointer" : "not-allowed",
                      }}
                    >
                      答える →
                    </button>
                    <button
                      onClick={handleGenerateSummary}
                      style={{
                        padding: "9px 14px", fontSize: "12px", fontWeight: "600",
                        background: "transparent",
                        border: "1px solid var(--color-brand)",
                        borderRadius: "var(--radius-md)",
                        color: "var(--color-brand)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      サマリー生成
                    </button>
                  </div>
                  <button
                    onClick={handleReset}
                    style={{
                      padding: "5px", fontSize: "11px",
                      background: "transparent", border: "none",
                      color: "var(--color-text-tertiary)", cursor: "pointer",
                    }}
                  >
                    最初からやり直す
                  </button>
                </div>
              )}
            </div>
          )}

          {/* サマリー */}
          {phase === "summary" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
                  根本原因分析サマリー
                </div>
                <button
                  onClick={handleCopySummary}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent", border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
                  }}
                >
                  コピー
                </button>
                <button
                  onClick={handleReset}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent", border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
                  }}
                >
                  やり直す
                </button>
              </div>
              <div style={{
                background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-lg)",
                padding: "18px 20px",
              }}>
                {summary.split("\n").map((line, i) => {
                  if (line.startsWith("## ")) {
                    return <div key={i} style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", marginTop: i > 0 ? "16px" : 0, marginBottom: "6px" }}>{line.replace("## ", "")}</div>;
                  }
                  if (line.startsWith("- ")) {
                    return <div key={i} style={{ fontSize: "13px", color: "var(--color-text-secondary)", paddingLeft: "12px", lineHeight: 1.7, display: "flex", gap: "6px" }}><span style={{ color: "var(--color-brand)", flexShrink: 0 }}>•</span>{line.replace("- ", "")}</div>;
                  }
                  if (!line.trim()) return <div key={i} style={{ height: "6px" }} />;
                  return <div key={i} style={{ fontSize: "13px", color: "var(--color-text-primary)", lineHeight: 1.8 }}>{line}</div>;
                })}
              </div>
            </div>
          )}
        </div>
    </div>
  );

  if (inline) return panelContent;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {panelContent}
    </div>
  );
}
