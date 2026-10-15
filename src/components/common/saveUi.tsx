// src/components/common/saveUi.tsx
//
// 【設計意図・v3.155】設定画面の「保存の見せ方」を1か所にまとめた部品。
// 基準（docs/dev/設計仕様_設定画面リニューアル_20261015.md §3）：
//  - 入力の途中状態が生まれない操作（トグル・選択肢・色）は即時保存。成功は操作した欄の横に
//    「✓ 保存しました」を1.5秒（SavedFlash）。失敗は値を操作前に戻してトースト。
//  - 入力の途中状態が生まれる操作（文字・数値・日付・複数欄・パスワード）は保存ボタン（SaveButton）。
//    状態は3つに固定：未変更＝「✓ 保存済み」(disabled)／変更あり＝「保存」＋左に「未保存の変更があります」／
//    保存中＝「保存中…」(disabled・cursor wait)。🚫（not-allowed）は使わない（Section 48）。
//    成功はトースト1つ、失敗はフォーム直下の永続のエラー帯（SaveErrorBand・Section 15・45）。入力は保持する。
//  - 追加フォーム（mode="add"）の文言は「追加」。入力が足りないときは disabled（cursor default）。
//  - 単一行入力の Enter と Ctrl/Cmd+Enter で保存（handleSaveShortcut）。IME 変換確定の Enter は無視（Section 44）。

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useT } from "../../hooks/useT";

export const SAVED_FLASH_MS = 1500;

/** 即時保存の成功表示（「✓ 保存しました」）を1.5秒だけ出す。アンマウントでタイマーを解除する */
export function useSavedFlash(): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), SAVED_FLASH_MS);
  }, []);
  return [visible, flash];
}

/** 欄ごとに別々に出したい即時保存の表示用（キーで「どの欄が保存されたか」を持つ） */
export function useSavedFlashKey(): [string | null, (key: string) => void] {
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback((k: string) => {
    setKey(k);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setKey(null), SAVED_FLASH_MS);
  }, []);
  return [key, flash];
}

export function SavedFlash({ visible }: { visible: boolean }) {
  const t = useT();
  if (!visible) return null;
  return (
    <span role="status" style={{ fontSize: "12px", color: "var(--color-text-success)", whiteSpace: "nowrap" }}>
      ✓ {t("layout.settings.save.flash")}
    </span>
  );
}

export type SaveButtonState = "saved" | "ready" | "saving";

/** 保存ボタンの状態の決定（純粋関数。テスト対象） */
export function resolveSaveButtonState(
  opts: { mode?: "edit" | "add"; dirty: boolean; saving?: boolean },
): SaveButtonState {
  if (opts.saving) return "saving";
  if ((opts.mode ?? "edit") === "edit" && !opts.dirty) return "saved";
  return "ready";
}

interface SaveButtonProps {
  mode?: "edit" | "add";
  /** edit：保存済み内容と差分があるか。add：追加できる入力が揃っているか */
  dirty: boolean;
  saving?: boolean;
  /** 差分があっても押せない事情（必須項目が空など。状態は「保存」のまま disabled にする） */
  blocked?: boolean;
  onClick: () => void;
  /** ボタンの見た目のベース（設定画面は settingsUi、管理ページは adminStyles の primaryBtnStyle） */
  buttonStyle: CSSProperties;
  /** 「保存」の代わりの文言（例：パスワードを変更） */
  label?: string;
  type?: "button" | "submit";
}

export function SaveButton({ mode = "edit", dirty, saving = false, blocked = false, onClick, buttonStyle, label, type = "button" }: SaveButtonProps) {
  const t = useT();
  const state = resolveSaveButtonState({ mode, dirty, saving });
  const isAdd = mode === "add";
  const disabled = state !== "ready" || blocked || (isAdd && !dirty);
  const text = state === "saving" ? t("layout.settings.save.saving")
    : state === "saved" ? `✓ ${t("layout.settings.save.saved")}`
    : label ?? (isAdd ? t("layout.settings.save.add") : t("layout.settings.save.save"));
  const showUnsaved = !isAdd && state === "ready";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      {showUnsaved && (
        <span role="status" style={{ fontSize: "12px", color: "var(--color-text-warning)" }}>
          {t("layout.settings.save.unsaved")}
        </span>
      )}
      <button
        type={type}
        onClick={type === "button" ? onClick : undefined}
        disabled={disabled}
        title={state === "saved" ? t("layout.settings.save.savedTitle") : undefined}
        style={{
          ...buttonStyle,
          opacity: state === "saved" ? 0.6 : disabled ? 0.5 : 1,
          cursor: state === "saving" ? "wait" : disabled ? "default" : "pointer",
        }}
      >
        {text}
      </button>
    </span>
  );
}

/** 保存に失敗したときの永続のエラー帯（トーストのように消えない）。入力はそのまま残す */
export function SaveErrorBand({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" style={{
      fontSize: "12px", lineHeight: 1.7, padding: "8px 12px",
      background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
      border: "1px solid var(--color-border-danger)", borderRadius: "var(--radius-md)",
      whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      {message}
    </div>
  );
}

/**
 * 単一行入力の Enter と Ctrl/Cmd+Enter で保存する。IME 変換確定の Enter は無視する。
 * テキストエリア・チェックボックス・ボタン上の Enter は対象にしない（Ctrl/Cmd+Enter だけがどこからでも効く）。
 */
export function handleSaveShortcut(e: KeyboardEvent, save: () => void): void {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  const inputType = target.tagName === "INPUT" ? (target as HTMLInputElement).type : "";
  const isSingleLineInput = target.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range"].includes(inputType);
  if (e.ctrlKey || e.metaKey || isSingleLineInput) {
    e.preventDefault();
    save();
  }
}
