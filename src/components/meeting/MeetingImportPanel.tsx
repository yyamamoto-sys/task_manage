// src/components/meeting/MeetingImportPanel.tsx
//
// 【設計意図】
// 会議の文字起こし（VTT/SRT/テキスト貼り付け）を読み込み、
// AIがタスク提案・ステータス更新候補・決定事項・リスクを抽出する。
// ユーザーが各提案をレビュー・編集してから一括登録する。
// ラボ機能例外ルール適用：PJ・タスク・メンバー情報をAIに渡す。

import { useState, useRef, useMemo, useCallback } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member, Task } from "../../lib/localData/types";
import {
  parseTranscript,
  extractMeetingData,
  type MeetingAnalysis,
  type MeetingTask,
  type MeetingStatusUpdate,
} from "../../lib/ai/meetingExtractor";

// ===== 定数 =====

const MAX_TRANSCRIPT_CHARS = 20000;

const PRIORITY_OPTIONS: { value: "high" | "mid" | "low"; label: string; color: string }[] = [
  { value: "high", label: "高", color: "#dc2626" },
  { value: "mid",  label: "中", color: "#ca8a04" },
  { value: "low",  label: "低", color: "#2563eb" },
];

// ===== タスクドラフト型 =====

interface TaskDraft {
  tempId: string;
  checked: boolean;
  name: string;
  assignee_member_id: string;
  due_date: string;
  project_id: string;
  priority: "high" | "mid" | "low" | null;
  source_quote: string;
}

interface StatusDraft {
  tempId: string;
  checked: boolean;
  task_id: string;          // 紐づける既存タスクのID
  task_name_hint: string;
  new_status: "todo" | "in_progress" | "done";
  reason: string;
  source_quote: string;
}

// ===== Props =====

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
}

type Step = "input" | "analyzing" | "review" | "applying" | "done";

// ===== メインコンポーネント =====

