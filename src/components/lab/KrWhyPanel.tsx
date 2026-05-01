// src/components/lab/KrWhyPanel.tsx
//
// 【設計意図】
// ラボ機能：5Whys（なぜなぜ分析）をAIと対話形式で進め、根本原因サマリーを生成する。
// KR/TFデータをAIに渡す（ラボ機能例外ルール適用）。

import { useState, useMemo, useRef, useEffect } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import { LS_KEY } from "../../lib/localData/localStore";
import { callWhyDialogue, callWhySummary, type WhyMessage } from "../../lib/ai/krWhyClient";
import { fetchKrSessions, type KrSession } from "../../lib/supabase/krSessionStore";
import { buildMessageContent, getContentText } from "../../lib/ai/invokeAI";
import { useTypingEffect } from "../../hooks/useTypingEffect";
import { showToast } from "../common/Toast";
import { FileAttachButton, FileDropZone, type FileAttachment } from "../common/FileAttachButton";

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

const MAX_TURNS = 7;

function getCurrentQuarter(date: Date): string {
  const m = date.getMonth() + 1;
  if (m <= 3) return "1Q（1〜3月）";
  if (m <= 6) return "2Q（4〜6月）";
  if (m <= 9) return "3Q（7〜9月）";
  return "4Q（10〜12月）";
}

type SavedSummary = { summary: string; savedAt: string; issueText: string; krTitle: string };
const summaryKey = LS_KEY.krWhySummary;

function loadSavedSummary(krId: string): SavedSummary | null {
  try {
    const raw = localStorage.getItem(summaryKey(krId));
    return raw ? (JSON.parse(raw) as SavedSummary) : null;
  } catch {
    return null;
  }
}

