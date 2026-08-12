// src/components/okr/personal/PersonalOkrAiPanel.tsx
//
// 【設計意図】
// 個人OKR用のAIパネル（Phase 3後半・docs/dev/okr-redesign-plan.md §7・CLAUDE.md Section 24
// Step H）。🔴 計画モードと同じ右パネルの「型」（ConsultationPanel.tsx）をそのまま流用する
// ——inlineでメインエリアが縮んで共存する・左端ドラッグでリサイズ可能・ヘッダーは
// グラデーション・タブ説明バーの直下にスクロール領域・下部固定フッターに入力欄、という
// 構造をコピーし、中身（ガイド・スターター・答え方）だけをOKR用に差し替える。
// 新しいパネルの仕組みは発明しない。
//
// 提案の適用（ProposalCard・Undo・Ganttプレビュー等）は持たない——このパネルは相談・助言
// 止まりで、タスクやOKRデータへの書き込みは行わない（山本さんの決定：実行は本人が行う）。
//
// 会話履歴はDBに保存しない（usePersonalOkrAiConsultation.ts参照。CLAUDE.md Section 6-7）。

import { useEffect, useRef, useState, useCallback } from "react";
import { usePersonalOkrAiConsultation } from "../../../hooks/usePersonalOkrAiConsultation";
import { buildPersonalOkrChatSystemPrompt } from "../../../lib/ai/personalOkrChatPrompt";
import { buildPersonalOkrAiContextText, buildPersonalOkrAiContextChips, buildPersonalOkrAiStarters, type PersonalOkrAiContextInput } from "../../../lib/personalOkr/personalOkrAiContext";
import { KEYS } from "../../../lib/localData/localStore";
import { GuestAiQuotaNotice } from "../../common/GuestAiQuotaNotice";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  krLabel: string;
  monthLabel: string;
  /** nullの間（当月以外を見ている・context未構築）はガード表示にする */
  context: PersonalOkrAiContextInput | null;
  inline?: boolean;
  onWidthChange?: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
}