export function MeetingImportPanel({ onClose, currentUser, inline = false }: Props) {
  const {
    projects: allProjects,
    tasks: allTasks,
    members: allMembers,
    saveTask,
  } = useAppData();

  const projects = useMemo(
    () => allProjects.filter(p => !p.is_deleted && p.status === "active"),
    [allProjects],
  );
  const tasks = useMemo(
    () => allTasks.filter(t => !t.is_deleted),
    [allTasks],
  );
  const members = useMemo(
    () => allMembers.filter(m => !m.is_deleted),
    [allMembers],
  );

  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>([]);
  const [statusDrafts, setStatusDrafts] = useState<StatusDraft[]>([]);
  const [applyResults, setApplyResults] = useState<{ created: number; updated: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const dropAreaRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const [isDragging, setIsDragging] = useState(false);

  // ===== ファイル読み込み =====

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) ?? "";
      setRawText(text.slice(0, MAX_TRANSCRIPT_CHARS + 500));
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ===== AI 解析 =====

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim();
    if (!text) return;
    setError(null);
    setStep("analyzing");

    try {
      const cleaned = parseTranscript(text);
      const today = new Date().toISOString().slice(0, 10);

      const result = await extractMeetingData({
        transcript: cleaned.length > MAX_TRANSCRIPT_CHARS
          ? cleaned.slice(0, MAX_TRANSCRIPT_CHARS)
          : cleaned,
        projects: projects.map(p => ({ id: p.id, name: p.name })),
        tasks: tasks.map(t => ({
          id: t.id,
          name: t.name,
          assignee: members.find(m => m.id === t.assignee_member_id)?.short_name ?? "",
          status: t.status,
          due_date: t.due_date,
        })),
        members: members.map(m => ({ short_name: m.short_name })),
        today,
      });

      setAnalysis(result);

      // タスクドラフトを初期化
      setTaskDrafts(
        (result.new_tasks ?? []).map((t: MeetingTask, i) => ({
          tempId: `task-${i}`,
          checked: true,
          name: t.name,
          assignee_member_id:
            members.find(m =>
              m.short_name === t.assignee_short_name ||
              m.display_name.includes(t.assignee_short_name ?? "")
            )?.id ?? (members[0]?.id ?? ""),
          due_date: t.due_date ?? "",
          project_id:
            projects.find(p =>
              t.project_hint && p.name.includes(t.project_hint)
            )?.id ?? "",
          priority: t.priority,
          source_quote: t.source_quote,
        })),
      );

      // ステータスドラフトを初期化
      setStatusDrafts(
        (result.status_updates ?? []).map((u: MeetingStatusUpdate, i) => ({
          tempId: `status-${i}`,
          checked: !!u.suggested_task_id,
          task_id: u.suggested_task_id ?? "",
          task_name_hint: u.task_name_hint,
          new_status: u.new_status,
          reason: u.reason,
          source_quote: u.source_quote,
        })),
      );

      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI解析中にエラーが発生しました。");
      setStep("input");
    }
  }, [rawText, projects, tasks, members]);

  // ===== 適用 =====

  const handleApply = useCallback(async () => {
    setStep("applying");
    setError(null);
    let created = 0;
    let updated = 0;

    try {
      // 新規タスク作成
      for (const draft of taskDrafts.filter(d => d.checked && d.name.trim())) {
        const now = new Date().toISOString();
        const newTask: Task = {
          id: crypto.randomUUID(),
          name: draft.name.trim(),
          project_id: draft.project_id || null,
          todo_ids: [],
          assignee_member_id: draft.assignee_member_id || currentUser.id,
          assignee_member_ids: [draft.assignee_member_id || currentUser.id],
          status: "todo",
          priority: draft.priority,
          start_date: null,
          due_date: draft.due_date || null,
          estimated_hours: null,
          comment: draft.source_quote ? `会議メモ：「${draft.source_quote}」` : "",
          is_deleted: false,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        };
        await saveTask(newTask);
        created++;
      }

      // ステータス更新
      for (const draft of statusDrafts.filter(d => d.checked && d.task_id)) {
        const existing = tasks.find(t => t.id === draft.task_id);
        if (!existing) continue;
        await saveTask({
          ...existing,
          status: draft.new_status,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.id,
        });
        updated++;
      }

      setApplyResults({ created, updated });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録中にエラーが発生しました。");
      setStep("review");
    }
  }, [taskDrafts, statusDrafts, tasks, currentUser, saveTask]);

  const handleReset = () => {
    setStep("input");
    setRawText("");
    setError(null);
    setAnalysis(null);
    setTaskDrafts([]);
    setStatusDrafts([]);
    setApplyResults(null);
  };

  const checkedTaskCount = taskDrafts.filter(d => d.checked && d.name.trim()).length;
  const checkedStatusCount = statusDrafts.filter(d => d.checked && d.task_id).length;

  // ===== コンテンツ =====

  const contentArea = (
    <>
      {/* インライン時: ステップ状態バー */}
      {inline && step === "review" && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>
            {step === "review" ? "内容を確認して登録してください" : ""}
          </span>
          <button onClick={handleReset} style={{ fontSize: "11px", padding: "3px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            やり直す
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: inline ? "14px" : "20px" }}>
        {step === "input" && (
          <InputStep
            rawText={rawText}
            setRawText={setRawText}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            dropAreaRef={dropAreaRef}
            fileInputRef={fileInputRef}
            onDrop={handleDrop}
            onFileChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            error={error}
            onAnalyze={handleAnalyze}
          />
        )}
        {step === "analyzing" && (
          <CenterMessage icon="⏳" text="AIが会議内容を解析しています..." />
        )}
        {step === "review" && analysis && (
          <ReviewStep
            analysis={analysis}
            taskDrafts={taskDrafts}
            setTaskDrafts={setTaskDrafts}
            statusDrafts={statusDrafts}
            setStatusDrafts={setStatusDrafts}
            members={members}
            projects={projects}
            tasks={tasks}
            error={error}
            checkedTaskCount={checkedTaskCount}
            checkedStatusCount={checkedStatusCount}
            onApply={handleApply}
          />
        )}
        {step === "applying" && (
          <CenterMessage icon="💾" text="タスクを登録しています..." />
        )}
        {step === "done" && applyResults && (
          <DoneStep
            created={applyResults.created}
            updated={applyResults.updated}
            onReset={handleReset}
            onClose={onClose}
          />
        )}
      </div>
    </>
  );

  // ===== インラインモード =====

  if (inline) {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {contentArea}
      </div>
    );
  }

  // ===== フローティングモード =====

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(760px, 100vw)",
          height: "100%",
          background: "var(--color-bg-primary)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="ai-shimmer" style={{
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "20px" }}>🎙️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>会議から読み込む</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
              {step === "analyzing" ? "AI解析中..." : "文字起こし（VTT/テキスト）→ AI解析 → タスク登録"}
            </div>
          </div>
          {step === "review" && (
            <button onClick={handleReset} style={{ fontSize: "12px", padding: "5px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer" }}>やり直す</button>
          )}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: "18px", color: "#fff", padding: "4px 8px", lineHeight: 1, borderRadius: "var(--radius-sm)" }}>✕</button>
        </div>
        {contentArea}
      </div>
    </div>
  );
}

