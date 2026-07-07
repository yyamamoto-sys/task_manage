// src/components/lab/KrQuarterPlanPanel.tsx
//
// 【設計意図】
// OKRモードの「計画」タブ。クォーター末にマネージャー（GM/AGM/OM）が
// 翌クォーターのTask Force計画をAIとの対話で立案する機能。
//
// フロー: セットアップ → 読み込み → AI対話 → 計画書生成 → 編集・保存
// Phase 1: localStorage保存（Supabase移行はquarterPlanStore.tsのみ差し替え）

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useAppStore, selectScopedTasks, selectScopedMembers } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { fetchKrSessions, fetchKrDeclarations } from "../../lib/supabase/krSessionStore";
import { fetchKrMeetingNotesList, fetchKrMeetingNoteById } from "../../lib/supabase/krMeetingNoteStore";
import { fetchOkrAnalyses, fetchObjectiveAnalyses } from "../../lib/supabase/okrAnalysisStore";
import {
  buildContextText,
  getQuarterValue,
  nextQuarterValue,
  previousQuarterValue,
  quarterDateRange,
  getQuarterLabel,
  type QuarterPlanContext,
  type TFStat,
  type SignalEntry,
} from "../../lib/ai/krQuarterPlanPrompt";
import { buildMessageContent } from "../../lib/ai/invokeAI";
import { calcProgressPct } from "../../lib/stats";
import { FileAttachButton, FileDropZone, type FileAttachment } from "../common/FileAttachButton";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  callQuarterPlanDialogue,
  callQuarterPlanGenerate,
  callQuarterPlanInitialAnalysis,
  type PlanMessage,
  type GeneratedPlan,
} from "../../lib/ai/krQuarterPlanClient";
import { MarkdownLite } from "../common/MarkdownLite";
import { getContentText } from "../../lib/ai/invokeAI";
import {
  loadQuarterPlan,
  saveQuarterPlan,
  deleteQuarterPlan,
  type ProposedTF,
  type QuarterPlan,
} from "../../lib/supabase/quarterPlanStore";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { showToast } from "../common/Toast";
import { useTypingEffect } from "../../hooks/useTypingEffect";
import { CustomSelect } from "../common/CustomSelect";

// ===== 型 =====

type PlanPhase = "setup" | "loading" | "thinking" | "dialogue" | "generating" | "plan";

const ACTION_STYLE: Record<ProposedTF["action"], { label: string; bg: string; color: string }> = {
  継続: { label: "継続", bg: "#d1fae5", color: "#065f46" },
  変更: { label: "変更", bg: "#fef3c7", color: "#92400e" },
  廃止: { label: "廃止", bg: "#fee2e2", color: "#991b1b" },
  新設: { label: "新設", bg: "#ede9fe", color: "#5b21b6" },
};

const SIGNAL_DOT: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

const GENERATE_PHASES = [
  "対話内容を整理しています...",
  "TF継続・変更・廃止を判定しています...",
  "翌クォーター計画を構成しています...",
  "計画書を整形しています...",
];

// ===== サブコンポーネント =====

