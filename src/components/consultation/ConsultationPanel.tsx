// src/components/consultation/ConsultationPanel.tsx

import { useState, useRef, useEffect, useMemo, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { saveChatSession } from "../../lib/ai/chatHistoryStorage";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import type { Member, Project } from "../../lib/localData/types";
import { KEYS } from "../../lib/localData/localStore";
import type { ConsultationType, ResponseVolume } from "../../lib/ai/types";
import { useAppStore } from "../../stores/appStore";
import { useConsultSessionStore } from "../../stores/consultSessionStore";
import { useAIConsultation } from "../../hooks/useAIConsultation";
import { ChatHistory } from "./ChatHistory";
import { FollowUpButtons } from "./FollowUpButtons";
import { LoadingView } from "./LoadingView";
import { ErrorView } from "./ErrorView";
import { ProposalCard } from "./ProposalCard";
import { ChangeHistoryModal } from "./ChangeHistoryModal";
import type { UIProposal } from "../../lib/ai/proposalMapper";
import { inferConsultationType } from "../../lib/ai/inferConsultationType";
import { HelpButton } from "../guide/HelpButton";
import { lazyWithRetry } from "../../lib/lazyWithRetry";

/**
 * 【設計意図】
 * GanttPreviewPanel は GanttView 全体を内包するため重い。AI提案プレビュー時のみ必要なので分離。
 * MeetingImportPanel は会議読み込みモード時のみ必要なので分離。
 * 両者を切り出すことで GanttView を初回バンドルから外せる。
 */
const GanttPreviewPanel  = lazyWithRetry(() => import("./GanttPreviewPanel").then(m => ({ default: m.GanttPreviewPanel })), "GanttPreviewPanel");
const MeetingImportPanel = lazyWithRetry(() => import("../meeting/MeetingImportPanel").then(m => ({ default: m.MeetingImportPanel })), "MeetingImportPanel");

type PanelMode = "consult" | "meeting";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Member;
  selectedProject?: Project | null;
  inline?: boolean;
  defaultMode?: PanelMode;
  onWidthChange?: (width: number) => void;
  /** リサイズドラッグ中かどうか（親側でwidth遷移アニメを切るのに使う） */
  onResizingChange?: (resizing: boolean) => void;
  onOpenTask?: (taskId: string) => void;
  /** ツアー実演用：nonce が変わるたびに consult モードで text を自動入力→送信する */
  demoRequest?: { text: string; nonce: number };
  /**
   * PJ作成導線などからの下書きプレフィル用。nonce が変わるたびに consult モードへ切り替え、
   * inputText に text をセットしてフォーカスする（送信はしない）。demoRequest（自動送信）とは別物。
   */
  prefillInput?: { text: string; nonce: number };
}


