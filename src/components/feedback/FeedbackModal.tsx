// src/components/feedback/FeedbackModal.tsx
//
// ご意見・不具合を送るモーダル（v3.157・CLAUDE.md Section 82）。入口はベルの「💬 ご意見を送る」と設定「困ったとき」。
// 操作は「入口を押す → 一言書く → Ctrl/Cmd+Enter」の3手（10秒目標）。種類は任意。画面の状況（構造データのみ・画像なし）は既定で付く。
//
// 🔴 スナップショットは MainLayout が「開いた瞬間」に確定して capture として渡す（このコンポーネントは確定済みの値を使うだけ。
//    開いた後の画面・クリックを含めない）。
// 🔴 data-feedback-ui：このモーダル内のクリックはクリック履歴に入れない（clickHistory.ts）。
// 🔴 createPortal(document.body) の要素は pointerEvents:"auto" を明示する（Section 51）。
// 失敗は入力を保持したまま、フォーム直下に永続のエラー帯（Section 45・15）。頻度上限は理由を文言で示す。
// 入力中の離脱は未保存編集レジストリ（Section 46）に乗せ、閉じる操作も確認する。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { useUnsavedEditor } from "../../hooks/useUnsavedEditor";
import { confirmDialog } from "../../lib/dialog";
import { formatErrorForUser } from "../../lib/errorMessage";
import { APP_VERSION } from "../../lib/version";
import type { FeedbackCapture } from "../../lib/feedback/capture";
import {
  FEEDBACK_COMMENT_MAX, FEEDBACK_PICKABLE_KINDS, type FeedbackKind,
} from "../../lib/feedback/constants";
import { isFeedbackNotAppliedError } from "../../lib/feedback/errors";
import { feedbackResultMessageKey, isFeedbackAccepted } from "../../lib/feedback/limit";
import { serializeSnapshot, summarizeSnapshot } from "../../lib/feedback/snapshot";
import { listMyFeedback, submitFeedback, type MyFeedback } from "../../lib/supabase/feedbackStore";
import { modalBoxStyle, modalOverlayStyle, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from "../common/modalStyles";
import { SaveErrorBand } from "../common/saveUi";
import { showToast } from "../common/Toast";

type Tab = "write" | "mine";

const STATUS_COLOR: Record<MyFeedback["status"], string> = {
  new: "info", in_progress: "warning", done: "success", wontfix: "secondary",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  capture: FeedbackCapture;
  onClose: () => void;
}

export function FeedbackModal({ capture, onClose }: Props) {
  const t = useT();
  // 🔴 取得・送信の関数の依存に t を入れない（Section 69）。文言は ref から読む
  const tRef = useRef(t);
  tRef.current = t;

  const [tab, setTab] = useState<Tab>("write");
  const [kind, setKind] = useState<Exclude<FeedbackKind, "unspecified"> | null>(null);
  const [comment, setComment] = useState("");
  const [attach, setAttach] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const doneRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mine, setMine] = useState<MyFeedback[] | null>(null);
  const [mineError, setMineError] = useState("");

  const trimmed = comment.trim();
  const dirty = trimmed !== "" && !doneRef.current;
  useUnsavedEditor(dirty);

  const summary = summarizeSnapshot(capture.snapshot);
  const json = JSON.stringify(capture.snapshot, null, 2);
  const bytes = serializeSnapshot(capture.snapshot).bytes;
  const tooLarge = capture.finalized.state === "too_large";

  useEffect(() => {
    if (tab === "write") textareaRef.current?.focus();
  }, [tab]);

  // 「送った内容」タブを開いたときだけ取得する
  useEffect(() => {
    if (tab !== "mine") return;
    let cancelled = false;
    setMine(null);
    setMineError("");
    listMyFeedback()
      .then(rows => { if (!cancelled) setMine(rows); })
      .catch(e => {
        if (cancelled) return;
        setMine([]);
        setMineError(isFeedbackNotAppliedError(e)
          ? tRef.current("layout.feedback.err.notApplied")
          : formatErrorForUser(tRef.current("layout.feedback.mine.loadFailed"), e));
      });
    return () => { cancelled = true; };
  }, [tab]);

  const requestClose = async () => {
    if (submittingRef.current) return;
    if (dirty) {
      const ok = await confirmDialog(tRef.current("layout.feedback.confirmClose"), {
        tone: "danger", confirmLabel: tRef.current("layout.feedback.confirmCloseLabel"),
      });
      if (!ok) return;
    }
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) void requestCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const send = async () => {
    if (submittingRef.current || trimmed === "") return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await submitFeedback({
        kind: kind ?? "unspecified",
        comment: trimmed,
        screen: capture.screen,
        route: capture.route,
        appVersion: APP_VERSION,
        groupId: capture.groupId,
        snapshot: attach && capture.finalized.state === "attached" ? capture.snapshot : null,
        snapshotState: !attach ? "off" : capture.finalized.state,
      });
      if (isFeedbackAccepted(result)) {
        doneRef.current = true;
        showToast(tRef.current("layout.feedback.sent"), "success");
        onClose();
        return;
      }
      const key = feedbackResultMessageKey(result);
      setError(key ? tRef.current(key) : tRef.current("layout.feedback.err.generic"));
    } catch (e) {
      setError(isFeedbackNotAppliedError(e)
        ? tRef.current("layout.feedback.err.notApplied")
        : formatErrorForUser(tRef.current("layout.feedback.err.generic"), e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const chipStyle = (active: boolean) => ({
    fontSize: "13px", padding: "4px 14px", borderRadius: "99px", cursor: "pointer",
    border: `1px solid ${active ? "var(--color-border-info)" : "var(--color-border-primary)"}`,
    background: active ? "var(--color-bg-info)" : "transparent",
    color: active ? "var(--color-text-info)" : "var(--color-text-secondary)",
    fontWeight: active ? 600 : 400,
  } as const);

  const tabStyle = (active: boolean) => ({
    fontSize: "13px", padding: "8px 14px", cursor: "pointer", background: "transparent", border: "none",
    borderBottom: `2px solid ${active ? "var(--color-text-info)" : "transparent"}`,
    color: active ? "var(--color-text-info)" : "var(--color-text-secondary)", fontWeight: active ? 600 : 400,
  } as const);

  return createPortal(
    <div data-feedback-ui="" style={{ ...modalOverlayStyle(610), background: "rgba(0,0,0,0.45)", pointerEvents: "auto" }}>
      <div
        role="dialog"
        aria-modal="true"
        data-tour-id="feedback-modal"
        aria-label={t("layout.feedback.title")}
        style={{ ...modalBoxStyle("min(580px, 100%)"), background: "var(--color-bg-primary)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 0", flexShrink: 0 }}>
          <span aria-hidden style={{ fontSize: "18px" }}>💬</span>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>{t("layout.feedback.title")}</div>
          <button type="button" onClick={() => void requestClose()} aria-label={t("layout.feedback.close")}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px", color: "var(--color-text-tertiary)", padding: "2px 6px", lineHeight: 1 }}>✕</button>
        </div>
        <div role="tablist" style={{ display: "flex", gap: "4px", padding: "0 12px", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
          <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")} style={tabStyle(tab === "write")}>{t("layout.feedback.tabWrite")}</button>
          <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")} style={tabStyle(tab === "mine")}>{t("layout.feedback.tabMine")}</button>
        </div>

        {tab === "write" && (
          <>
            <div style={{ ...MODAL_BODY_STYLE, padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>{t("layout.feedback.kindLabel")}</div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {FEEDBACK_PICKABLE_KINDS.map(k => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} style={chipStyle(kind === k)}>
                      {t(`layout.feedback.kind.${k}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="feedback-comment" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>
                  {t("layout.feedback.commentLabel")}
                </label>
                <textarea
                  id="feedback-comment"
                  data-tour-id="feedback-textarea"
                  ref={textareaRef}
                  value={comment}
                  maxLength={FEEDBACK_COMMENT_MAX}
                  rows={5}
                  placeholder={t("layout.feedback.commentPlaceholder")}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "8px 12px", fontSize: "14px", lineHeight: 1.6, resize: "vertical",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "4px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                  <span>{t("layout.feedback.warn")}</span>
                  <span>{t("layout.feedback.counter", { n: Array.from(comment).length, max: FEEDBACK_COMMENT_MAX })}</span>
                </div>
              </div>

              <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />
                  {t("layout.feedback.attach")}
                </label>
                <div style={{ fontSize: "12px", lineHeight: 1.7, color: "var(--color-text-secondary)", margin: "4px 0 0 24px" }}>
                  {t("layout.feedback.attachHint")}
                </div>
                <details style={{ margin: "8px 0 0 24px" }}>
                  <summary style={{ cursor: "pointer", fontSize: "13px", color: "var(--color-text-info)" }}>{t("layout.feedback.previewToggle")}</summary>
                  {attach ? (
                    <div style={{ marginTop: "6px" }}>
                      {tooLarge && <div role="status" style={{ fontSize: "12px", color: "var(--color-text-warning)", marginBottom: "4px" }}>{t("layout.feedback.previewTooLarge")}</div>}
                      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", margin: 0, fontSize: "12px" }}>
                        {summary.map(line => (
                          <div key={line.id} style={{ display: "contents" }}>
                            <dt style={{ color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{t(`layout.feedback.sum.${line.id}`)}</dt>
                            <dd style={{ margin: 0, color: "var(--color-text-primary)", wordBreak: "break-word" }}>{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <details style={{ marginTop: "6px" }}>
                        <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("layout.feedback.previewJson")}（{bytes} bytes）</summary>
                        <pre style={{
                          margin: "4px 0 0", padding: "6px 8px", fontSize: "12px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "200px", overflowY: "auto",
                          background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}>{json}</pre>
                      </details>
                    </div>
                  ) : (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("layout.feedback.previewMinimal")}</div>
                  )}
                </details>
                <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: "8px 0 0 24px", lineHeight: 1.6 }}>{t("layout.feedback.privacy")}</div>
              </div>

              <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>{t("layout.feedback.namedNote")}</div>
              <SaveErrorBand message={error} />
            </div>
            <div style={{ ...MODAL_FOOTER_STYLE, display: "flex", alignItems: "center", gap: "10px", justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--color-border-primary)" }}>
              <span style={{ flex: 1, fontSize: "12px", color: "var(--color-text-tertiary)" }}>{t("layout.feedback.hotkey")}</span>
              <button type="button" onClick={() => void requestClose()} disabled={submitting}
                style={{ fontSize: "14px", padding: "6px 16px", borderRadius: "var(--radius-md)", cursor: "pointer", background: "var(--color-bg-secondary)", color: "var(--color-text-primary)", border: "1px solid var(--color-border-primary)" }}>
                {t("layout.feedback.cancel")}
              </button>
              <button type="button" onClick={() => void send()} disabled={submitting || trimmed === ""}
                style={{
                  fontSize: "14px", fontWeight: 600, padding: "6px 20px", borderRadius: "var(--radius-md)",
                  cursor: submitting ? "wait" : trimmed === "" ? "default" : "pointer", opacity: trimmed === "" || submitting ? 0.5 : 1,
                  background: "var(--color-brand)", color: "#fff", border: "1px solid var(--color-brand)",
                }}>
                {submitting ? t("layout.feedback.sending") : t("layout.feedback.send")}
              </button>
            </div>
          </>
        )}

        {tab === "mine" && (
          <div style={{ ...MODAL_BODY_STYLE, padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{t("layout.feedback.mine.hint")}</div>
            {mineError && <SaveErrorBand message={mineError} />}
            {mine === null && <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>…</div>}
            {mine !== null && mine.length === 0 && !mineError && (
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>{t("layout.feedback.mine.empty")}</div>
            )}
            {mine?.map(m => {
              const tone = STATUS_COLOR[m.status];
              return (
                <div key={m.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                    <span style={{
                      fontSize: "12px", padding: "1px 8px", borderRadius: "99px", fontWeight: 500,
                      background: tone === "secondary" ? "var(--color-bg-secondary)" : `var(--color-bg-${tone})`,
                      color: tone === "secondary" ? "var(--color-text-secondary)" : `var(--color-text-${tone})`,
                      border: `1px solid ${tone === "secondary" ? "var(--color-border-primary)" : `var(--color-border-${tone})`}`,
                    }}>{t(`layout.feedback.status.${m.status}`)}</span>
                    <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t(`layout.feedback.kind.${m.kind}`)}</span>
                    <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>{formatWhen(m.created_at)}</span>
                  </div>
                  <div style={{ fontSize: "13px", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-primary)" }}>{m.comment}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