function ThinkingDots() {
  return (
    <span className="ai-thinking-dots" style={{ fontSize: "13px" }}>
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

function TypingMessage({ text, isLatest }: { text: string; isLatest: boolean }) {
  const { displayed } = useTypingEffect(isLatest ? text : "", 14);
  return <span className={isLatest ? "typing-cursor" : ""}>{isLatest ? displayed : text}</span>;
}

// TFカード（表示・インライン編集）
function TFPlanCard({
  tf, members, onChange, onRemove,
}: {
  tf: ProposedTF;
  members: string[];
  onChange: (updated: ProposedTF) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProposedTF>(tf);
  const style = ACTION_STYLE[tf.action];

  const handleSave = () => {
    onChange(draft);
    setEditing(false);
  };
  const handleCancel = () => {
    setDraft(tf);
    setEditing(false);
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%", padding: "5px 8px", fontSize: "12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "10px", fontWeight: "600",
    color: "var(--color-text-tertiary)",
    letterSpacing: "0.04em", textTransform: "uppercase",
    marginBottom: "3px", display: "block",
  };

  return (
    <div style={{
      background: tf.action === "廃止" ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)",
      border: `1px solid var(--color-border-primary)`,
      borderLeft: `3px solid ${style.color}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      opacity: tf.action === "廃止" ? 0.65 : 1,
    }}>
      {/* ヘッダー行 */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{
          fontSize: "10px", fontWeight: "700",
          padding: "2px 8px", borderRadius: "var(--radius-full)",
          background: style.bg, color: style.color,
        }}>{style.label}</span>
        {editing ? (
          <>
            <input
              value={`TF${draft.tf_number}`}
              readOnly
              style={{ ...fieldStyle, width: "50px", flexShrink: 0 }}
            />
            <input
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              style={{ ...fieldStyle, flex: 1, fontWeight: "600" }}
              placeholder="TF名"
            />
          </>
        ) : (
          <span style={{ flex: 1, fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            TF{tf.tf_number} {tf.name}
          </span>
        )}
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            style={{
              fontSize: "10px", padding: "3px 8px",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-tertiary)", cursor: "pointer",
            }}
          >編集</button>
        ) : (
          <div style={{ display: "flex", gap: "4px" }}>
            <button onClick={handleSave} style={{ fontSize: "10px", padding: "3px 8px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>保存</button>
            <button onClick={handleCancel} style={{ fontSize: "10px", padding: "3px 8px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-tertiary)", cursor: "pointer" }}>キャンセル</button>
          </div>
        )}
        <button
          onClick={onRemove}
          title="このTFを削除"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "16px", lineHeight: 1, padding: "2px" }}
        >✕</button>
      </div>

      {tf.action === "廃止" && !editing ? (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          {tf.rationale}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* 目的 */}
          <div>
            <span style={labelStyle}>目的</span>
            {editing ? (
              <input value={draft.objective} onChange={e => setDraft(d => ({ ...d, objective: e.target.value }))} style={fieldStyle} />
            ) : (
              <div style={{ fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.5 }}>{tf.objective}</div>
            )}
          </div>

          {/* 根拠 */}
          <div>
            <span style={labelStyle}>根拠</span>
            {editing ? (
              <input value={draft.rationale} onChange={e => setDraft(d => ({ ...d, rationale: e.target.value }))} style={fieldStyle} />
            ) : (
              <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.5, fontStyle: "italic" }}>{tf.rationale}</div>
            )}
          </div>

          {/* 主要ToDo */}
          <div>
            <span style={labelStyle}>主要ToDo</span>
            {editing ? (
              <textarea
                value={draft.key_todos.join("\n")}
                onChange={e => setDraft(d => ({ ...d, key_todos: e.target.value.split("\n").filter(Boolean) }))}
                rows={3}
                style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.6 }}
                placeholder="1行に1つ入力"
              />
            ) : (
              <ul style={{ margin: 0, paddingLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
                {tf.key_todos.map((todo, i) => (
                  <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{todo}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 完了の定義・推奨リーダー・リスク */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <span style={labelStyle}>完了の定義</span>
              {editing ? (
                <input value={draft.success_criteria} onChange={e => setDraft(d => ({ ...d, success_criteria: e.target.value }))} style={fieldStyle} />
              ) : (
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>{tf.success_criteria}</div>
              )}
            </div>
            <div>
              <span style={labelStyle}>推奨リーダー</span>
              {editing ? (
                <CustomSelect
                  value={draft.leader_suggestion ?? ""}
                  onChange={value => setDraft(d => ({ ...d, leader_suggestion: value || null }))}
                  options={[
                    { value: "", label: "未定" },
                    ...members.map(m => ({ value: m, label: m })),
                  ]}
                  searchable searchPlaceholder="メンバーで検索..."
                />
              ) : (
                <div style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: "600" }}>
                  {tf.leader_suggestion ?? "未定"}
                </div>
              )}
            </div>
          </div>

          {/* リスク */}
          {(tf.risk || editing) && (
            <div>
              <span style={labelStyle}>リスク</span>
              {editing ? (
                <input
                  value={draft.risk ?? ""}
                  onChange={e => setDraft(d => ({ ...d, risk: e.target.value || null }))}
                  style={fieldStyle}
                  placeholder="（なければ空欄）"
                />
              ) : tf.risk ? (
                <div style={{ fontSize: "11px", color: "#b45309", lineHeight: 1.4 }}>⚠ {tf.risk}</div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== メインコンポーネント =====

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
  initialKrId?: string;
}

export function KrQuarterPlanPanel({ onClose, currentUser: _currentUser, inline = false, initialKrId }: Props) {
  const keyResults = useAppStore(s => s.keyResults);
  const taskForces = useAppStore(s => s.taskForces);
  const todos      = useAppStore(s => s.todos);
  const tasks      = useAppStore(selectScopedTasks);
  const members    = useAppStore(selectScopedMembers);
  const objective  = useAppStore(s => s.objective);

  const activeKrs = useMemo(
    () => active(keyResults),
    [keyResults],
  );
  const activeMembers = useMemo(
    () => active(members),
    [members],
  );

  // ─── セットアップ状態 ───
  const [selectedKrId, setSelectedKrId] = useState(initialKrId ?? activeKrs[0]?.id ?? "");
  const [targetYear, setTargetYear] = useState<number>(() => {
    const next = nextQuarterValue(getQuarterValue());
    return parseInt(next.split("-")[0]);
  });
  const [targetQ, setTargetQ] = useState<number>(() => {
    const next = nextQuarterValue(getQuarterValue());
    return parseInt(next.split("-")[1]);
  });
  const targetQuarter = `${targetYear}-${targetQ}Q`;
  const [issueFocus, setIssueFocus] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);

  // ─── フロー制御 ───
  const [phase, setPhase] = useState<PlanPhase>("setup");
  const [error, setError] = useState<string | null>(null);

  // ─── 対話状態 ───
  const [messages, setMessages] = useState<PlanMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [typingIndex, setTypingIndex] = useState(-1);
  const [turnCount, setTurnCount] = useState(0);

  // ─── コンテキストサマリー ───
  const [contextSummary, setContextSummary] = useState<{
    tfStats: TFStat[];
    signalHistory: SignalEntry[];
    winLearnings: string;
    checkinHighlights: string;
  } | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);

  // ─── 計画書状態 ───
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);
  const [planTfs, setPlanTfs] = useState<ProposedTF[]>([]);
  const [planSummary, setPlanSummary] = useState("");
  const [planRisk, setPlanRisk] = useState<string | null>(null);
  const [savedPlan, setSavedPlan] = useState<QuarterPlan | null>(null);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;
  const memberNames = useMemo(() => activeMembers.map(m => m.short_name), [activeMembers]);
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    const count = 2050 - (y - 1) + 1;
    return Array.from({ length: count }, (_, i) => y - 1 + i);
  }, []);

  // KR・クォーター変更時に保存済み計画を確認
  useEffect(() => {
    if (!selectedKrId || !targetQuarter) return;
    setSavedPlan(loadQuarterPlan(selectedKrId, targetQuarter));
  }, [selectedKrId, targetQuarter]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (phase === "dialogue") inputRef.current?.focus();
  }, [phase, messages.length]);

  // ─── コンテキスト構築 ───
  const buildContext = useCallback(async (): Promise<{ ctx: QuarterPlanContext; text: string }> => {
    // 前クォーターの日付範囲を計算（前クォーターの記録を総動員する）
    const prevQ = previousQuarterValue(targetQuarter);
    const prevRange = quarterDateRange(prevQ);

    const sessions = await fetchKrSessions(selectedKrId);

    // TF統計（対象KRのTF → ToDo → Task）
    const krTfs = (taskForces ?? []).filter(tf => tf.kr_id === selectedKrId && !tf.is_deleted);
    const tfStats: TFStat[] = krTfs.map(tf => {
      const tfTodos = (todos ?? []).filter(t => !t.is_deleted && t.tf_id === tf.id);
      const todoIds = new Set(tfTodos.map(t => t.id));
      const tfTasks = (tasks ?? []).filter(
        t => !t.is_deleted && (t.todo_ids ?? []).some(id => todoIds.has(id)),
      );
      const done = tfTasks.filter(t => t.status === "done").length;
      const inProg = tfTasks.filter(t => t.status === "in_progress").length;
      const total = tfTasks.length;
      return {
        tf_number: tf.tf_number ?? "?",
        name: tf.name,
        total_tasks: total,
        done_tasks: done,
        in_progress_tasks: inProg,
        todo_tasks: total - done - inProg,
        completion_pct: calcProgressPct(done, total),
      };
    });

    // シグナル履歴（直近20件）。freeform は signal を持たないが、議論サマリ・決定事項は
    // クォーター計画 AI の素材になるので含める。
    const signalHistory: SignalEntry[] = sessions
      .slice(0, 20)
      .map(s => ({
        week_start: s.week_start,
        session_type: s.session_type,
        signal: s.signal,
        signal_comment: s.signal_comment ?? "",
        summary: s.summary ?? "",
        decisions: s.decisions ?? "",
      }));

    // ウィンセッション学び
    const winSessions = sessions.filter(s => s.session_type === "win_session");
    const winLearnings = winSessions
      .map(s => [s.learnings, s.external_changes].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n---\n");

    // チェックインハイライト
    const checkinSessions = sessions.filter(s => s.session_type === "checkin");
    const checkinHighlights = checkinSessions
      .map(s => s.signal_comment)
      .filter(Boolean)
      .join("\n");

    setContextSummary({ tfStats, signalHistory, winLearnings, checkinHighlights });

    // ===== 前クォーターの「総動員」データ =====

    // 1) 前Qの会議ノート（各TFのテーマ・必達定義・①〜④・TODO）をマークダウン化
    let prevNotesText = "";
    try {
      const noteList = await fetchKrMeetingNotesList(selectedKrId);
      const prevNotes = noteList.filter(n => n.week_start >= prevRange.start && n.week_start <= prevRange.end);
      const fulls = await Promise.all(prevNotes.map(n => fetchKrMeetingNoteById(n.id).catch(() => null)));
      const L: string[] = [];
      for (const full of fulls) {
        if (!full) continue;
        L.push(`### ${full.week_start} 週のノート`);
        if (full.carry_memo) L.push(`（前回からの引き継ぎメモ）${full.carry_memo.replace(/\s+/g, " ").slice(0, 400)}`);
        for (const e of full.entries) {
          const tfMaster = (taskForces ?? []).find(t => t.id === e.tf_id);
          const tfLabel = tfMaster ? `TF${tfMaster.tf_number} ${tfMaster.name}` : `TF(${e.tf_id.slice(0, 6)})`;
          L.push(`- ${tfLabel}`);
          if (e.tf_theme) L.push(`  テーマ：${e.tf_theme.replace(/\s+/g, " ").slice(0, 200)}`);
          if (e.target_definition) L.push(`  必達定義：${e.target_definition.replace(/\s+/g, " ").slice(0, 300)}`);
          if (e.hypotheses) L.push(`  ①先週動かした仮説：${e.hypotheses.replace(/\s+/g, " ").slice(0, 300)}`);
          if (e.facts) L.push(`  ②起きたこと：${e.facts.replace(/\s+/g, " ").slice(0, 400)}`);
          if (e.next_actions) L.push(`  ③次の一手：${e.next_actions.replace(/\s+/g, " ").slice(0, 300)}`);
          L.push(`  ④現在の状態：${e.progress_pct != null ? e.progress_pct + "%" : "（%未記入）"}${e.progress_reason ? " — " + e.progress_reason.replace(/\s+/g, " ").slice(0, 200) : ""}`);
          if (e.todo) L.push(`  TODO：${e.todo.replace(/\s+/g, " ").slice(0, 250)}`);
        }
      }
      prevNotesText = L.join("\n");
    } catch (e) { console.warn("前Qノート取得失敗:", e); }

    // 2) 前Qのセッション（チェックイン）の宣言と結果
    let prevDeclarationsText = "";
    try {
      const prevSessions = sessions.filter(s => s.week_start >= prevRange.start && s.week_start <= prevRange.end);
      const checkinPrev = prevSessions.filter(s => s.session_type === "checkin");
      const L: string[] = [];
      for (const s of checkinPrev) {
        const decls = await fetchKrDeclarations(s.id).catch(() => []);
        if (decls.length === 0) continue;
        L.push(`### ${s.week_start} 週のチェックイン宣言`);
        for (const d of decls) {
          const who = activeMembers.find(m => m.id === d.member_id)?.short_name ?? "（不明）";
          const res = d.result_status ? `→ ${d.result_status === "achieved" ? "達成" : d.result_status === "partial" ? "一部達成" : "未達"}${d.result_note ? `（${d.result_note.slice(0, 80)}）` : ""}` : "";
          L.push(`- ${who}：${d.content}${d.due_date ? `（期日 ${d.due_date}）` : ""} ${res}`);
        }
      }
      prevDeclarationsText = L.join("\n");
    } catch (e) { console.warn("前Q宣言取得失敗:", e); }

    // 3) 前QのAI分析の蓄積（KR単位＋Objective単位）
    let prevAnalysesText = "";
    try {
      const inRange = (iso: string) => { const d = iso.slice(0, 10); return d >= prevRange.start && d <= prevRange.end; };
      const krAns = await fetchOkrAnalyses(selectedKrId).then(rows => rows.filter(r => inRange(r.created_at))).catch(() => []);
      const objAns = objective ? await fetchObjectiveAnalyses(objective.id).then(rows => rows.filter(r => inRange(r.created_at))).catch(() => []) : [];
      const L: string[] = [];
      if (krAns.length > 0) {
        L.push("#### KR単位の分析（新しい順）");
        for (const a of krAns) {
          L.push(`▼ ${a.created_at.slice(0, 10)}${a.edited ? "（手修正済み）" : ""}`);
          L.push(a.content);
          L.push("");
        }
      }
      if (objAns.length > 0) {
        L.push("#### Objective単位の分析（新しい順）");
        for (const a of objAns) {
          L.push(`▼ ${a.created_at.slice(0, 10)}${a.edited ? "（手修正済み）" : ""}`);
          L.push(a.content);
          L.push("");
        }
      }
      prevAnalysesText = L.join("\n");
    } catch (e) { console.warn("前Q分析取得失敗:", e); }

    const ctx: QuarterPlanContext = {
      today: new Date().toISOString().slice(0, 10),
      current_quarter: getQuarterValue(),
      prev_quarter: prevQ,
      target_quarter: targetQuarter,
      objective_title: objective?.title ?? "（未設定）",
      objective_purpose: objective?.purpose ?? "",
      kr_title: selectedKr?.title ?? "",
      tf_stats: tfStats,
      signal_history: signalHistory,
      win_learnings: winLearnings,
      checkin_highlights: checkinHighlights,
      prev_notes_text: prevNotesText,
      prev_declarations_text: prevDeclarationsText,
      prev_analyses_text: prevAnalysesText,
      members: memberNames,
      issue_focus: issueFocus,
    };

    return { ctx, text: buildContextText(ctx) };
  }, [selectedKrId, targetQuarter, issueFocus, selectedKr, objective, taskForces, todos, tasks, memberNames, activeMembers]);

  // ─── 計画開始 ───
  const handleStart = async () => {
    if (!selectedKr) return;
    setPhase("loading");
    setError(null);
    setMessages([]);
    setTurnCount(0);
    setGeneratedPlan(null);
    setPlanTfs([]);

    try {
      const { text: contextText } = await buildContext();

      setPhase("thinking");

      const firstMsg: PlanMessage = {
        role: "user",
        content: buildMessageContent(
          `${contextText}\n\nこのデータをもとに、${targetQuarter}のTF計画立案を始めてください。`,
          attachment,
        ),
      };

      // 初回応答は専用プロンプトでしっかり分析させる。タイプ演出は長文だと遅いのでスキップする
      const aiReply = await callQuarterPlanInitialAnalysis([firstMsg]);
      const initMsgs: PlanMessage[] = [firstMsg, { role: "assistant", content: aiReply }];
      setMessages(initMsgs);
      setTypingIndex(aiReply.length > 400 ? -1 : initMsgs.length - 1);
      setTurnCount(1);
      setPhase("dialogue");
    } catch (e) {
      setError(formatErrorForUser("AIとの対話に失敗しました", e));
      setPhase("setup");
    }
  };

  // ─── 回答送信 ───
  const handleSendAnswer = async () => {
    const answer = userInput.trim();
    if (!answer || phase !== "dialogue") return;

    setUserInput("");
    const newMsgs: PlanMessage[] = [...messages, { role: "user", content: answer }];
    setMessages(newMsgs);
    setPhase("thinking");
    setError(null);

    try {
      const aiReply = await callQuarterPlanDialogue(newMsgs);
      const updated: PlanMessage[] = [...newMsgs, { role: "assistant", content: aiReply }];
      setMessages(updated);
      setTypingIndex(updated.length - 1);
      setTurnCount(c => c + 1);
      setPhase("dialogue");
    } catch (e) {
      setError(formatErrorForUser("AIとの対話に失敗しました", e));
      setPhase("dialogue");
    }
  };

  // ─── 計画書生成 ───
  const handleGeneratePlan = async () => {
    setPhase("generating");
    setError(null);

    try {
      const { text: contextText } = await buildContext();
      const plan = await callQuarterPlanGenerate(contextText, messages);
      setGeneratedPlan(plan);
      setPlanTfs(plan.tfs);
      setPlanSummary(plan.summary);
      setPlanRisk(plan.overall_risk);
      setPhase("plan");
    } catch (e) {
      setError(formatErrorForUser("計画書の生成に失敗しました", e));
      setPhase("dialogue");
    }
  };

  // ─── 保存 ───
  const handleSave = (status: "draft" | "finalized") => {
    if (!generatedPlan) return;
    const saved = saveQuarterPlan({
      kr_id: selectedKrId,
      quarter: targetQuarter,
      status,
      summary: planSummary,
      tfs: planTfs,
      overall_risk: planRisk,
    });
    setSavedPlan(saved);
    showToast(status === "finalized" ? "計画書を確定しました" : "下書きを保存しました");
  };

  // ─── ダウンロード ───
  const handleDownload = () => {
    if (!generatedPlan) return;
    const krTitle = selectedKr?.title ?? "KR";
    const lines = [
      `# ${targetQuarter} TF計画書`,
      ``,
      `**KR:** ${krTitle}`,
      `**作成日:** ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `## 方針サマリー`,
      planSummary,
      ``,
      ...(planRisk ? [`## 全体リスク`, `⚠ ${planRisk}`, ``] : []),
      `## TF計画`,
      ``,
      ...planTfs.flatMap(tf => [
        `### TF${tf.tf_number} ${tf.name}（${tf.action}）`,
        ``,
        `**目的:** ${tf.objective}`,
        `**根拠:** ${tf.rationale}`,
        `**推奨リーダー:** ${tf.leader_suggestion ?? "未定"}`,
        `**主要ToDo:**`,
        ...tf.key_todos.map(t => `- ${t}`),
        `**完了の定義:** ${tf.success_criteria}`,
        ...(tf.risk ? [`**リスク:** ${tf.risk}`] : []),
        ``,
      ]),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TF計画_${targetQuarter}_${krTitle.slice(0, 20)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("計画書をダウンロードしました");
  };

  // ─── Copilot用プロンプトコピー ───
  const handleCopyCopilotPrompt = () => {
    if (!generatedPlan) return;
    const prompt = [
      `以下はOKRクォーター計画AIが提案した${targetQuarter}のTask Force計画です。`,
      `この計画について、社内の戦略文書（SharePoint・事業計画書など）を参照しながら`,
      `評価・改善点を教えてください。`,
      ``,
      `【計画概要】`,
      planSummary,
      ``,
      `【提案TF一覧】`,
      ...planTfs.map(tf => `・TF${tf.tf_number} ${tf.name}（${tf.action}）: ${tf.objective}`),
      ...(planRisk ? [``, `【全体リスク】`, planRisk] : []),
    ].join("\n");

    navigator.clipboard.writeText(prompt).then(() =>
      showToast("Copilot用プロンプトをコピーしました"),
    );
  };

  // ─── リセット ───
  const handleReset = () => {
    setPhase("setup");
    setMessages([]);
    setUserInput("");
    setTurnCount(0);
    setError(null);
    setGeneratedPlan(null);
    setPlanTfs([]);
    setContextSummary(null);
    setAttachment(null);
  };

  const showDialogue = phase === "dialogue"
    || (phase === "thinking" && messages.length > 0)
    || phase === "plan";

  // ===== レンダリング =====

  const content = (
    // クリックしても何も起きないラッパー（inline=false時に背景クリックのバブリングを防止するだけ）
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      className={inline ? "" : "panel-slide-up"}
      style={{
      width: inline ? "100%" : "min(1040px, 100vw)",
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
        <span style={{ fontSize: "18px" }}>📅</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
            クォーター計画（マネージャー向け）
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            AI対話で翌クォーターのTask Force計画を立案します
          </div>
        </div>
        {(phase === "dialogue" || phase === "plan") && (
          <button
            onClick={handleReset}
            style={{
              fontSize: "11px", padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-text-secondary)", cursor: "pointer",
            }}
          >最初からやり直す</button>
        )}
        {!inline && (
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--color-text-tertiary)", padding: "4px", lineHeight: 1 }}>✕</button>
        )}
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* ─── セットアップ ─── */}
        {phase === "setup" && (
          <div style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-lg)",
            padding: "20px",
          }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)", marginBottom: "16px" }}>
              計画セッションを設定
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              {/* KR選択 */}
              <div style={{ flex: "2 1 200px" }}>
                <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "5px" }}>対象KR</label>
                {activeKrs.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>KRが登録されていません</div>
                ) : (
                  <CustomSelect
                    value={selectedKrId}
                    onChange={value => setSelectedKrId(value)}
                    options={activeKrs.map(kr => ({ value: kr.id, label: kr.title }))}
                    searchable searchPlaceholder="KRで検索..."
                  />
                )}
              </div>

              {/* 計画対象クォーター：年 + Q */}
              <div style={{ flex: "1 1 220px" }}>
                <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "5px" }}>
                  計画対象クォーター
                </label>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <select
                    value={targetYear}
                    onChange={e => setTargetYear(parseInt(e.target.value))}
                    style={{ flex: "1 1 80px", padding: "7px 8px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
                  </select>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[1, 2, 3, 4].map(q => (
                      <button
                        key={q}
                        onClick={() => setTargetQ(q)}
                        style={{
                          padding: "5px 10px", fontSize: "12px", fontWeight: targetQ === q ? "700" : "400",
                          border: `1.5px solid ${targetQ === q ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                          borderRadius: "var(--radius-md)",
                          background: targetQ === q ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                          color: targetQ === q ? "var(--color-brand)" : "var(--color-text-secondary)",
                          cursor: "pointer",
                        }}
                      >{q}Q</button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                  {getQuarterLabel(targetQuarter)}
                </div>
              </div>
            </div>

            {/* 注力課題 */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-primary)" }}>
                  注力したい課題・テーマ
                  <span style={{ fontSize: "10px", fontWeight: "400", color: "var(--color-text-tertiary)", marginLeft: "6px" }}>任意。AIが最初の問いかけに活かします</span>
                </label>
                <FileAttachButton
                  attachment={attachment}
                  onAttach={setAttachment}
                  onRemove={() => setAttachment(null)}
                />
              </div>
              <FileDropZone onAttach={setAttachment}>
                <textarea
                  value={issueFocus}
                  onChange={e => setIssueFocus(e.target.value)}
                  rows={3}
                  placeholder={attachment ? "添付ファイルがある場合は空欄のまま開始できます。補足メモを追加することもできます。" : "例：TF2の遅延を翌Qでどう取り返すか、メンバーの担当集中をどう分散するか\nまたはファイルをここにドラッグ＆ドロップ"}
                  style={{
                    width: "100%", padding: "8px 10px", fontSize: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                    resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
                  }}
                />
              </FileDropZone>
            </div>

            {/* 保存済み計画バナー */}
            {savedPlan && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                background: "var(--color-bg-purple)",
                border: "1px solid var(--color-border-purple)",
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                marginBottom: "14px",
                fontSize: "12px",
              }}>
                <span style={{ fontSize: "16px" }}>{savedPlan.status === "finalized" ? "✅" : "💾"}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: "600", color: "var(--color-text-primary)" }}>
                    {savedPlan.status === "finalized" ? "確定済み計画書" : "保存済み下書き"}があります
                  </span>
                  <span style={{ color: "var(--color-text-tertiary)", marginLeft: "8px" }}>
                    {new Date(savedPlan.saved_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                    TF {savedPlan.tfs.length}件 · {savedPlan.tfs.map(tf => `TF${tf.tf_number} ${tf.name}`).join("、")}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setGeneratedPlan({ quarter: savedPlan.quarter, summary: savedPlan.summary, tfs: savedPlan.tfs, overall_risk: savedPlan.overall_risk });
                    setPlanTfs(savedPlan.tfs);
                    setPlanSummary(savedPlan.summary);
                    setPlanRisk(savedPlan.overall_risk);
                    setPhase("plan");
                  }}
                  style={{ padding: "5px 12px", fontSize: "11px", fontWeight: "600", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}
                >復元する</button>
                <button
                  onClick={() => { deleteQuarterPlan(selectedKrId, targetQuarter); setSavedPlan(null); showToast("削除しました", "info"); }}
                  style={{ padding: "5px 10px", fontSize: "11px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", color: "var(--color-text-tertiary)", cursor: "pointer" }}
                >削除</button>
              </div>
            )}

            {error && (
              <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)", marginBottom: "12px" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleStart}
                disabled={!selectedKr}
                style={{
                  padding: "11px 24px", fontSize: "13px", fontWeight: "600",
                  background: !selectedKr ? "var(--color-bg-tertiary)" : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
                  border: "none", borderRadius: "var(--radius-md)",
                  color: !selectedKr ? "var(--color-text-tertiary)" : "#fff",
                  cursor: !selectedKr ? "not-allowed" : "pointer",
                  boxShadow: selectedKr ? "0 2px 8px rgba(124,58,237,0.35)" : "none",
                }}
              >
                📅 {getQuarterLabel(targetQuarter)} の計画を始める
              </button>
            </div>
          </div>
        )}

        {/* ─── 読み込み中 ─── */}
        {phase === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", minHeight: "200px" }}>
            <div className="animate-spin" style={{ width: "28px", height: "28px", border: "2.5px solid var(--color-border-primary)", borderTopColor: "var(--color-brand)", borderRadius: "50%" }} />
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>セッション記録を読み込んでいます...</div>
          </div>
        )}

        {/* ─── AI生成中（計画書） ─── */}
        {phase === "generating" && (
          <AIProgressLoader phases={GENERATE_PHASES} intervalMs={5500} />
        )}

        {/* ─── コンテキストサマリー（対話中・計画書表示中） ─── */}
        {contextSummary && (phase === "dialogue" || phase === "thinking" || phase === "plan") && (
          <div style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}>
            <button
              onClick={() => setContextCollapsed(c => !c)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "8px",
                padding: "10px 14px",
                background: "transparent", border: "none", cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
                📊 今Q実績サマリー（参照用）
              </span>
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {contextCollapsed ? "▶ 展開" : "▼ 折りたたむ"}
              </span>
            </button>

            {!contextCollapsed && (
              <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* TF達成率 */}
                {contextSummary.tfStats.length > 0 && (
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "6px" }}>TF達成率</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {contextSummary.tfStats.map(tf => (
                        <div key={tf.tf_number} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", minWidth: "120px" }}>TF{tf.tf_number} {tf.name.slice(0, 10)}</span>
                          <div style={{ flex: 1, height: "4px", background: "var(--color-bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{
                              height: "100%", width: `${tf.completion_pct}%`,
                              background: tf.completion_pct >= 60 ? "#10b981" : tf.completion_pct >= 40 ? "#f59e0b" : "var(--color-signal-red)",
                              borderRadius: "2px",
                            }} />
                          </div>
                          <span style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-secondary)", minWidth: "40px", textAlign: "right" }}>
                            {tf.completion_pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* シグナル推移 */}
                {contextSummary.signalHistory.length > 0 && (
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "4px" }}>シグナル推移（直近）</div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {contextSummary.signalHistory.slice(0, 10).map((s, i) => {
                        const typeJa = s.session_type === "checkin" ? "チェックイン"
                                     : s.session_type === "win_session" ? "ウィン"
                                     : "OKR議論";
                        return (
                          <span key={i} title={`${s.week_start} ${typeJa}: ${s.signal_comment}`} style={{ fontSize: "14px", cursor: "default" }}>
                            {s.signal ? SIGNAL_DOT[s.signal] : "—"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 学び */}
                {contextSummary.winLearnings && (
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", marginBottom: "4px" }}>ウィンセッション 学び</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.6, maxHeight: "80px", overflow: "auto" }}>
                      {contextSummary.winLearnings}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── 対話エリア ─── */}
        {showDialogue && messages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* プログレス（対話中のみ） */}
            {phase !== "plan" && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                <span>第{turnCount}ターン</span>
                {turnCount >= 2 && (
                  <span style={{ color: "var(--color-ai-from)" }}>計画書を生成できます</span>
                )}
              </div>
            )}

            {/* 会話バブル */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {messages.map((msg, idx) => {
                const textContent = getContentText(msg.content);
                if (textContent.includes("【クォーター計画コンテキスト】")) return null;
                return (
                  <div key={idx} className="chat-bubble-in" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: msg.role === "assistant" ? "95%" : "80%",
                      padding: "12px 16px",
                      borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                      background: msg.role === "user" ? "var(--color-brand)" : "var(--color-bg-secondary)",
                      color: msg.role === "user" ? "#fff" : "var(--color-text-primary)",
                      border: msg.role === "assistant" ? "1px solid var(--color-border-primary)" : "none",
                      fontSize: "13px", lineHeight: 1.7,
                    }}>
                      {msg.role === "assistant" && (
                        <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-ai-from-deep)", marginBottom: "4px", opacity: 0.8 }}>AI</div>
                      )}
                      {msg.role === "assistant"
                        ? (textContent.length > 400 || textContent.includes("\n##")
                            ? <MarkdownLite text={textContent} compact />
                            : <TypingMessage text={textContent} isLatest={idx === typingIndex} />)
                        : <span style={{ whiteSpace: "pre-wrap" }}>{textContent}</span>}
                    </div>
                  </div>
                );
              })}

              {phase === "thinking" && (
                <div className="chat-bubble-in" style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "10px 14px", borderRadius: "12px 12px 12px 4px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    <ThinkingDots />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* 入力エリア（対話フェーズのみ） */}
            {phase === "dialogue" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  ref={inputRef}
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendAnswer(); } }}
                  placeholder="回答を入力（Enterで送信、Shift+Enterで改行）"
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
                  <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "6px 10px", borderRadius: "var(--radius-md)" }}>{error}</div>
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
                  >答える →</button>
                  <button
                    onClick={handleGeneratePlan}
                    disabled={turnCount < 1}
                    style={{
                      padding: "9px 16px", fontSize: "12px", fontWeight: "600",
                      background: turnCount >= 1 ? "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))" : "var(--color-bg-tertiary)",
                      border: "none", borderRadius: "var(--radius-md)",
                      color: turnCount >= 1 ? "#fff" : "var(--color-text-tertiary)",
                      cursor: turnCount >= 1 ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                      boxShadow: turnCount >= 1 ? "0 2px 8px rgba(124,58,237,0.35)" : "none",
                    }}
                  >✨ 計画書を生成</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── 計画書 ─── */}
        {phase === "plan" && generatedPlan && (
          <div>
            {/* エクスポートバー */}
            <div style={{
              display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
              marginBottom: "16px",
              padding: "10px 14px",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
                {getQuarterLabel(targetQuarter)} TF計画書
                {savedPlan && (
                  <span style={{ marginLeft: "8px", fontSize: "10px", padding: "2px 8px", background: savedPlan.status === "finalized" ? "#d1fae5" : "#ede9fe", color: savedPlan.status === "finalized" ? "#065f46" : "#5b21b6", borderRadius: "var(--radius-full)" }}>
                    {savedPlan.status === "finalized" ? "確定済み" : "下書き保存済み"}
                  </span>
                )}
              </div>
              <button onClick={handleDownload} style={exportBtnStyle}>⬇ MD保存</button>
              <button onClick={handleCopyCopilotPrompt} style={exportBtnStyle}>🤖 Copilot用</button>
              <button onClick={() => handleSave("draft")} style={exportBtnStyle}>💾 下書き保存</button>
              <button
                onClick={() => handleSave("finalized")}
                style={{ ...exportBtnStyle, background: "var(--color-brand)", color: "#fff", border: "none", fontWeight: "600" }}
              >✅ 確定</button>
              <button
                onClick={handleGeneratePlan}
                style={{ ...exportBtnStyle, color: "var(--color-text-tertiary)" }}
              >再生成</button>
            </div>

            {/* 方針サマリー */}
            <div style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))",
              border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 18px",
              marginBottom: "14px",
            }}>
              <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--color-ai-from)", letterSpacing: "0.08em", marginBottom: "6px" }}>方針サマリー</div>
              <textarea
                value={planSummary}
                onChange={e => setPlanSummary(e.target.value)}
                rows={3}
                style={{
                  width: "100%", fontSize: "13px", lineHeight: 1.7,
                  color: "var(--color-text-primary)",
                  background: "transparent", border: "none", resize: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                  padding: 0, outline: "none",
                }}
              />
              {planRisk && (
                <div style={{ marginTop: "8px", fontSize: "11px", color: "#b45309" }}>⚠ {planRisk}</div>
              )}
            </div>

            {/* TFカード一覧 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {planTfs.map(tf => (
                <TFPlanCard
                  key={tf.tempId}
                  tf={tf}
                  members={memberNames}
                  onChange={updated => setPlanTfs(tfs => tfs.map(t => t.tempId === tf.tempId ? updated : t))}
                  onRemove={() => setPlanTfs(tfs => tfs.filter(t => t.tempId !== tf.tempId))}
                />
              ))}

              {/* TF追加 */}
              <button
                onClick={() => {
                  const newTf: ProposedTF = {
                    tempId: `tf-new-${Date.now()}`,
                    tf_number: planTfs.length + 1,
                    action: "新設",
                    name: `新TF${planTfs.length + 1}`,
                    objective: "",
                    rationale: "",
                    leader_suggestion: null,
                    key_todos: [],
                    success_criteria: "",
                    risk: null,
                  };
                  setPlanTfs(tfs => [...tfs, newTf]);
                }}
                style={{
                  padding: "10px", fontSize: "12px",
                  background: "transparent",
                  border: "1px dashed var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >＋ TFを追加</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {content}
    </div>
  );
}

const exportBtnStyle: React.CSSProperties = {
  fontSize: "11px", padding: "5px 10px",
  background: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