export function PersonalOkrAiPanel({
  isOpen, onClose, krLabel, monthLabel, context, inline = true, onWidthChange, onResizingChange,
}: Props) {
  const { session, callState, errorMessage, tokenWarning, submit, reset, truncate } = usePersonalOkrAiConsultation();
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return Math.min(700, Math.max(300, parseInt(localStorage.getItem(KEYS.OKR_AI_PANEL_WIDTH) ?? "380", 10) || 380)); } catch { return 380; }
  });
  const panelWidthRef = useRef(panelWidth);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => { onWidthChange?.(panelWidth); }, [panelWidth, onWidthChange]);

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
      const delta = dragStartX.current - e.clientX;
      const w = Math.min(700, Math.max(300, dragStartW.current + delta));
      panelWidthRef.current = w;
      setPanelWidth(w);
    };
    const onUp = () => {
      if (!isDraggingPanel.current) return;
      isDraggingPanel.current = false;
      onResizingChange?.(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(KEYS.OKR_AI_PANEL_WIDTH, String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onResizingChange]);

  useEffect(() => {
    if (callState !== "success") return;
    if (scrollAreaRef.current) scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, [callState, session.turns.length]);

  const handleSubmit = async (text?: string) => {
    const value = (text ?? inputText).trim();
    if (!value || !context || callState === "loading") return;
    setInputText("");
    const systemPrompt = buildPersonalOkrChatSystemPrompt(buildPersonalOkrAiContextText(context));
    await submit(value, systemPrompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

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

  if (!isOpen) return inline ? null : <div style={panelStyle} />;

  const chips = context ? buildPersonalOkrAiContextChips(context) : [];
  const starters = context ? buildPersonalOkrAiStarters(context) : [];

  return (
    <div style={panelStyle}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onMouseDown={handleResizeMouseDown}
        title="ドラッグで幅を変更"
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 30, background: "transparent" }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--color-brand)"; (e.currentTarget as HTMLDivElement).style.opacity = "0.4"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
      />

      {/* ヘッダー（計画モードと同じグラデーション） */}
      <div className="ai-shimmer" style={{ background: "var(--gradient-ai)", flexShrink: 0, padding: "12px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px", lineHeight: 1 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>OKR相談</div>
            <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.85)" }}>{krLabel} ／ {monthLabel}</div>
          </div>
          {session.turns.length > 0 && (
            <button onClick={reset} title="相談をリセット" aria-label="相談をリセット" style={iconBtnWhite}>↺</button>
          )}
          <button onClick={onClose} aria-label="閉じる" style={{ ...iconBtnWhite, fontSize: "16px" }}>×</button>
        </div>
      </div>

      {/* display:flex + gap にしているのは、ゲスト回数表示（GuestAiQuotaNotice）を
          ゲスト以外ではnullとして描画自体させず、余分な余白を生まない（gapは実際に
          描画された子要素間にしか効かない）ため。ConsultationPanel.tsxのタブ説明バーと
          同じ流儀（CLAUDE.md Section 23） */}
      <div style={{
        display: "flex", flexDirection: "column", gap: "6px",
        padding: "6px 14px", background: "rgba(99,102,241,0.06)",
        borderBottom: "1px solid rgba(99,102,241,0.12)", fontSize: "11px",
        color: "var(--color-ai-from)", fontWeight: 500, flexShrink: 0, lineHeight: 1.4,
      }}>
        達成度バンドの定義に沿って「今どの水準か・上げるには何が必要か」で答えます。
        <GuestAiQuotaNotice variant="inline" />
      </div>

      <div ref={scrollAreaRef} style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {!context ? (
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px 2px" }}>
            当月のタブを開いているときだけAIに相談できます。
          </div>
        ) : (
          <>
            {session.turns.length === 0 && (
              <div style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "12px 13px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                  このパネルが見ているもの
                </div>
                <p style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", lineHeight: 1.6, margin: "0 0 8px" }}>
                  このKRの内容・今月の計画・週の目標状態と自己評価・タスクの実績・メモを文脈として
                  持った状態で始まります。前提の説明は要りません。
                </p>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {chips.map(chip => (
                    <span key={chip} style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "var(--radius-full)", background: "var(--color-bg-tertiary)", color: "var(--color-text-tertiary)", border: "1px solid var(--color-border-primary)" }}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {session.turns.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {starters.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSubmit(s)}
                    disabled={callState === "loading"}
                    style={{
                      fontFamily: "inherit", textAlign: "left", cursor: "pointer", fontSize: "11.5px",
                      lineHeight: 1.5, padding: "9px 12px", borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border-primary)", background: "var(--color-bg-primary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >{s}</button>
                ))}
              </div>
            )}

            {session.turns.map((turn, i) => (
              <div key={i} style={{ display: "flex", justifyContent: turn.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%", padding: "9px 12px",
                  background: turn.role === "user" ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                  border: `1px solid ${turn.role === "user" ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-md)", fontSize: "12px", color: "var(--color-text-primary)",
                  lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {turn.content}
                </div>
              </div>
            ))}

            {callState === "loading" && (
              <div style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", padding: "6px 2px" }}>考えています…</div>
            )}
            {callState === "error" && (
              <div style={{ fontSize: "11.5px", color: "var(--color-text-danger)", padding: "6px 2px" }}>{errorMessage}</div>
            )}
          </>
        )}
      </div>

      {tokenWarning && (
        <div style={{ padding: "6px 14px", background: "var(--color-bg-warning)", borderTop: "1px solid var(--color-border-warning)", fontSize: "11px", color: "var(--color-text-warning)", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <span>⚠</span><span style={{ flex: 1 }}>会話が長くなっています。</span>
          <button onClick={truncate} style={{ fontSize: "10px", padding: "2px 8px", background: "var(--color-text-warning)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
            古いやり取りを整理
          </button>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border-primary)", padding: "10px 14px 12px", background: "var(--color-bg-primary)", flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={context ? "聞きたいことを書く（Ctrl+Enterで送信）" : "当月のタブを開くとAIに相談できます"}
          rows={3}
          disabled={!context || callState === "loading"}
          style={{
            fontSize: "12px", padding: "8px 10px", border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: !context || callState === "loading" ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)",
            color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.6,
            minHeight: "60px", maxHeight: "180px", overflowY: "auto", outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => handleSubmit()}
            disabled={!context || !inputText.trim() || callState === "loading"}
            style={{
              fontSize: "12px", padding: "7px 18px",
              background: context && inputText.trim() && callState !== "loading" ? "var(--color-brand)" : "var(--color-bg-tertiary)",
              border: "none", borderRadius: "var(--radius-md)",
              color: context && inputText.trim() && callState !== "loading" ? "#fff" : "var(--color-text-tertiary)",
              cursor: context && inputText.trim() && callState !== "loading" ? "pointer" : "not-allowed",
              fontWeight: 500, whiteSpace: "nowrap",
            }}
          >
            {callState === "loading" ? "送信中…" : "送る"}
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtnWhite: React.CSSProperties = {
  background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer",
  padding: "3px 6px", color: "#fff", lineHeight: 1,
  display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)",
};