// ===== InputStep =====

function InputStep({
  rawText, setRawText,
  isDragging, setIsDragging,
  dropAreaRef, fileInputRef,
  onDrop, onFileChange,
  error, onAnalyze,
}: {
  rawText: string; setRawText: (v: string) => void;
  isDragging: boolean; setIsDragging: (v: boolean) => void;
  dropAreaRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  onAnalyze: () => void;
}) {
  const trimmed = rawText.trim();
  const charCount = trimmed.length;
  const overLimit = charCount > MAX_TRANSCRIPT_CHARS;
  const canAnalyze = charCount >= 20 && !overLimit;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ファイル読み込みエリア */}
      <div
        ref={dropAreaRef}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${isDragging ? "var(--color-brand)" : "var(--color-border-primary)"}`,
          borderRadius: "var(--radius-lg)",
          padding: "20px",
          textAlign: "center",
          background: isDragging ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
          transition: "all 0.15s",
          cursor: "pointer",
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>📄</div>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "4px" }}>
          ファイルをドラッグ＆ドロップ
        </div>
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          または <span style={{ color: "var(--color-brand)", textDecoration: "underline" }}>クリックして選択</span>（.vtt / .srt / .txt）
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vtt,.srt,.txt,.text"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
      </div>

      {/* テキスト入力 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <FieldLabel>
            または直接貼り付け
            <span style={{ fontSize: "10px", fontWeight: "400", color: "var(--color-text-tertiary)", marginLeft: "8px" }}>
              Teams・Zoom・Googleミートの文字起こし、議事メモ何でも可
            </span>
          </FieldLabel>
          <span style={{
            fontSize: "10px",
            color: overLimit ? "var(--color-text-danger)" : "var(--color-text-tertiary)",
          }}>
            {charCount.toLocaleString()} / {MAX_TRANSCRIPT_CHARS.toLocaleString()} 文字
          </span>
        </div>
        <textarea
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder={"WEBVTT\n\n00:01:23.000 --> 00:01:28.000\n<v 田中>今週のAPIの実装が完了しました。\n\n...\n\nまたは普通のテキストをそのまま貼り付けてください。"}
          rows={14}
          style={{
            width: "100%", padding: "10px 12px", fontSize: "12px",
            fontFamily: "monospace",
            border: `1px solid ${overLimit ? "var(--color-text-danger)" : "var(--color-border-primary)"}`,
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
          }}
        />
        {overLimit && (
          <div style={{ fontSize: "11px", color: "var(--color-text-danger)", marginTop: "4px" }}>
            {MAX_TRANSCRIPT_CHARS.toLocaleString()}文字を超えています。テキストを短くしてから解析してください。
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      <button
        onClick={onAnalyze}
        disabled={!canAnalyze}
        style={primaryButtonStyle(!canAnalyze)}
      >
        🤖 AIで会議内容を解析する
      </button>
    </div>
  );
}

// ===== ReviewStep =====

function ReviewStep({
  analysis, taskDrafts, setTaskDrafts, statusDrafts, setStatusDrafts,
  members, projects, tasks,
  error, checkedTaskCount, checkedStatusCount, onApply,
}: {
  analysis: MeetingAnalysis;
  taskDrafts: TaskDraft[]; setTaskDrafts: (d: TaskDraft[]) => void;
  statusDrafts: StatusDraft[]; setStatusDrafts: (d: StatusDraft[]) => void;
  members: Member[];
  projects: { id: string; name: string }[];
  tasks: Task[];
  error: string | null;
  checkedTaskCount: number;
  checkedStatusCount: number;
  onApply: () => void;
}) {
  const updateTask = (tempId: string, patch: Partial<TaskDraft>) =>
    setTaskDrafts(taskDrafts.map(d => d.tempId === tempId ? { ...d, ...patch } : d));
  const updateStatus = (tempId: string, patch: Partial<StatusDraft>) =>
    setStatusDrafts(statusDrafts.map(d => d.tempId === tempId ? { ...d, ...patch } : d));

  const hasAnything = checkedTaskCount > 0 || checkedStatusCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* 会議サマリー */}
      <Card>
        <SectionHeader icon="📝" title="会議サマリー" />
        <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          {analysis.summary}
        </div>
      </Card>

      {/* 新規タスク候補 */}
      {taskDrafts.length > 0 && (
        <div>
          <SectionHeader icon="➕" title={`新規タスク候補（${taskDrafts.length}件）`} />
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
            チェックした項目が登録されます。内容は編集できます。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {taskDrafts.map(draft => (
              <TaskDraftCard
                key={draft.tempId}
                draft={draft}
                members={members}
                projects={projects}
                onChange={patch => updateTask(draft.tempId, patch)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ステータス更新候補 */}
      {statusDrafts.length > 0 && (
        <div>
          <SectionHeader icon="🔄" title={`ステータス更新候補（${statusDrafts.length}件）`} />
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
            「対象タスク」を正しいタスクに選択してチェックをつけてください。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {statusDrafts.map(draft => (
              <StatusDraftCard
                key={draft.tempId}
                draft={draft}
                tasks={tasks}
                onChange={patch => updateStatus(draft.tempId, patch)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 決定事項 */}
      {analysis.decisions.length > 0 && (
        <Card>
          <SectionHeader icon="✅" title="決定事項" />
          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {analysis.decisions.map((d, i) => (
              <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{d}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* リスク */}
      {analysis.risks.length > 0 && (
        <Card>
          <SectionHeader icon="⚠️" title="リスク・懸念" />
          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {analysis.risks.map((r, i) => (
              <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{r}</li>
            ))}
          </ul>
        </Card>
      )}

      {taskDrafts.length === 0 && statusDrafts.length === 0 && (
        <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>
          タスクや更新候補は見つかりませんでした
        </div>
      )}

      {error && <ErrorBox message={error} />}

      <button
        onClick={onApply}
        disabled={!hasAnything}
        style={primaryButtonStyle(!hasAnything)}
      >
        {hasAnything
          ? `登録する（タスク ${checkedTaskCount}件・更新 ${checkedStatusCount}件）`
          : "登録する項目がありません"}
      </button>
    </div>
  );
}

// ===== TaskDraftCard =====

function TaskDraftCard({
  draft, members, projects, onChange,
}: {
  draft: TaskDraft;
  members: Member[];
  projects: { id: string; name: string }[];
  onChange: (patch: Partial<TaskDraft>) => void;
}) {
  return (
    <div style={{
      border: `1.5px solid ${draft.checked ? "var(--color-brand)" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      background: draft.checked ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
      transition: "all 0.15s",
    }}>
      {/* チェックボックス行 */}
      <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={e => onChange({ checked: e.target.checked })}
          style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-brand)" }}
        />
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          {draft.name || "（名称未設定）"}
        </span>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* タスク名 */}
          <div>
            <FieldLabel>タスク名</FieldLabel>
            <input
              type="text"
              value={draft.name}
              onChange={e => onChange({ name: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {/* 担当者 */}
            <div style={{ flex: "1 1 120px" }}>
              <FieldLabel>担当者</FieldLabel>
              <select
                value={draft.assignee_member_id}
                onChange={e => onChange({ assignee_member_id: e.target.value })}
                style={inputStyle}
              >
                <option value="">（未設定）</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.short_name}</option>
                ))}
              </select>
            </div>

            {/* 期日 */}
            <div style={{ flex: "1 1 130px" }}>
              <FieldLabel>期日</FieldLabel>
              <input
                type="date"
                value={draft.due_date}
                onChange={e => onChange({ due_date: e.target.value })}
                style={inputStyle}
              />
            </div>

            {/* 優先度 */}
            <div style={{ flex: "1 1 120px" }}>
              <FieldLabel>優先度</FieldLabel>
              <select
                value={draft.priority ?? ""}
                onChange={e => onChange({ priority: (e.target.value as TaskDraft["priority"]) || null })}
                style={inputStyle}
              >
                <option value="">（未設定）</option>
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* プロジェクト */}
          <div>
            <FieldLabel>プロジェクト</FieldLabel>
            <select
              value={draft.project_id}
              onChange={e => onChange({ project_id: e.target.value })}
              style={inputStyle}
            >
              <option value="">（未設定）</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* 根拠引用 */}
          {draft.source_quote && (
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-tertiary)",
              borderLeft: "3px solid var(--color-border-primary)",
              padding: "6px 10px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
            }}>
              「{draft.source_quote}」
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== StatusDraftCard =====

