// src/components/admin/TodoDecomposeModal.tsx
//
// 【設計意図】
// ToDoを選択してAIタスク自動分解を起動し、結果を確認・編集して一括保存するモーダル。
// AdminView の ToDoPanel から呼び出される。

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppData } from "../../context/AppDataContext";
import type { ToDo, Member } from "../../lib/localData/types";
import { callTodoDecomposeAI, type DecomposedTask } from "../../lib/ai/todoDecomposeClient";

interface Props {
  todo: ToDo;
  tfId: string;
  currentUser: Member;
  saveTask: (task: import("../../lib/localData/types").Task) => Promise<void>;
  onClose: () => void;
}

export function TodoDecomposeModal({ todo, tfId, currentUser, saveTask, onClose }: Props) {
  const { keyResults, taskForces, members: allMembers } = useAppData();
  const members = (allMembers ?? []).filter(m => !m.is_deleted);

  const tf = (taskForces ?? []).find(t => t.id === tfId);
  const kr = tf ? (keyResults ?? []).find(k => k.id === tf.kr_id) : null;
  const today = new Date().toISOString().slice(0, 10);

  const [phase, setPhase] = useState<"loading" | "confirm" | "saving" | "done" | "error">("loading");
  const [suggestions, setSuggestions] = useState<(DecomposedTask & { selected: boolean; editedName: string; editedAssigneeId: string; editedDueDate: string })[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const results = await callTodoDecomposeAI({
          todoTitle: todo.title,
          tfName: tf?.name ?? "",
          krTitle: kr?.title ?? "",
          memberShortNames: members.map(m => m.short_name),
          today,
        });
        setSuggestions(results.map(r => {
          const matchedMember = members.find(m => m.short_name === r.assignee_short_name);
          return {
            ...r,
            selected: true,
            editedName: r.name,
            editedAssigneeId: matchedMember?.id ?? "",
            editedDueDate: r.due_date ?? "",
          };
        }));
        setPhase("confirm");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "AI分解中にエラーが発生しました。");
        setPhase("error");
      }
    })();
  }, []);

  const handleSave = async () => {
    const selected = suggestions.filter(s => s.selected && s.editedName.trim());
    if (selected.length === 0) return;
    setPhase("saving");
    const now = new Date().toISOString();
    try {
      for (const s of selected) {
        const task: import("../../lib/localData/types").Task = {
          id: uuidv4(),
          name: s.editedName.trim(),
          project_id: null,
          todo_ids: [todo.id],
          assignee_member_id: s.editedAssigneeId || "",
          assignee_member_ids: s.editedAssigneeId ? [s.editedAssigneeId] : [],
          status: "todo",
          priority: null,
          start_date: null,
          due_date: s.editedDueDate || null,
          estimated_hours: null,
          comment: s.note || "",
          is_deleted: false,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        };
        await saveTask(task);
      }
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "タスク保存中にエラーが発生しました。");
      setPhase("error");
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "4px 7px", fontSize: "12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.45)",
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
        boxShadow: "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.25))",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ fontSize: "16px" }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              AIタスク自動分解
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {todo.name ?? todo.title}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "var(--color-text-tertiary)", padding: "4px" }}>✕</button>
        </div>

        {/* コンテンツ */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 18px" }}>

          {phase === "loading" && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-tertiary)", fontSize: "13px" }}>
              <div style={{ fontSize: "24px", marginBottom: "10px" }}>⏳</div>
              AIがタスクを分解中です…
            </div>
          )}

          {phase === "error" && (
            <div style={{
              padding: "12px 14px", fontSize: "12px",
              background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
              borderRadius: "var(--radius-md)",
            }}>
              {errorMsg}
            </div>
          )}

          {phase === "done" && (
            <div style={{ textAlign: "center", padding: "32px 0", fontSize: "13px", color: "var(--color-text-success)" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px" }}>✅</div>
              {suggestions.filter(s => s.selected).length}件のタスクを追加しました
            </div>
          )}

          {(phase === "confirm" || phase === "saving") && (
            <>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
                追加するタスクにチェックを入れて、担当者・期日を確認してください。
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {suggestions.map((s, i) => (
                  <div key={i} style={{
                    display: "flex", gap: "8px", alignItems: "flex-start",
                    padding: "10px 12px",
                    background: s.selected ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary, #f9f9f9)",
                    border: `1px solid ${s.selected ? "var(--color-border-primary)" : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-md)",
                    opacity: s.selected ? 1 : 0.5,
                  }}>
                    <input
                      type="checkbox"
                      checked={s.selected}
                      onChange={e => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                      style={{ marginTop: "3px", flexShrink: 0, cursor: "pointer" }}
                    />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px" }}>
                      <input
                        value={s.editedName}
                        onChange={e => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, editedName: e.target.value } : x))}
                        style={{ ...inputStyle, width: "100%" }}
                        disabled={!s.selected || phase === "saving"}
                      />
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <select
                          value={s.editedAssigneeId}
                          onChange={e => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, editedAssigneeId: e.target.value } : x))}
                          style={{ ...inputStyle, flex: "1 1 120px" }}
                          disabled={!s.selected || phase === "saving"}
                        >
                          <option value="">（担当なし）</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                        </select>
                        <input
                          type="date"
                          value={s.editedDueDate}
                          onChange={e => setSuggestions(prev => prev.map((x, j) => j === i ? { ...x, editedDueDate: e.target.value } : x))}
                          style={{ ...inputStyle, flex: "0 0 auto" }}
                          disabled={!s.selected || phase === "saving"}
                        />
                      </div>
                      {s.note && (
                        <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{s.note}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* フッター */}
        {(phase === "confirm" || phase === "saving") && (
          <div style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--color-border-primary)",
            display: "flex", gap: "8px", justifyContent: "flex-end",
          }}>
            <button
              onClick={onClose}
              style={{
                padding: "7px 16px", fontSize: "12px",
                background: "transparent",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                color: "var(--color-text-secondary)",
              }}
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={phase === "saving" || suggestions.filter(s => s.selected).length === 0}
              style={{
                padding: "7px 16px", fontSize: "12px", fontWeight: "600",
                background: phase === "saving" ? "var(--color-bg-tertiary)" : "var(--color-brand)",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: phase === "saving" ? "not-allowed" : "pointer",
                color: phase === "saving" ? "var(--color-text-tertiary)" : "#fff",
              }}
            >
              {phase === "saving" ? "保存中…" : `${suggestions.filter(s => s.selected).length}件のタスクを追加`}
            </button>
          </div>
        )}
        {phase === "done" && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--color-border-primary)", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 20px", fontSize: "12px", fontWeight: "600", background: "var(--color-brand)", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", color: "#fff" }}>
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
