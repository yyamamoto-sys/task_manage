// src/components/project/AiProjectCreateModal.tsx
//
// 【設計意図】
// AIとの対話でプロジェクトを立ち上げるウィザードモーダル。
// チャット段階（ヒアリング）→ 確認・編集段階 → 保存 の3フェーズ構成。

import { useState, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import {
  callProjectPlanDialogue,
  callProjectPlanFinalize,
  type PlanMessage,
  type PlannedTask,
} from "../../lib/ai/projectPlanClient";

interface Props {
  currentUser: Member;
  onClose: () => void;
  onCreated?: (projectId: string) => void;
}

type Phase = "chat" | "generating" | "confirm" | "saving" | "done" | "error";

const PROJECT_COLORS = [
  "#6366f1", "#3b82f6", "#14b8a6", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
];

const MAX_TURNS = 4;

export function AiProjectCreateModal({ currentUser, onClose, onCreated }: Props) {
  const { members: rawMembers, saveProject, saveTask } = useAppData();
  const members = (rawMembers ?? []).filter(m => !m.is_deleted);
  const today = new Date().toISOString().slice(0, 10);

  const [phase, setPhase] = useState<Phase>("chat");
  const [messages, setMessages] = useState<PlanMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // confirm フェーズの編集状態
  const [projectName, setProjectName] = useState("");
  const [projectPurpose, setProjectPurpose] = useState("");
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0]);
  const [ownerId, setOwnerId] = useState(currentUser.id);
  const [taskRows, setTaskRows] = useState<(PlannedTask & {
    selected: boolean;
    editedName: string;
    editedAssigneeId: string;
    editedDueDate: string;
  })[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 初回マウント：AIから最初の問いを取得
  useEffect(() => {
    (async () => {
      setIsThinking(true);
      try {
        const reply = await callProjectPlanDialogue([]);
        setMessages([{ role: "assistant", content: reply }]);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "AI呼び出しに失敗しました。");
        setPhase("error");
      } finally {
        setIsThinking(false);
      }
    })();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isThinking) return;
    const newMessages: PlanMessage[] = [...messages, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setInputText("");
    const newTurn = turnCount + 1;
    setTurnCount(newTurn);

    if (newTurn >= MAX_TURNS) return; // 上限に達したら自動送信なし

    setIsThinking(true);
    try {
      const reply = await callProjectPlanDialogue(newMessages);
      setMessages(prev => [...prev, { role: "assistant" as const, content: reply }]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "AI呼び出しに失敗しました。");
      setPhase("error");
    } finally {
      setIsThinking(false);
    }
  };

  const generatePlan = async () => {
    setPhase("generating");
    try {
      const plan = await callProjectPlanFinalize({
        messages,
        memberShortNames: members.map(m => m.short_name),
        today,
      });
      setProjectName(plan.project_name);
      setProjectPurpose(plan.purpose);
      setTaskRows(plan.tasks.map(t => {
        const matched = members.find(m => m.short_name === t.assignee_short_name);
        return {
          ...t,
          selected: true,
          editedName: t.name,
          editedAssigneeId: matched?.id ?? "",
          editedDueDate: t.due_date ?? "",
        };
      }));
      setPhase("confirm");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "プラン生成に失敗しました。");
      setPhase("error");
    }
  };

  const handleSave = async () => {
    if (!projectName.trim()) return;
    setPhase("saving");
    const now = new Date().toISOString();
    const newProjectId = uuidv4();
    try {
      await saveProject({
        id: newProjectId,
        name: projectName.trim(),
        purpose: projectPurpose.trim(),
        contribution_memo: "",
        owner_member_id: ownerId,
        owner_member_ids: [ownerId],
        status: "active",
        color_tag: projectColor,
        start_date: today,
        end_date: "",
        is_deleted: false,
        created_at: now,
        updated_at: now,
        updated_by: currentUser.id,
      });
      const selected = taskRows.filter(r => r.selected && r.editedName.trim());
      for (const r of selected) {
        await saveTask({
          id: uuidv4(),
          name: r.editedName.trim(),
          project_id: newProjectId,
          todo_ids: [],
          assignee_member_id: r.editedAssigneeId || "",
          assignee_member_ids: r.editedAssigneeId ? [r.editedAssigneeId] : [],
          status: "todo",
          priority: null,
          start_date: null,
          due_date: r.editedDueDate || null,
          estimated_hours: null,
          comment: r.note || "",
          is_deleted: false,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        });
      }
      setPhase("done");
      onCreated?.(newProjectId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "保存中にエラーが発生しました。");
      setPhase("error");
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "5px 8px", fontSize: "12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    width: "100%", boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(640px, 100%)",
        maxHeight: "90vh",
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        }}>
          <span style={{ fontSize: "18px" }}>✨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#fff" }}>
              AIでプロジェクトを立ち上げる
            </div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
              {phase === "chat" && "目的・メンバー・期間をAIに伝えると計画案を作ります"}
              {phase === "generating" && "プロジェクト計画を生成中..."}
              {phase === "confirm" && "内容を確認・編集してから作成してください"}
              {phase === "saving" && "プロジェクトを保存中..."}
              {phase === "done" && "作成完了！"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "6px", fontSize: "16px", cursor: "pointer", color: "#fff", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >✕</button>
        </div>

        {/* コンテンツ */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>

          {/* エラー */}
          {phase === "error" && (
            <div style={{ padding: "20px" }}>
              <div style={{ padding: "12px 14px", fontSize: "12px", background: "var(--color-bg-danger)", color: "var(--color-text-danger)", borderRadius: "var(--radius-md)" }}>
                {errorMsg}
              </div>
              <button
                onClick={() => { setPhase("chat"); setErrorMsg(""); }}
                style={{ marginTop: "12px", padding: "7px 16px", fontSize: "12px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}
              >チャットに戻る</button>
            </div>
          )}

          {/* 生成中 */}
          {phase === "generating" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", padding: "40px" }}>
              <div style={{ fontSize: "32px" }}>🧠</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>プロジェクト計画を生成中...</div>
            </div>
          )}

          {/* 完了 */}
          {phase === "done" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", padding: "40px" }}>
              <div style={{ fontSize: "36px" }}>🎉</div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text-primary)" }}>プロジェクトを作成しました</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                「{projectName}」と{taskRows.filter(r => r.selected).length}件のタスクを追加しました
              </div>
            </div>
          )}

          {/* チャットフェーズ */}
          {phase === "chat" && (
            <>
              <div style={{ flex: 1, overflow: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {messages.map((m, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  }}>
                    <div style={{
                      maxWidth: "80%",
                      padding: "9px 13px",
                      borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      background: m.role === "user"
                        ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                        : "var(--color-bg-secondary)",
                      color: m.role === "user" ? "#fff" : "var(--color-text-primary)",
                      fontSize: "12px", lineHeight: "1.6",
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ padding: "9px 13px", borderRadius: "14px 14px 14px 4px", background: "var(--color-bg-secondary)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                      <span style={{ animation: "none" }}>考え中...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* ターン数インジケータ */}
              {turnCount > 0 && (
                <div style={{ padding: "0 18px 4px", display: "flex", alignItems: "center", gap: "4px" }}>
                  {Array.from({ length: MAX_TURNS }).map((_, i) => (
                    <div key={i} style={{
                      flex: 1, height: "3px", borderRadius: "2px",
                      background: i < turnCount ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                      transition: "background 0.3s",
                    }} />
                  ))}
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginLeft: "6px", whiteSpace: "nowrap" }}>
                    {turnCount}/{MAX_TURNS}
                  </span>
                </div>
              )}

              {/* 入力エリア */}
              <div style={{ padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", alignItems: "flex-end" }}>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder="メッセージを入力… (Enter で送信)"
                  disabled={isThinking || turnCount >= MAX_TURNS}
                  style={{
                    flex: 1, resize: "none", minHeight: "36px", maxHeight: "80px",
                    padding: "8px 10px", fontSize: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-secondary)",
                    color: "var(--color-text-primary)",
                    outline: "none", lineHeight: "1.5",
                    fieldSizing: "content" as React.CSSProperties["fieldSizing"],
                  }}
                  rows={1}
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isThinking || turnCount >= MAX_TURNS}
                  style={{
                    padding: "8px 12px", background: "var(--color-brand)",
                    border: "none", borderRadius: "var(--radius-md)",
                    color: "#fff", fontSize: "12px", cursor: "pointer",
                    opacity: (!inputText.trim() || isThinking || turnCount >= MAX_TURNS) ? 0.4 : 1,
                    flexShrink: 0,
                  }}
                >送信</button>
              </div>
            </>
          )}

          {/* 確認フェーズ */}
          {(phase === "confirm" || phase === "saving") && (
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* PJ基本情報 */}
              <div style={{ padding: "12px 14px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)" }}>プロジェクト情報</div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>プロジェクト名</label>
                  <input
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    style={inputStyle}
                    disabled={phase === "saving"}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>目的・背景</label>
                  <textarea
                    value={projectPurpose}
                    onChange={e => setProjectPurpose(e.target.value)}
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                    disabled={phase === "saving"}
                  />
                </div>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 140px" }}>
                    <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>オーナー</label>
                    <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inputStyle} disabled={phase === "saving"}>
                      {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>カラー</label>
                    <div style={{ display: "flex", gap: "5px" }}>
                      {PROJECT_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setProjectColor(c)}
                          style={{
                            width: "20px", height: "20px", borderRadius: "50%",
                            background: c, border: projectColor === c ? "2px solid var(--color-text-primary)" : "2px solid transparent",
                            cursor: "pointer", padding: 0,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* タスク一覧 */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
                  タスク候補 （{taskRows.filter(r => r.selected).length}/{taskRows.length} 件選択中）
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {taskRows.map((r, i) => (
                    <div key={i} style={{
                      display: "flex", gap: "8px", alignItems: "flex-start",
                      padding: "9px 12px",
                      background: r.selected ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary,#f9f9f9)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "var(--radius-md)",
                      opacity: r.selected ? 1 : 0.5,
                    }}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={e => setTaskRows(prev => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                        style={{ marginTop: "3px", flexShrink: 0, cursor: "pointer" }}
                      />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px" }}>
                        <input
                          value={r.editedName}
                          onChange={e => setTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedName: e.target.value } : x))}
                          style={{ ...inputStyle }}
                          disabled={!r.selected || phase === "saving"}
                        />
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <select
                            value={r.editedAssigneeId}
                            onChange={e => setTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedAssigneeId: e.target.value } : x))}
                            style={{ ...inputStyle, flex: "1 1 110px" }}
                            disabled={!r.selected || phase === "saving"}
                          >
                            <option value="">（担当なし）</option>
                            {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                          </select>
                          <input
                            type="date"
                            value={r.editedDueDate}
                            onChange={e => setTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedDueDate: e.target.value } : x))}
                            style={{ ...inputStyle, flex: "0 0 auto" }}
                            disabled={!r.selected || phase === "saving"}
                          />
                        </div>
                        {r.note && (
                          <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{r.note}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        {phase === "chat" && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              {turnCount === 0 ? "AIからの質問に答えてください" : turnCount >= MAX_TURNS ? "情報が揃いました" : `あと${MAX_TURNS - turnCount}ターン入力できます`}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={onClose} style={{ padding: "7px 14px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", color: "var(--color-text-secondary)" }}>キャンセル</button>
              <button
                onClick={generatePlan}
                disabled={turnCount === 0 || isThinking}
                style={{
                  padding: "7px 16px", fontSize: "12px", fontWeight: "600",
                  background: turnCount === 0 || isThinking ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                  border: "none", borderRadius: "var(--radius-md)", cursor: turnCount === 0 || isThinking ? "not-allowed" : "pointer",
                  color: turnCount === 0 || isThinking ? "var(--color-text-tertiary)" : "#fff",
                }}
              >
                ✨ プランを生成する
              </button>
            </div>
          </div>
        )}

        {(phase === "confirm" || phase === "saving") && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              onClick={() => setPhase("chat")}
              disabled={phase === "saving"}
              style={{ padding: "7px 14px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", color: "var(--color-text-secondary)" }}
            >← チャットに戻る</button>
            <button
              onClick={handleSave}
              disabled={phase === "saving" || !projectName.trim() || taskRows.filter(r => r.selected).length === 0}
              style={{
                padding: "7px 18px", fontSize: "12px", fontWeight: "600",
                background: phase === "saving" ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                border: "none", borderRadius: "var(--radius-md)",
                cursor: phase === "saving" ? "not-allowed" : "pointer",
                color: phase === "saving" ? "var(--color-text-tertiary)" : "#fff",
              }}
            >
              {phase === "saving" ? "作成中..." : `🚀 プロジェクトを作成`}
            </button>
          </div>
        )}

        {phase === "done" && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 20px", fontSize: "12px", fontWeight: "600", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", color: "#fff" }}>閉じる</button>
          </div>
        )}
      </div>
    </div>
  );
}
