// src/components/consultation/ConsultationPanel.tsx

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { v4 as uuidv4 } from "uuid";
import { saveChatSession } from "../../lib/ai/chatHistoryStorage";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import type { Member, Project, Task } from "../../lib/localData/types";
import type { ConsultationType } from "../../lib/ai/types";
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
import { inferConsultationType } from "../../lib/ai/inferConsultationType";
import {
  callProjectPlanDialogue,
  callProjectPlanFinalize,
  type PlanMessage,
  type PlannedTask,
} from "../../lib/ai/projectPlanClient";
import { useTypingEffect } from "../../hooks/useTypingEffect";
import { MeetingImportPanel } from "../meeting/MeetingImportPanel";

type PanelMode = "consult" | "create" | "meeting";

const PROJECT_COLORS = [
  "#6366f1", "#3b82f6", "#14b8a6", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
];
const MAX_CREATE_TURNS = 4;

type CreatePhase = "chat" | "generating" | "confirm" | "saving" | "done" | "error";
type ProjTaskRow = PlannedTask & {
  selected: boolean; editedName: string;
  editedAssigneeId: string; editedDueDate: string;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Member;
  selectedProject?: Project | null;
  projects?: Project[];
  inline?: boolean;
  defaultMode?: PanelMode;
  onWidthChange?: (width: number) => void;
  onOpenTask?: (taskId: string) => void;
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
  defaultMode = "consult",
  onWidthChange,
  onOpenTask,
}: Props) {
  // ===== パネルモード =====
  const [panelMode, setPanelMode] = useState<PanelMode>(defaultMode);
  useEffect(() => { setPanelMode(defaultMode); }, [defaultMode]);

  // ===== 相談モード用状態 =====
  const [manualType, setManualType] = useState<ConsultationType | null>(null);
  const [inputText, setInputText] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");
  const [includeOKR, setIncludeOKR] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSessionHistoryOpen, setIsSessionHistoryOpen] = useState(false);
  const [ganttPreviewProposal, setGanttPreviewProposal] = useState<UIProposal | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());

  // 各セッションに固有IDを割り振る（localStorage保存用）
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // ===== PJ作成モード用状態 =====
  const [createPhase, setCreatePhase] = useState<CreatePhase>("chat");
  const [createMessages, setCreateMessages] = useState<PlanMessage[]>([]);
  const [createTypingIndex, setCreateTypingIndex] = useState(-1);
  const [createInput, setCreateInput] = useState("");
  const [createThinking, setCreateThinking] = useState(false);
  const [createTurns, setCreateTurns] = useState(0);
  const [createError, setCreateError] = useState("");
  const [projName, setProjName] = useState("");
  const [projPurpose, setProjPurpose] = useState("");
  const [projColor, setProjColor] = useState(PROJECT_COLORS[0]);
  const [projOwnerId, setProjOwnerId] = useState(currentUser.id);
  const [projTaskRows, setProjTaskRows] = useState<ProjTaskRow[]>([]);
  const createChatEndRef = useRef<HTMLDivElement>(null);

  // パネル幅（フローティング時のみ使用）
  const PANEL_WIDTH_KEY = "consultation_panel_width";
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return Math.min(800, Math.max(300, parseInt(localStorage.getItem(PANEL_WIDTH_KEY) ?? "400", 10) || 400)); } catch { return 400; }
  });
  const panelWidthRef = useRef(panelWidth);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => { onWidthChange?.(panelWidth); }, [panelWidth, onWidthChange]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 自動判定 or 手動上書き
  const autoType = useMemo(() => inferConsultationType(inputText), [inputText]);
  const consultationType: ConsultationType = manualType ?? autoType;
  const isAutoDetected = manualType === null;

  const { reload, members: rawMembers, saveProject, saveTask } = useAppData();
  const members = useMemo(() => (rawMembers ?? []).filter(m => !m.is_deleted), [rawMembers]);
  const today = new Date().toISOString().slice(0, 10);

  // PJ作成モードの初期化（モード切り替え時）
  useEffect(() => {
    if (panelMode !== "create" || createMessages.length > 0) return;
    const firstMsg = "どんなプロジェクトを立ち上げたいですか？目的や背景を教えてください。";
    setCreateMessages([{ role: "assistant", content: firstMsg }]);
    setCreateTypingIndex(0);
  }, [panelMode, createMessages.length]);

  useEffect(() => {
    createChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [createMessages, createThinking]);

  const handleCreateSend = useCallback(async () => {
    const text = createInput.trim();
    if (!text || createThinking) return;
    const newMessages: PlanMessage[] = [...createMessages, { role: "user", content: text }];
    setCreateMessages(newMessages);
    setCreateInput("");
    const newTurns = createTurns + 1;
    setCreateTurns(newTurns);
    if (newTurns >= MAX_CREATE_TURNS) return;
    setCreateThinking(true);
    try {
      const firstUserIdx = newMessages.findIndex(m => m.role === "user");
      const apiMsgs = firstUserIdx >= 0 ? newMessages.slice(firstUserIdx) : newMessages;
      const reply = await callProjectPlanDialogue(apiMsgs);
      setCreateMessages(prev => {
        const next = [...prev, { role: "assistant" as const, content: reply }];
        setCreateTypingIndex(next.length - 1);
        return next;
      });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "AI呼び出しに失敗しました。");
      setCreatePhase("error");
    } finally {
      setCreateThinking(false);
    }
  }, [createInput, createThinking, createMessages, createTurns]);

  const handleCreateGenerate = useCallback(async () => {
    setCreatePhase("generating");
    try {
      const firstUserIdx = createMessages.findIndex(m => m.role === "user");
      const apiMsgs = firstUserIdx >= 0 ? createMessages.slice(firstUserIdx) : createMessages;
      const plan = await callProjectPlanFinalize({
        messages: apiMsgs,
        memberShortNames: members.map(m => m.short_name),
        today,
      });
      setProjName(plan.project_name);
      setProjPurpose(plan.purpose);
      setProjTaskRows(plan.tasks.map((t: PlannedTask) => {
        const matched = members.find(m => m.short_name === t.assignee_short_name);
        return { ...t, selected: true, editedName: t.name, editedAssigneeId: matched?.id ?? "", editedDueDate: t.due_date ?? "" };
      }));
      setCreatePhase("confirm");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "プラン生成に失敗しました。");
      setCreatePhase("error");
    }
  }, [createMessages, members, today]);

  const handleCreateSave = useCallback(async () => {
    if (!projName.trim()) return;
    setCreatePhase("saving");
    const now = new Date().toISOString();
    const newProjectId = uuidv4();
    try {
      await saveProject({
        id: newProjectId, name: projName.trim(), purpose: projPurpose.trim(),
        contribution_memo: "", owner_member_id: projOwnerId, owner_member_ids: [projOwnerId],
        status: "active", color_tag: projColor, start_date: today, end_date: "",
        is_deleted: false, created_at: now, updated_at: now, updated_by: currentUser.id,
      });
      const selected = projTaskRows.filter(r => r.selected && r.editedName.trim());
      for (const r of selected) {
        const newTask: Task = {
          id: uuidv4(), name: r.editedName.trim(), project_id: newProjectId,
          todo_ids: [], assignee_member_id: r.editedAssigneeId || "",
          assignee_member_ids: r.editedAssigneeId ? [r.editedAssigneeId] : [],
          status: "todo", priority: null, start_date: null,
          due_date: r.editedDueDate || null, estimated_hours: null,
          comment: r.note || "", is_deleted: false,
          created_at: now, updated_at: now, updated_by: currentUser.id,
        };
        await saveTask(newTask);
      }
      setCreatePhase("done");
      reload();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "保存中にエラーが発生しました。");
      setCreatePhase("error");
    }
  }, [projName, projPurpose, projOwnerId, projColor, projTaskRows, currentUser.id, saveProject, saveTask, reload, today]);

  const resetCreate = useCallback(() => {
    setCreatePhase("chat");
    setCreateMessages([]);
    setCreateTypingIndex(-1);
    setCreateInput("");
    setCreateThinking(false);
    setCreateTurns(0);
    setCreateError("");
    setProjName(""); setProjPurpose(""); setProjColor(PROJECT_COLORS[0]);
    setProjOwnerId(currentUser.id); setProjTaskRows([]);
  }, [currentUser.id]);
  const {
    callState, session, tokenStatus, loadingMessage,
    shortIdMap, proposals, followUpSuggestions, errorMessage,
    submit, reset, undoStack, canUndo, pushUndoSnapshot, undo, undoUntil,
  } = useAIConsultation([], currentUser.id);

  const currentType = TYPE_CONFIG.find(t => t.value === consultationType)!;
  const hasHistory = session.turns.length > 0;

  // deadline_check 以外に切り替わったら日付をクリア
  useEffect(() => {
    if (consultationType !== "deadline_check") setTargetDeadline("");
  }, [consultationType]);

  // 提案が来たらスクロールエリアを一番下へ
  useEffect(() => {
    if (callState === "success" && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [callState, proposals.length]);

  // パネルリサイズ（フローティング時のみ）
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidthRef.current;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      // 左端ドラッグ：左に動かすと幅が増える
      const delta = dragStartX.current - e.clientX;
      const w = Math.min(800, Math.max(300, dragStartW.current + delta));
      panelWidthRef.current = w;
      setPanelWidth(w);
    };
    const onUp = () => {
      if (!isDraggingPanel.current) return;
      isDraggingPanel.current = false;
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleSubmit = async () => {
    if (!inputText.trim() || callState === "loading") return;
    const text = inputText;
    setInputText("");

    // 選択提案がある場合、コンテキストを先頭に付与
    let consultation = text;
    if (selectedProposalIds.size > 0) {
      const selectedProposals = proposals.filter(p => selectedProposalIds.has(p.proposal_id));
      const refs = selectedProposals.map(p => `・「${p.title}」`).join("\n");
      consultation = `以下の提案についてのフィードバックです:\n${refs}\n\n${text}`;
    }
    setSelectedProposalIds(new Set());

    await submit({ consultation, consultationType, targetDeadline: targetDeadline || null, includeOKR });
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

  const handleTypeChange = (v: ConsultationType | null) => {
    setManualType(v);
    if (v !== "deadline_check") setTargetDeadline("");
  };

  // AIからの返信が来るたびにlocalStorageへ自動保存（ユーザー端末のみ・DBには送らない）
  useEffect(() => {
    if (session.turns.length < 2) return;
    const firstUserTurn = session.turns.find(t => t.role === "user");
    if (!firstUserTurn) return;
    saveChatSession(currentUser.id, {
      id: sessionIdRef.current,
      savedAt: new Date().toISOString(),
      title: firstUserTurn.content.replace(/^以下の提案についてのフィードバックです:[\s\S]*?\n\n/, "").slice(0, 60),
      consultationType,
      turns: session.turns,
    });
  }, [session.turns, currentUser.id, consultationType]);

  const handleReset = () => {
    setManualType(null);
    setSelectedProposalIds(new Set());
    reset();
    sessionIdRef.current = crypto.randomUUID();
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
    position: "relative",
  } : {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: `min(${panelWidth}px, 100vw)`,
    background: "var(--color-bg-primary)",
    borderLeft: "1px solid var(--color-border-primary)",
    boxShadow: "var(--shadow-lg)", zIndex: 100,
    transform: isOpen ? "translateX(0)" : "translateX(100%)",
    transition: isDraggingPanel.current ? "none" : "transform 0.3s ease",
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

        {/* 相談履歴オーバーレイ */}
        {isSessionHistoryOpen && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 20,
            background: "var(--color-bg-primary)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            <SessionHistoryPanel
              userId={currentUser.id}
              onClose={() => setIsSessionHistoryOpen(false)}
            />
          </div>
        )}

        {/* リサイズハンドル（フローティング時のみ） */}
        {!inline && (
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
              cursor: "col-resize", zIndex: 10,
              background: "transparent",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-brand)"; (e.currentTarget as HTMLDivElement).style.opacity = "0.4"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
          />
        )}

        {/* ===== ヘッダー（グラデーション） ===== */}
        <div className="ai-shimmer" style={{
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          flexShrink: 0, padding: "12px 14px 10px",
        }}>
          {/* タイトル行 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
            <span style={{ fontSize: "16px", lineHeight: 1 }}>✨</span>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#fff", flex: 1 }}>
              AIアシスタント
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {panelMode === "consult" && canUndo && (
                <button onClick={() => undo(currentUser.id)} title="最後の変更を元に戻す (Cmd+Z)" style={headerBtnWhite(true)}>
                  ↩ 元に戻す
                </button>
              )}
              {panelMode === "consult" && undoStack.length > 0 && (
                <button onClick={() => setIsHistoryOpen(true)} style={headerBtnWhite(false)}>履歴</button>
              )}
              {panelMode === "consult" && hasHistory && (
                <button onClick={handleReset} style={headerBtnWhite(false)}>リセット</button>
              )}
              {panelMode === "consult" && (
                <button onClick={() => setIsSessionHistoryOpen(true)} title="相談履歴" style={iconBtnWhite}>
                  <ClockIcon />
                </button>
              )}
              {panelMode === "create" && (createPhase === "chat" || createPhase === "error") && (
                <button onClick={resetCreate} style={headerBtnWhite(false)}>リセット</button>
              )}
              <button onClick={onClose} aria-label="閉じる" style={{ ...iconBtnWhite, fontSize: "16px" }}>×</button>
            </div>
          </div>
          {/* モードタブ */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["consult", "create", "meeting"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setPanelMode(mode)}
                style={{
                  padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                  borderRadius: "var(--radius-full)", border: "none", cursor: "pointer",
                  background: panelMode === mode ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)",
                  color: panelMode === mode ? "#6366f1" : "rgba(255,255,255,0.85)",
                  transition: "all 0.15s", whiteSpace: "nowrap",
                }}
              >
                {mode === "consult" ? "💬 相談" : mode === "create" ? "📋 PJ/タスク登録" : "🎙️ 会議"}
              </button>
            ))}
          </div>
        </div>

        {/* ===== 会議読み込みモード ===== */}
        {panelMode === "meeting" && (
          <MeetingImportPanel
            inline
            onClose={() => setPanelMode("consult")}
            currentUser={currentUser}
          />
        )}

        {/* ===== PJ/タスク登録モード ===== */}
        {panelMode === "create" && (
          <ProjectCreatePane
            phase={createPhase}
            messages={createMessages}
            typingIndex={createTypingIndex}
            input={createInput}
            thinking={createThinking}
            turns={createTurns}
            errorMsg={createError}
            projName={projName} setProjName={setProjName}
            projPurpose={projPurpose} setProjPurpose={setProjPurpose}
            projColor={projColor} setProjColor={setProjColor}
            projOwnerId={projOwnerId} setProjOwnerId={setProjOwnerId}
            projTaskRows={projTaskRows} setProjTaskRows={setProjTaskRows}
            members={members}
            chatEndRef={createChatEndRef}
            onInput={setCreateInput}
            onSend={handleCreateSend}
            onGenerate={handleCreateGenerate}
            onSave={handleCreateSave}
            onReset={resetCreate}
            onBackToChat={() => setCreatePhase("chat")}
          />
        )}

        {/* ===== 相談モード ===== */}
        {panelMode === "consult" && <>

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
              onClick={handleReset}
              style={{ fontSize: "10px", padding: "2px 8px", background: "var(--color-text-warning)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", flexShrink: 0 }}
            >
              リセット
            </button>
          </div>
        )}

        {/* ===== スクロール可能エリア ===== */}
        <div ref={scrollAreaRef} style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>

          {/* 相談の種類タブ（自動 + 5種） */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", marginBottom: "6px", letterSpacing: "0.04em" }}>
              相談の種類
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {/* 自動ボタン */}
              <button
                onClick={() => handleTypeChange(null)}
                style={{
                  fontSize: "11px", padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  border: isAutoDetected ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                  background: isAutoDetected ? "var(--color-brand)" : "var(--color-bg-secondary)",
                  color: isAutoDetected ? "#fff" : "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: isAutoDetected ? "600" : "400",
                  transition: "all 0.1s", whiteSpace: "nowrap",
                }}
              >
                自動
              </button>
              {/* 5種類ボタン */}
              {TYPE_CONFIG.map(t => {
                const active = !isAutoDetected && consultationType === t.value;
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
                      transition: "all 0.1s", whiteSpace: "nowrap",
                    }}
                  >
                    {t.shortLabel}
                  </button>
                );
              })}
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

          {/* OKRトグル（コンパクト） */}
          <button
            onClick={() => setIncludeOKR(v => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "4px 10px", alignSelf: "flex-start",
              background: "transparent",
              border: `1px solid ${includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-border-primary)"}`,
              borderRadius: "var(--radius-full)", cursor: "pointer",
              fontSize: "10px",
              color: includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-text-tertiary)",
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: "2px", flexShrink: 0,
              background: includeOKR ? "var(--color-accent, #3b82f6)" : "transparent",
              border: `1.5px solid ${includeOKR ? "var(--color-accent, #3b82f6)" : "var(--color-text-tertiary)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {includeOKR && (
                <svg width="6" height="5" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3l2.5 2.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            OKR情報も含める
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
              <div style={{ fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>最新の提案（{proposals.length}件）</span>
                {selectedProposalIds.size > 0 && (
                  <>
                    <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--color-accent, #3b82f6)", color: "#fff", fontWeight: "600" }}>
                      {selectedProposalIds.size}件選択中
                    </span>
                    <button
                      onClick={() => setSelectedProposalIds(new Set())}
                      style={{ fontSize: "10px", color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      解除
                    </button>
                  </>
                )}
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
                  isSelected={selectedProposalIds.has(proposal.proposal_id)}
                  onToggleSelect={() => setSelectedProposalIds(prev => {
                    const next = new Set(prev);
                    if (next.has(proposal.proposal_id)) next.delete(proposal.proposal_id);
                    else next.add(proposal.proposal_id);
                    return next;
                  })}
                  onOpenTask={onOpenTask}
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
              <ChatHistory session={session} shortIdMap={shortIdMap} currentUserId={currentUser.id} onOpenTask={onOpenTask} />
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
          {/* 選択中提案バッジ */}
          {selectedProposalIds.size > 0 && (
            <div style={{ fontSize: "10px", color: "var(--color-accent, #3b82f6)", background: "var(--color-accent-bg, #eff6ff)", border: "1px solid var(--color-accent, #3b82f6)", borderRadius: "var(--radius-sm)", padding: "4px 8px" }}>
              提案 {selectedProposalIds.size}件を選択中 — 送信すると選択した提案へのフィードバックとして送られます
            </div>
          )}
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
              {callState === "loading" ? "生成中..." : selectedProposalIds.size > 0 ? `${selectedProposalIds.size}件の提案に返信` : "AIに相談する"}
            </button>
          </div>
        </div>

        </>}

      </div>
    </>
  );
}

function headerBtnWhite(primary: boolean): React.CSSProperties {
  return {
    fontSize: "11px", padding: "4px 9px",
    background: primary ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: "var(--radius-sm)",
    color: "#fff",
    cursor: "pointer", whiteSpace: "nowrap",
  };
}
const iconBtnWhite: React.CSSProperties = {
  background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer",
  padding: "3px 6px", color: "#fff", lineHeight: 1,
  display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)",
};

function ClockIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 4.5V8l2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ThinkingDots() {
  return (
    <div className="ai-thinking-dots" style={{ color: "var(--color-text-tertiary)" }}>
      <span /><span /><span />
    </div>
  );
}

function TypingMessage({ text }: { text: string }) {
  const { displayed, done } = useTypingEffect(text);
  return <span className={done ? "" : "typing-cursor"}>{displayed}</span>;
}

interface ProjectCreatePaneProps {
  phase: CreatePhase;
  messages: PlanMessage[];
  typingIndex: number;
  input: string;
  thinking: boolean;
  turns: number;
  errorMsg: string;
  projName: string; setProjName: (v: string) => void;
  projPurpose: string; setProjPurpose: (v: string) => void;
  projColor: string; setProjColor: (v: string) => void;
  projOwnerId: string; setProjOwnerId: (v: string) => void;
  projTaskRows: ProjTaskRow[]; setProjTaskRows: React.Dispatch<React.SetStateAction<ProjTaskRow[]>>;
  members: Member[];
  chatEndRef: React.RefObject<HTMLDivElement>;
  onInput: (v: string) => void;
  onSend: () => void;
  onGenerate: () => void;
  onSave: () => void;
  onReset: () => void;
  onBackToChat: () => void;
}

function ProjectCreatePane({
  phase, messages, typingIndex, input, thinking, turns, errorMsg,
  projName, setProjName, projPurpose, setProjPurpose,
  projColor, setProjColor, projOwnerId, setProjOwnerId,
  projTaskRows, setProjTaskRows, members, chatEndRef,
  onInput, onSend, onGenerate, onSave, onBackToChat,
}: ProjectCreatePaneProps) {
  const inputStyle: React.CSSProperties = {
    padding: "5px 8px", fontSize: "12px",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>

      {/* エラー */}
      {phase === "error" && (
        <div style={{ padding: "16px 14px" }}>
          <div style={{ padding: "10px 12px", fontSize: "12px", background: "var(--color-bg-danger)", color: "var(--color-text-danger)", borderRadius: "var(--radius-md)" }}>
            {errorMsg}
          </div>
          <button
            onClick={onBackToChat}
            style={{ marginTop: "10px", padding: "6px 14px", fontSize: "12px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}
          >チャットに戻る</button>
        </div>
      )}

      {/* 生成中 */}
      {phase === "generating" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "14px", padding: "40px" }}>
          <div style={{ fontSize: "32px", animation: "spin 3s linear infinite", display: "inline-block" }}>✨</div>
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", fontWeight: "600" }}>プロジェクト計画を生成中</div>
          <div className="ai-thinking-dots" style={{ color: "var(--color-brand)" }}><span /><span /><span /></div>
        </div>
      )}

      {/* 完了 */}
      {phase === "done" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", padding: "40px" }}>
          <div style={{ fontSize: "32px" }}>🎉</div>
          <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text-primary)" }}>プロジェクトを作成しました</div>
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            「{projName}」と{projTaskRows.filter(r => r.selected).length}件のタスクを追加しました
          </div>
        </div>
      )}

      {/* チャットフェーズ */}
      {phase === "chat" && (
        <>
          <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.map((m, i) => (
              <div key={i} className="chat-bubble-in" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "85%", padding: "8px 12px",
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: m.role === "user" ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "var(--color-bg-secondary)",
                  color: m.role === "user" ? "#fff" : "var(--color-text-primary)",
                  fontSize: "12px", lineHeight: "1.6",
                }}>
                  {m.role === "assistant" && i === typingIndex
                    ? <TypingMessage text={m.content} />
                    : m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="chat-bubble-in" style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ borderRadius: "14px 14px 14px 4px", background: "var(--color-bg-secondary)" }}>
                  <ThinkingDots />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* ターン数インジケータ */}
          {turns > 0 && (
            <div style={{ padding: "0 14px 4px", display: "flex", alignItems: "center", gap: "4px" }}>
              {Array.from({ length: MAX_CREATE_TURNS }).map((_, i) => (
                <div key={i} style={{
                  flex: 1, height: "3px", borderRadius: "2px",
                  background: i < turns ? "var(--color-brand)" : "var(--color-bg-tertiary)",
                  transition: "background 0.3s",
                }} />
              ))}
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginLeft: "6px", whiteSpace: "nowrap" }}>
                {turns}/{MAX_CREATE_TURNS}
              </span>
            </div>
          )}

          {/* 入力エリア */}
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <textarea
              value={input}
              onChange={e => onInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              placeholder="メッセージを入力… (Enter で送信)"
              disabled={thinking || turns >= MAX_CREATE_TURNS}
              style={{
                flex: 1, resize: "none", minHeight: "36px", maxHeight: "80px",
                padding: "7px 10px", fontSize: "12px",
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
              onClick={onSend}
              disabled={!input.trim() || thinking || turns >= MAX_CREATE_TURNS}
              style={{
                padding: "7px 12px", background: "var(--color-brand)",
                border: "none", borderRadius: "var(--radius-md)",
                color: "#fff", fontSize: "12px", cursor: "pointer",
                opacity: (!input.trim() || thinking || turns >= MAX_CREATE_TURNS) ? 0.4 : 1, flexShrink: 0,
              }}
            >送信</button>
          </div>

          {/* フッター */}
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              {turns === 0 ? "AIからの質問に答えてください" : turns >= MAX_CREATE_TURNS ? "情報が揃いました" : `あと${MAX_CREATE_TURNS - turns}ターン入力できます`}
            </span>
            <button
              onClick={onGenerate}
              disabled={turns === 0 || thinking}
              style={{
                padding: "6px 14px", fontSize: "12px", fontWeight: "600",
                background: turns === 0 || thinking ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                border: "none", borderRadius: "var(--radius-md)",
                cursor: turns === 0 || thinking ? "not-allowed" : "pointer",
                color: turns === 0 || thinking ? "var(--color-text-tertiary)" : "#fff",
              }}
            >✨ プランを生成する</button>
          </div>
        </>
      )}

      {/* 確認フェーズ */}
      {(phase === "confirm" || phase === "saving") && (
        <>
          <div style={{ flex: 1, overflow: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* PJ基本情報 */}
            <div style={{ padding: "10px 12px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)" }}>プロジェクト情報</div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>プロジェクト名</label>
                <input value={projName} onChange={e => setProjName(e.target.value)} style={inputStyle} disabled={phase === "saving"} />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>目的・背景</label>
                <textarea value={projPurpose} onChange={e => setProjPurpose(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} disabled={phase === "saving"} />
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 120px" }}>
                  <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>オーナー</label>
                  <select value={projOwnerId} onChange={e => setProjOwnerId(e.target.value)} style={inputStyle} disabled={phase === "saving"}>
                    {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--color-text-secondary)", display: "block", marginBottom: "3px" }}>カラー</label>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {PROJECT_COLORS.map(c => (
                      <button key={c} onClick={() => setProjColor(c)} style={{ width: "18px", height: "18px", borderRadius: "50%", background: c, border: projColor === c ? "2px solid var(--color-text-primary)" : "2px solid transparent", cursor: "pointer", padding: 0 }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* タスク一覧 */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-tertiary)", marginBottom: "6px" }}>
                タスク候補（{projTaskRows.filter(r => r.selected).length}/{projTaskRows.length} 件選択中）
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {projTaskRows.map((r, i) => (
                  <div key={i} style={{
                    display: "flex", gap: "8px", alignItems: "flex-start",
                    padding: "8px 10px",
                    background: r.selected ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary,#f9f9f9)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    opacity: r.selected ? 1 : 0.5,
                  }}>
                    <input type="checkbox" checked={r.selected} onChange={e => setProjTaskRows(prev => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} style={{ marginTop: "3px", flexShrink: 0, cursor: "pointer" }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                      <input value={r.editedName} onChange={e => setProjTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedName: e.target.value } : x))} style={inputStyle} disabled={!r.selected || phase === "saving"} />
                      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                        <select value={r.editedAssigneeId} onChange={e => setProjTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedAssigneeId: e.target.value } : x))} style={{ ...inputStyle, flex: "1 1 100px" }} disabled={!r.selected || phase === "saving"}>
                          <option value="">（担当なし）</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.short_name}</option>)}
                        </select>
                        <input type="date" value={r.editedDueDate} onChange={e => setProjTaskRows(prev => prev.map((x, j) => j === i ? { ...x, editedDueDate: e.target.value } : x))} style={{ ...inputStyle, flex: "0 0 auto" }} disabled={!r.selected || phase === "saving"} />
                      </div>
                      {r.note && <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{r.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 確認フッター */}
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border-primary)", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={onBackToChat} disabled={phase === "saving"} style={{ padding: "6px 12px", fontSize: "12px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", color: "var(--color-text-secondary)" }}>← チャットに戻る</button>
            <button
              onClick={onSave}
              disabled={phase === "saving" || !projName.trim() || projTaskRows.filter(r => r.selected).length === 0}
              style={{
                padding: "6px 16px", fontSize: "12px", fontWeight: "600",
                background: phase === "saving" ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                border: "none", borderRadius: "var(--radius-md)",
                cursor: phase === "saving" ? "not-allowed" : "pointer",
                color: phase === "saving" ? "var(--color-text-tertiary)" : "#fff",
              }}
            >{phase === "saving" ? "作成中..." : "🚀 プロジェクトを作成"}</button>
          </div>
        </>
      )}
    </div>
  );
}
