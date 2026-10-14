// src/lib/autoUpdate.ts
//
// 【設計意図・v3.152】操作が無いときに黙って最新の版へ切り替える判定（CLAUDE.md Section 63「自動更新」）。
// 判定は純粋関数 shouldAutoReload。副作用（タイマー・DOM・sessionStorage）は ReloadNoticeBanner 側と
// 下の小さなヘルパーが持つ。Supabase の Disk IO 対策として、古い画面（Realtime のつなぎ直しをする旧版）を減らすのが目的。

import { compareVersions } from "./reloadNotice";

/** 最後の操作からこの時間以上たったら自動更新してよい（ちょうど10分は含む） */
export const AUTO_UPDATE_IDLE_MS = 10 * 60 * 1000;
/** 同じサーバー版に対する自動再読み込みの最短間隔（CDN の反映遅れで連続 reload しないため） */
export const AUTO_RELOAD_COOLDOWN_MS = 30 * 60 * 1000;
/** 条件の再評価間隔 */
export const AUTO_UPDATE_EVAL_INTERVAL_MS = 60 * 1000;

/** version.json を取得できた直後に ReloadNoticeBanner が流し、条件を即再評価させるイベント */
export const AUTO_UPDATE_EVALUATE_EVENT = "app:auto-update-evaluate";
export const AUTO_RELOAD_STORAGE_KEY = "auto_reload_v1";

export interface AutoReloadRecord {
  version: string;
  at: number;
}

export interface AutoReloadInput {
  /** version.json の version。取得前・失敗時は null */
  serverVersion: string | null;
  currentVersion: string;
  /** 最後の利用者の操作からの経過ミリ秒 */
  idleMs: number;
  hasUnsaved: boolean;
  inputFocused: boolean;
  modalOpen: boolean;
  aiBusy: boolean;
  isGuest: boolean;
  /** 直近の自動再読み込みの記録（なければ null）。now は呼び出し側が渡す */
  lastAutoReload: AutoReloadRecord | null;
  now: number;
}

export function shouldAutoReload(i: AutoReloadInput): boolean {
  if (i.serverVersion === null) return false;
  if (compareVersions(i.serverVersion, i.currentVersion) <= 0) return false;
  if (i.idleMs < AUTO_UPDATE_IDLE_MS) return false;
  if (i.hasUnsaved || i.inputFocused || i.modalOpen || i.aiBusy || i.isGuest) return false;
  const last = i.lastAutoReload;
  if (last && last.version === i.serverVersion && i.now - last.at < AUTO_RELOAD_COOLDOWN_MS) return false;
  return true;
}

// ---- AI パネルの「会話中・返答待ち」登録（再読み込みで会話が消えるため） ----
const aiBlockers = new Map<string, boolean>();

export function setAutoUpdateAiBlock(id: string, active: boolean): void {
  if (active) aiBlockers.set(id, true);
  else aiBlockers.delete(id);
}

export function isAutoUpdateAiBusy(): boolean {
  return aiBlockers.size > 0;
}

// ---- DOM・storage の読み取り ----

/** 入力欄・テキストエリア・select・contenteditable にフォーカスがあるか */
export function isInputFocused(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el || el === doc.body) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** モーダルが開いているか。ConfirmModal 等は role=dialog／aria-modal、独自モーダルは modalOverlayStyle（position:fixed＋inset:0）で描画する */
export function isModalOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [aria-modal="true"], [style*="inset: 0"]') !== null;
}

export function readAutoReloadRecord(storage: Pick<Storage, "getItem"> = sessionStorage): AutoReloadRecord | null {
  try {
    const raw = storage.getItem(AUTO_RELOAD_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<AutoReloadRecord>;
    if (typeof v.version === "string" && typeof v.at === "number") return { version: v.version, at: v.at };
  } catch { /* 壊れた記録は無いものとして扱う */ }
  return null;
}

/** 書けたら true。書けない環境ではループ防止が効かないため、呼び出し側は false なら reload しない */
export function writeAutoReloadRecord(rec: AutoReloadRecord, storage: Pick<Storage, "setItem"> = sessionStorage): boolean {
  try { storage.setItem(AUTO_RELOAD_STORAGE_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}