export function KrWhyPanel({ onClose, inline = false, initialKrId }: Props) {
  const { keyResults, taskForces, objective, todos, tasks, members, projects } = useAppData();

  const activeKrs = useMemo(
    () => (keyResults ?? []).filter(kr => !kr.is_deleted),
    [keyResults],
  );

  const [selectedKrId, setSelectedKrId] = useState(initialKrId ?? activeKrs[0]?.id ?? "");
  const [selectedTfIds, setSelectedTfIds] = useState<string[]>([]);
  const [issueText, setIssueText] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [messages, setMessages] = useState<WhyMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [typingIndex, setTypingIndex] = useState(-1);
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null);
  const [krSessions, setKrSessions] = useState<KrSession[]>([]);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;
  const relatedTfs = useMemo(
    () => (taskForces ?? [])
      .filter(tf => tf.kr_id === selectedKrId && !tf.is_deleted)
      .sort((a, b) => (Number(a.tf_number) || 999) - (Number(b.tf_number) || 999)),
    [taskForces, selectedKrId],
  );

  // KR変更時に保存済みサマリー＆セッション履歴を読み込む・TF選択をリセット
  useEffect(() => {
    setSelectedTfIds([]);
    setSavedSummary(loadSavedSummary(selectedKrId));
    if (!selectedKrId) return;
    fetchKrSessions(selectedKrId)
      .then(ss => setKrSessions(ss))
      .catch(() => setKrSessions([]));
  }, [selectedKrId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (phase === "dialogue") inputRef.current?.focus();
  }, [phase, messages.length]);

  const buildContext = () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const quarter = getCurrentQuarter(today);

    const memberMap = Object.fromEntries(
      (members ?? []).map(m => [m.id, m.short_name]),
    );
    const projectMap = Object.fromEntries(
      (projects ?? []).filter(p => !p.is_deleted).map(p => [p.id, p.name]),
    );
    const STATUS_LABEL: Record<string, string> = {
      todo: "未着手", in_progress: "進行中", done: "完了",
    };

    const objLine = objective
      ? `${objective.title}（${objective.period}）`
      : "（未設定）";

    const krListLines = activeKrs
      .map(kr => `  ${kr.id === selectedKrId ? "▶ " : "  "}${kr.title}`)
      .join("\n");

    const focusedTfs = selectedTfIds.length > 0 ? relatedTfs.filter(tf => selectedTfIds.includes(tf.id)) : relatedTfs;
    const tfDetailLines = focusedTfs.map(tf => {
      const relatedTodos = (todos ?? []).filter(
        t => !t.is_deleted && t.tf_id === tf.id,
      );
      const todoLines = relatedTodos.map(todo => {
        const todoTasks = (tasks ?? []).filter(
          t => !t.is_deleted && (t.todo_ids ?? []).includes(todo.id),
        );
        const doneCnt = todoTasks.filter(t => t.status === "done").length;
        const progressStr = todoTasks.length > 0
          ? ` (${doneCnt}/${todoTasks.length}完了)`
          : "";
        const taskLines = todoTasks.map(task => {
          const assignee = task.assignee_member_id
            ? (memberMap[task.assignee_member_id] ?? "未定")
            : "未定";
          const due = task.due_date
            ? ` 期日：${String(task.due_date).slice(0, 10)}`
            : "";
          const pj = task.project_id
            ? ` [PJ：${projectMap[task.project_id] ?? "?"}]`
            : "";
          return `          - ${task.name} [${STATUS_LABEL[task.status] ?? task.status}] 担当：${assignee}${due}${pj}`;
        }).join("\n");
        return `      ToDo：${todo.title}${progressStr}${taskLines ? `\n${taskLines}` : ""}`;
      }).join("\n");
      return `  TF${tf.tf_number ?? ""} ${tf.name}${tf.description ? `（${tf.description}）` : ""}${todoLines ? `\n${todoLines}` : "\n      （タスクなし）"}`;
    }).join("\n");

    // セッション履歴ブロック
    const SIGNAL_LABEL: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
    const recentSessions = krSessions.slice(0, 12);
    const signalBlock = recentSessions.length > 0
      ? recentSessions.map(s => {
          const dot = s.signal ? SIGNAL_LABEL[s.signal] : "—";
          const type = s.session_type === "checkin" ? "チェックイン" : "ウィン";
          const comment = s.signal_comment ? `「${s.signal_comment.slice(0, 60)}」` : "";
          return `  ${s.week_start} ${type} ${dot} ${comment}`;
        }).join("\n")
      : "  （記録なし）";

    const winLearnings = recentSessions
      .filter(s => s.session_type === "win_session" && s.learnings)
      .map(s => `  ${s.week_start}：${s.learnings.slice(0, 120)}`)
      .join("\n") || "  （記録なし）";

    return `【現在日時】
今日：${todayStr}　現在クォーター：${quarter}

【Objective】
${objLine}

【全KR一覧】
${krListLines || "  （KRなし）"}

【対象KR・タスク詳細】
KR：${selectedKr?.title ?? ""}
${tfDetailLines || "  （TF・タスクなし）"}

【週次シグナル推移（直近最大12週）】
${signalBlock}

【ウィンセッションの学び・外部環境変化】
${winLearnings}

【掘り下げたい課題】
${issueText.trim()}`;
  };

  const handleStart = async () => {
    if (!selectedKr || (!issueText.trim() && !attachment)) return;
    setPhase("thinking");
    setError(null);
    setMessages([]);
    setTurnCount(0);

    const context = buildContext();
    const firstUserMsg: WhyMessage = {
      role: "user",
      content: buildMessageContent(
        `${context}\n\nこの課題について、なぜなぜ分析を進めてください。`,
        attachment,
      ),
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
      setTurnCount(turnCount + 1);
      setPhase("dialogue");
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

      // localStorage に保存
      const saved: SavedSummary = {
        summary: result,
        savedAt: new Date().toISOString(),
        issueText,
        krTitle: selectedKr?.title ?? "",
      };
      localStorage.setItem(summaryKey(selectedKrId), JSON.stringify(saved));
      setSavedSummary(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "サマリー生成中にエラーが発生しました。");
      setPhase("dialogue");
    }
  };

  const handleCopySummary = () => {
    navigator.clipboard.writeText(summary).then(() => showToast("サマリーをコピーしました"));
  };

  const handleDownloadSummary = () => {
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([summary], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `なぜなぜ分析_${selectedKr?.title ?? "report"}_${today}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("ダウンロードしました");
  };

  const handleRestoreSaved = () => {
    if (!savedSummary) return;
    setSummary(savedSummary.summary);
    setIssueText(savedSummary.issueText);
    setPhase("summary");
  };

  const handleDeleteSaved = () => {
    localStorage.removeItem(summaryKey(selectedKrId));
    setSavedSummary(null);
    showToast("保存済みサマリーを削除しました", "info");
  };

  const handleReset = () => {
    setPhase("setup");
    setMessages([]);
    setIssueText("");
    setAttachment(null);
    setUserInput("");
    setSummary("");
    setTurnCount(0);
    setError(null);
  };

  const progressPct = Math.min((turnCount / MAX_TURNS) * 100, 100);

  // 対話エリアを表示するフェーズ
  const showDialogue = phase === "dialogue"
    || (phase === "thinking" && messages.length > 0)
    || phase === "summarizing"
    || phase === "summary";

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
        <span style={{ fontSize: "18px" }}>🔍</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
            KRなぜなぜ分析
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            AIとの対話で課題の根本原因を掘り下げます（最大{MAX_TURNS}回）
          </div>
        </div>
        {(phase === "dialogue" || phase === "summary") && (
          <button
            onClick={handleReset}
            style={{
              fontSize: "11px", padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >最初からやり直す</button>
        )}
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
        {phase === "setup" && (
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

            {/* TF選択（KRにTFがある場合のみ表示） */}
            {relatedTfs.length > 0 && (
              <div style={{ marginBottom: "14px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                  対象TF（任意）
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  <button
                    onClick={() => setSelectedTfIds([])}
                    style={{
                      padding: "4px 10px", fontSize: "11px", fontWeight: selectedTfIds.length === 0 ? "600" : "400",
                      background: selectedTfIds.length === 0 ? "var(--color-brand)" : "var(--color-bg-primary)",
                      border: `1px solid ${selectedTfIds.length === 0 ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                      borderRadius: "var(--radius-full)",
                      color: selectedTfIds.length === 0 ? "#fff" : "var(--color-text-secondary)",
                      cursor: "pointer",
                    }}
                  >全TF</button>
                  {relatedTfs.map(tf => {
                    const isSelected = selectedTfIds.includes(tf.id);
                    return (
                      <button
                        key={tf.id}
                        onClick={() => setSelectedTfIds(prev =>
                          isSelected ? prev.filter(id => id !== tf.id) : [...prev, tf.id]
                        )}
                        style={{
                          padding: "4px 10px", fontSize: "11px", fontWeight: isSelected ? "600" : "400",
                          background: isSelected ? "var(--color-brand)" : "var(--color-bg-primary)",
                          border: `1px solid ${isSelected ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                          borderRadius: "var(--radius-full)",
                          color: isSelected ? "#fff" : "var(--color-text-secondary)",
                          cursor: "pointer",
                        }}
                      >TF{tf.tf_number} {tf.name}</button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 保存済みサマリーバナー */}
            {savedSummary && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                background: "var(--color-bg-purple)",
                border: "1px solid var(--color-border-purple)",
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                marginBottom: "14px",
                fontSize: "12px",
              }}>
                <span style={{ fontSize: "16px" }}>💾</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: "600", color: "var(--color-text-primary)" }}>保存済みサマリーがあります</span>
                  <span style={{ color: "var(--color-text-tertiary)", marginLeft: "8px" }}>
                    {new Date(savedSummary.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {savedSummary.issueText && (
                    <div style={{ color: "var(--color-text-secondary)", marginTop: "2px", fontSize: "11px" }}>
                      課題：{savedSummary.issueText.slice(0, 60)}{savedSummary.issueText.length > 60 ? "…" : ""}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleRestoreSaved}
                  style={{
                    padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                    background: "var(--color-brand)", color: "#fff",
                    border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
                  }}
                >復元する</button>
                <button
                  onClick={handleDeleteSaved}
                  style={{
                    padding: "5px 10px", fontSize: "11px",
                    background: "transparent",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-tertiary)", cursor: "pointer",
                  }}
                >削除</button>
              </div>
            )}

            {/* 課題入力 */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                  掘り下げたい課題
                </label>
                <FileAttachButton
                  attachment={attachment}
                  onAttach={setAttachment}
                  onRemove={() => setAttachment(null)}
                />
              </div>
              <FileDropZone onAttach={setAttachment}>
                <textarea
                  value={issueText}
                  onChange={e => setIssueText(e.target.value)}
                  placeholder={attachment ? "添付ファイルがある場合は空欄でも分析を始められます。課題の補足メモを追加することもできます。" : "例：チェックインで毎週「来週こそやる」と宣言するが達成できていない\n例：TF2の新規開拓タスクが2週間以上進んでいない\nまたはファイルをここにドラッグ＆ドロップ"}
                  rows={4}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                    resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
                  }}
                />
              </FileDropZone>
            </div>

            {error && (
              <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)", marginBottom: "12px" }}>
                {error}
              </div>
            )}

            {(() => {
              const canStart = !!selectedKr && (!!issueText.trim() || !!attachment);
              return (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleStart}
                    disabled={!canStart}
                    style={{
                      padding: "11px 24px", fontSize: "13px", fontWeight: "600",
                      background: canStart ? "linear-gradient(135deg, #8b5cf6, #7c3aed)" : "var(--color-bg-tertiary)",
                      border: "none", borderRadius: "var(--radius-md)",
                      color: canStart ? "#fff" : "var(--color-text-tertiary)",
                      cursor: canStart ? "pointer" : "not-allowed",
                      boxShadow: canStart ? "0 2px 8px rgba(124,58,237,0.35)" : "none",
                    }}
                  >
                    🔍 なぜなぜ分析を始める
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* thinking（初回 = 対話前）*/}
        {phase === "thinking" && messages.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "16px", minHeight: "200px",
          }}>
            <div style={{ fontSize: "32px" }}>🔍</div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              AIが課題を分析しています...
            </div>
          </div>
        )}

        {/* 対話エリア（A3: summaryフェーズでも表示し続ける） */}
        {showDialogue && messages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            {/* プログレス（対話中のみ） */}
            {phase !== "summary" && (
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
            )}

            {/* 会話履歴 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {messages.map((msg, originalIdx) => {
                const textContent = getContentText(msg.content);
                if (msg.role === "user" && textContent.includes("この課題について、なぜなぜ分析を進めてください")) return null;
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
                        ? <TypingMessage text={textContent} isLatest={originalIdx === typingIndex} />
                        : textContent}
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

            {/* 回答入力（dialogue フェーズのみ） */}
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
              </div>
            )}
          </div>
        )}

        {/* サマリー（A3: 対話履歴の下に追加、上に移動させない） */}
        {phase === "summary" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", flex: 1 }}>
                根本原因分析サマリー
              </div>
              <button
                onClick={handleCopySummary}
                style={{
                  fontSize: "11px", padding: "5px 10px",
                  background: "transparent", border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >コピー</button>
              <button
                onClick={handleDownloadSummary}
                style={{
                  fontSize: "11px", padding: "5px 10px",
                  background: "transparent", border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >⬇ MD保存</button>
            </div>
            <div style={{
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-lg)",
              padding: "18px 20px",
            }}>
              {summary.split("\n").map((line, i) => {
                if (line.startsWith("## ")) {
                  return <div key={i} style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", marginTop: i > 0 ? "16px" : 0, marginBottom: "6px", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "4px" }}>{line.replace("## ", "")}</div>;
                }
                if (line.startsWith("- ")) {
                  const text = line.replace("- ", "");
                  const isAction = text.startsWith("アクション") || text.startsWith("【担当】");
                  return <div key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", paddingLeft: "12px", lineHeight: 1.7, display: "flex", gap: "6px", marginBottom: "2px" }}><span style={{ color: isAction ? "#16a34a" : "var(--color-brand)", flexShrink: 0, fontWeight: isAction ? "700" : "400" }}>•</span>{text}</div>;
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
      className="animate-overlay"
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