const STATUS_OPTIONS: { value: "todo" | "in_progress" | "done"; label: string; color: string }[] = [
  { value: "todo",        label: "未着手",  color: "#64748b" },
  { value: "in_progress", label: "進行中",  color: "#2563eb" },
  { value: "done",        label: "完了",    color: "#16a34a" },
];

function StatusDraftCard({
  draft, tasks, onChange,
}: {
  draft: StatusDraft;
  tasks: Task[];
  onChange: (patch: Partial<StatusDraft>) => void;
}) {
  const activeTasks = tasks.filter(t => t.status !== "done");

  return (
    <div style={{
      border: `1.5px solid ${draft.checked ? "#2563eb" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      background: draft.checked ? "#eff6ff" : "var(--color-bg-secondary)",
      transition: "all 0.15s",
    }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={e => onChange({ checked: e.target.checked })}
          style={{ width: "16px", height: "16px", marginTop: "2px", cursor: "pointer", accentColor: "#2563eb" }}
        />
        <div>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            「{draft.task_name_hint}」→ {STATUS_OPTIONS.find(o => o.value === draft.new_status)?.label}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            {draft.reason}
          </div>
        </div>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* 対象タスク選択 */}
          <div>
            <FieldLabel>対象タスク（既存から選択）</FieldLabel>
            <select
              value={draft.task_id}
              onChange={e => onChange({ task_id: e.target.value })}
              style={inputStyle}
            >
              <option value="">（選択してください）</option>
              {activeTasks.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* 新ステータス */}
          <div>
            <FieldLabel>新しいステータス</FieldLabel>
            <div style={{ display: "flex", gap: "8px" }}>
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ new_status: opt.value })}
                  style={{
                    flex: 1, padding: "6px 8px", fontSize: "11px", fontWeight: "600",
                    border: `1.5px solid ${draft.new_status === opt.value ? opt.color : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-md)",
                    background: draft.new_status === opt.value ? `${opt.color}18` : "var(--color-bg-primary)",
                    color: draft.new_status === opt.value ? opt.color : "var(--color-text-tertiary)",
                    cursor: "pointer",
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          {/* 根拠引用 */}
          {draft.source_quote && (
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-tertiary)",
              borderLeft: "3px solid var(--color-border-primary)",
              padding: "6px 10px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
            }}>
              「{draft.source_quote}」
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== DoneStep =====

function DoneStep({ created, updated, onReset, onClose }: {
  created: number; updated: number;
  onReset: () => void; onClose: () => void;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "16px", padding: "40px 20px", textAlign: "center",
    }}>
      <div style={{ fontSize: "48px" }}>🎉</div>
      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>
        登録が完了しました
      </div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
        {created > 0 && <div>タスク {created}件 を新規作成しました</div>}
        {updated > 0 && <div>タスク {updated}件 のステータスを更新しました</div>}
        {created === 0 && updated === 0 && <div>変更はありませんでした</div>}
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
        <button onClick={onReset} style={ghostButtonStyle}>
          別の会議を読み込む
        </button>
        <button onClick={onClose} style={primaryButtonStyle(false)}>
          閉じる
        </button>
      </div>
    </div>
  );
}

// ===== ユーティリティコンポーネント =====

function CenterMessage({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "16px", minHeight: "200px",
    }}>
      <div style={{ fontSize: "36px" }}>{icon}</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{text}</div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "16px" }}>{icon}</span>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)" }}>{title}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      padding: "16px 18px",
    }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-secondary)", marginBottom: "5px" }}>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      fontSize: "12px", color: "var(--color-text-danger)",
      background: "var(--color-bg-danger)",
      padding: "8px 12px", borderRadius: "var(--radius-md)",
    }}>
      {message}
    </div>
  );
}

// ===== スタイル定数 =====

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "11px 24px",
  background: disabled
    ? "var(--color-bg-tertiary)"
    : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  border: "none",
  borderRadius: "var(--radius-md)",
  color: disabled ? "var(--color-text-tertiary)" : "#fff",
  fontSize: "13px", fontWeight: "600",
  cursor: disabled ? "not-allowed" : "pointer",
  boxShadow: disabled ? "none" : "0 2px 8px rgba(124,58,237,0.35)",
  width: "100%",
});

const ghostButtonStyle: React.CSSProperties = {
  padding: "9px 16px", fontSize: "12px",
  background: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