export function ConsultationPanel({
  isOpen,
  onClose,
  currentUser,
  selectedProject = null,
  inline = false,
  defaultMode = "consult",
  onWidthChange,
  onResizingChange,
  onOpenTask,
  demoRequest,
  prefillInput,
}: Props) {
  // ===== パネルモード =====
  const [panelMode, setPanelMode] = useState<PanelMode>(defaultMode);
  useEffect(() => { setPanelMode(defaultMode); }, [defaultMode]);

  // ===== 相談モード用状態 =====
  // 【seed】入力中の下書き・直近送信文を、再マウントで消えないようミラーストアから seed する。
  //   seed は getState() で初期値として1回だけ読む（ストアを購読しない）。
  const [inputText, setInputText] = useState(() => useConsultSessionStore.getState().inputDraft);
  // 直近に送信した相談文（送信後も「何を送ったか」を画面上で確認できるようにする）
  const [lastSubmittedText, setLastSubmittedText] = useState(() => useConsultSessionStore.getState().lastSubmittedText);
  // 回答ボリューム：short=簡潔 / normal=普通（既定） / detailed=詳細
  const [responseVolume, setResponseVolume] = useState<ResponseVolume>("normal");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSessionHistoryOpen, setIsSessionHistoryOpen] = useState(false);
  const [ganttPreviewProposal, setGanttPreviewProposal] = useState<UIProposal | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [latestAiTimestamp, setLatestAiTimestamp] = useState<string | undefined>(undefined);

  // 各セッションに固有IDを割り振る（localStorage保存用）
  // 【seed】再マウントで sessionId が変わると localStorage 上のチャット履歴が分裂するため、
  //   ミラーに既存IDがあればそれを使い、無ければ新規発行してミラーに載せる。
  const sessionIdRef = useRef<string>(
    useConsultSessionStore.getState().sessionId || crypto.randomUUID(),
  );
  useEffect(() => {
    if (useConsultSessionStore.getState().sessionId !== sessionIdRef.current) {
      useConsultSessionStore.getState().saveAi({ sessionId: sessionIdRef.current });
    }
  }, []);

  // パネル幅（フローティング時のみ使用）
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return Math.min(800, Math.max(300, parseInt(localStorage.getItem(KEYS.CONSULT_PANEL_WIDTH) ?? "400", 10) || 400)); } catch { return 400; }
  });
  const panelWidthRef = useRef(panelWidth);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => { onWidthChange?.(panelWidth); }, [panelWidth, onWidthChange]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const userEchoRef = useRef<HTMLDivElement>(null);

  // 入力内容からAIが相談の種類を自動判定
  const consultationType: ConsultationType = useMemo(() => inferConsultationType(inputText), [inputText]);

  const reload         = useAppStore(s => s.reload);
  const currentGroupId = useAppStore(s => s.currentGroupId);

  const {
    callState, session, tokenStatus,
    shortIdMap, proposals, followUpSuggestions, errorMessage,
    submit, reset, undoStack, canUndo, pushUndoSnapshot, undo, undoUntil,
  } = useAIConsultation([], currentUser.id);

  const hasHistory = session.turns.length > 0;

  // 【二重表示の防止】最新のやりとりは上部の「送信した相談」＋「最新の提案」で表示するため、
  // 会話履歴（ChatHistory）からは除外する。除外しないと最新の質問・回答が画面に2回出る。
  // - 提案付き成功時：末尾の user+assistant の2ターンが「現在のやりとり」
  // - エラー時：末尾の user 1ターン（回答はまだ無い）
  // - ローディング/初期/提案なし成功：session 末尾に未コミット or 履歴側で表示するため除外しない
  const omitTailCount =
    callState === "success" && proposals.length > 0 ? 2 :
    callState === "error" ? 1 : 0;
  const historyTurns = omitTailCount > 0
    ? session.turns.slice(0, Math.max(0, session.turns.length - omitTailCount))
    : session.turns;
  const hasOlderHistory = historyTurns.length > 0;
  // 「送信した相談」エコーは、質問が会話履歴に二重表示されない条件でのみ出す
  // （提案なし成功時は質問を会話履歴側で表示するのでエコーは出さない）。
  const showSubmittedEcho = !!lastSubmittedText && (
    callState === "loading" || callState === "error" ||
    (callState === "success" && proposals.length > 0)
  );

  // 【mirror】入力中の下書き・直近送信文をミラーストアへ write-through する。
  //   再マウント時の seed 元になる。getState().saveAi 経由なのでストアを購読せず無限ループしない。
  //   submit 時に inputText をクリアする既存挙動はそのまま（クリアもミラーされる）。
  useEffect(() => {
    useConsultSessionStore.getState().saveAi({ inputDraft: inputText });
  }, [inputText]);
  useEffect(() => {
    useConsultSessionStore.getState().saveAi({ lastSubmittedText });
  }, [lastSubmittedText]);

  // 提案が来たら送信メッセージの位置へスクロール（最下部ではなく送信位置先頭）＆最新AIターンを記録
  useEffect(() => {
    if (callState !== "success") return;
    if (userEchoRef.current) {
      userEchoRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
    const last = [...session.turns].reverse().find(t => t.role === "assistant");
    if (last) setLatestAiTimestamp(last.timestamp);
  }, [callState, proposals.length, session.turns]);

  // パネルリサイズ（左端ハンドルをドラッグ。フローティング・インライン共通）
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidthRef.current;
    onResizingChange?.(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [onResizingChange]);

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
      onResizingChange?.(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(KEYS.CONSULT_PANEL_WIDTH, String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onResizingChange]);

  const handleSubmit = async () => {
    if (!inputText.trim() || callState === "loading") return;
    const text = inputText;
    setLastSubmittedText(text);
    setInputText("");

    // 選択提案がある場合、コンテキストを先頭に付与
    let consultation = text;
    if (selectedProposalIds.size > 0) {
      const selectedProposals = proposals.filter(p => selectedProposalIds.has(p.proposal_id));
      const refs = selectedProposals.map(p => `・「${p.title}」`).join("\n");
      consultation = `以下の提案についてのフィードバックです:\n${refs}\n\n${text}`;
    }
    setSelectedProposalIds(new Set());

    await submit({ consultation, consultationType, responseVolume });
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
    setSelectedProposalIds(new Set());
    setInputText("");
    setLastSubmittedText("");
    reset();                      // ミラーの session/proposals/shortIdMap/followUp/inputDraft/lastSubmitted を空に戻す
    sessionIdRef.current = crypto.randomUUID();
    // 新しい sessionId をミラーにも反映（resetAi が sessionId="" に戻すため上書きする）
    useConsultSessionStore.getState().saveAi({ sessionId: sessionIdRef.current });
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

  // ===== ツアー実演：例文を1文字ずつ自動入力して送信する =====
  // ツアー（TourProvider）の "demo-ai-consult" アクション起点で MainLayout が
  // demoRequest を渡す。nonce が変わったときだけ1回実行する（refで重複防止）。
  const demoNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!demoRequest || !isOpen) return;
    if (demoRequest.nonce === demoNonceRef.current) return;
    demoNonceRef.current = demoRequest.nonce;

    setPanelMode("consult");
    handleReset();          // 直前の会話・選択をクリア
    const text = demoRequest.text;
    setInputText("");
    let i = 0;
    let submitTimer: ReturnType<typeof setTimeout> | undefined;
    const typer = setInterval(() => {
      i += 1;
      setInputText(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(typer);
        // 入力が見えるよう少し置いてから送信（送信時は入力欄をクリア）
        submitTimer = setTimeout(() => {
          setLastSubmittedText(text);
          setInputText("");
          submit({
            consultation: text,
            consultationType: inferConsultationType(text),
            targetDeadline: null,
          });
        }, 800);
      }
    }, 40);
    return () => { clearInterval(typer); if (submitTimer) clearTimeout(submitTimer); };
    // submit / handleReset は同一パネルでは安定。typing中の再実行を避けるため依存は限定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRequest, isOpen]);

  // ===== 下書きプレフィル（PJ作成導線など） =====
  // prefillInput.nonce が変わったら consult モードに切り替え、入力欄に下書きをセットして
  // フォーカスする（送信はしない）。demoRequest（自動送信）とは別物。
  const prefillNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!prefillInput) return;
    if (prefillInput.nonce === prefillNonceRef.current) return;
    prefillNonceRef.current = prefillInput.nonce;
    setPanelMode("consult");
    setInputText(prefillInput.text);
    // パネルの描画後にフォーカス＆末尾へカーソル移動
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    }, 0);
  }, [prefillInput]);

  const panelStyle: React.CSSProperties = inline ? {
    width: `${panelWidth}px`, height: "100%",
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
        <Suspense fallback={null}>
          <GanttPreviewPanel
            proposal={ganttPreviewProposal}
            shortIdMap={shortIdMap}
            currentUser={currentUser}
            selectedProject={selectedProject}
            onClose={() => setGanttPreviewProposal(null)}
          />
        </Suspense>,
        document.body,
      )}
      {!inline && isOpen && (
        // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体はヘッダーのボタンで
        // キーボードから可能なため、背景要素をフォーカス可能にする必要はない
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
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

        {/* リサイズハンドル（左端をドラッグして幅を調整）。マウスのドラッグ操作専用でキーボード代替手段はない */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          onMouseDown={handleResizeMouseDown}
          title="ドラッグで幅を変更"
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 6,
            cursor: "col-resize", zIndex: 30,
            background: "transparent",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-brand)"; (e.currentTarget as HTMLDivElement).style.opacity = "0.4"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
        />

        {/* ===== ヘッダー（グラデーション） ===== */}
        <div className="ai-shimmer" style={{
          background: "var(--gradient-ai)",
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
                <button onClick={handleReset} title="相談をリセット（新しい相談を始める）" aria-label="相談をリセット" style={headerBtnWhite(false)}>↺</button>
              )}
              {panelMode === "consult" && (
                <button onClick={() => setIsSessionHistoryOpen(true)} title="相談履歴" style={iconBtnWhite}>
                  <ClockIcon />
                </button>
              )}
              <HelpButton modeKey="consultation.main" title="AIツールの使い方を開く" />
              <button onClick={onClose} aria-label="閉じる" style={{ ...iconBtnWhite, fontSize: "16px" }}>×</button>
            </div>
          </div>
          {/* モードタブ */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["consult", "meeting"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setPanelMode(mode)}
                {...(mode === "meeting" ? { "data-tour-id": "ai-mode-tab-meeting" } : {})}
                style={{
                  padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                  borderRadius: "var(--radius-full)", border: "none", cursor: "pointer",
                  background: panelMode === mode ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)",
                  color: panelMode === mode ? "var(--color-ai-from)" : "rgba(255,255,255,0.85)",
                  transition: "all 0.15s", whiteSpace: "nowrap",
                }}
              >
                {mode === "consult" ? "💬 相談" : "📄 資料インプット"}
              </button>
            ))}
          </div>
        </div>

        {/* ===== タブ説明バー ===== */}
        <div style={{
          padding: "6px 14px",
          background: "rgba(99,102,241,0.06)",
          borderBottom: "1px solid rgba(99,102,241,0.12)",
          fontSize: "11px",
          color: "var(--color-ai-from)",
          fontWeight: "500",
          flexShrink: 0,
          lineHeight: 1.4,
        }}>
          {panelMode === "consult" && "変更の影響確認・What-if・現状診断など、プロジェクトの課題をAIと一緒に考えます。タスクの追加や新規プロジェクトの作成もここから依頼できます"}
          {panelMode === "meeting" && "議事録・資料などを読み込み、新規タスクとステータス変更を自動で提案・登録します"}
        </div>

        {/* ===== 会議読み込みモード ===== */}
        {panelMode === "meeting" && (
          <Suspense fallback={null}>
            <MeetingImportPanel
              inline
              onClose={() => setPanelMode("consult")}
              currentUser={currentUser}
            />
          </Suspense>
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

          {/* 回答ボリューム切替（short=簡潔 / normal=普通 / detailed=詳細） */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", alignSelf: "flex-start" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>回答量</span>
            {(["short", "normal", "detailed"] as const).map(vol => {
              const labels: Record<ResponseVolume, string> = { short: "短め", normal: "普通", detailed: "詳細" };
              const active = responseVolume === vol;
              return (
                <button
                  key={vol}
                  onClick={() => setResponseVolume(vol)}
                  title={vol === "short" ? "2〜3文で簡潔に回答" : vol === "detailed" ? "背景・手順・注意点まで詳しく回答" : "標準的な回答量"}
                  style={{
                    padding: "4px 10px",
                    border: `1px solid ${active ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                    borderRadius: "var(--radius-full)",
                    background: active ? "var(--color-brand)" : "transparent",
                    color: active ? "#fff" : "var(--color-text-tertiary)",
                    cursor: "pointer",
                    fontSize: "10px",
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {labels[vol]}
                </button>
              );
            })}
          </div>

          {/* 会話履歴（古い→新しいの順。最新のやりとりは下部に表示するので、ここはそれより前のターン） */}
          {hasOlderHistory && (
            <ChatHistory
              session={{ ...session, turns: historyTurns }}
              shortIdMap={shortIdMap}
              currentUserId={currentUser.id}
              latestAssistantTimestamp={latestAiTimestamp}
              onOpenTask={onOpenTask}
              onProposalApplied={snapshot => { pushUndoSnapshot(snapshot); reload(); }}
            />
          )}

          {/* 送信した相談（吹き出しのみ＝右寄せで「送信済み」が自明なのでラベルは省略） */}
          {showSubmittedEcho && (
            <div ref={userEchoRef} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  maxWidth: "85%", padding: "8px 12px",
                  background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)",
                  borderRadius: "var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)",
                  fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.6,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {lastSubmittedText}
                </div>
              </div>
            </div>
          )}

          {/* ローディング */}
          {callState === "loading" && <LoadingView />}

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
                  currentGroupId={currentGroupId}
                  onApplied={snapshot => { pushUndoSnapshot(snapshot); reload(); }}
                  onGanttPreview={p => setGanttPreviewProposal(p)}
                  onDecline={followUpText => {
                    submit({ consultation: followUpText, consultationType });
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
              Ctrl+Enter で送信
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="相談内容を入力してください（例：○○さんが来週から休みに入ります。タスクへの影響を確認して）"
            rows={3}
            disabled={callState === "loading"}
            style={{
              fontSize: "12px", padding: "8px 10px",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: callState === "loading" ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              resize: "vertical", lineHeight: 1.6, minHeight: "72px", maxHeight: "200px", overflowY: "auto",
              outline: "none",
            }}
          />
          {/* 選択中提案バッジ */}
          {selectedProposalIds.size > 0 && (
            <div style={{ fontSize: "10px", color: "var(--color-accent, #3b82f6)", background: "var(--color-accent-bg, #eff6ff)", border: "1px solid var(--color-accent, #3b82f6)", borderRadius: "var(--radius-sm)", padding: "4px 8px" }}>
              提案 {selectedProposalIds.size}件を選択中 — 送信すると選択した提案へのフィードバックとして送られます
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
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
