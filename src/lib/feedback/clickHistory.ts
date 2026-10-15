// src/lib/feedback/clickHistory.ts
//
// 直近のクリック5件の履歴（v3.157・CLAUDE.md Section 82）。ご意見のスナップショットの「再現の主軸」。
//
// 🔴 記録するのは「要素の種類（タグ名）・role・data-tour-id・座標・時刻」だけ。要素の文字・属性値・入力内容は
//    一切読まない（業務データ＝タスク名や顧客名がクリック先の文字に含まれるため）。キー入力は記録しない。
//    メモリ上に5件だけ保持し、送信時にスナップショットへ載せるときだけ外へ出る（localStorage 等へは書かない）。
// 🔴 ベル・ご意見のモーダル自身のクリックは記録しない（data-feedback-ui を持つ要素の内側）。
//    入口を押したクリックが履歴の末尾に混ざり、再現の手がかりを押し出すのを防ぐ。
// capture フェーズの1リスナーだけで、AuthenticatedApp が起動する（ゲストでは起動しない）。

import { FEEDBACK_CLICK_HISTORY_MAX } from "./constants";

/** この属性を持つ要素の内側のクリックは履歴に入れない（ベルのパネル・ご意見のモーダル・入口のボタン） */
export const FEEDBACK_UI_ATTR = "data-feedback-ui";

export interface ClickRecord {
  /** 要素の種類（タグ名の小文字。button・a・tr 等） */
  tag: string;
  /** role 属性（ARIA の role の語だけ。無ければ null） */
  role: string | null;
  /** 最も近い data-tour-id（画面の領域の目印。無ければ null） */
  tour: string | null;
  /** クリックした時刻（ms） */
  at: number;
  /** ビューポート内の位置（px）。キーボード操作によるクリックは null */
  x: number | null;
  y: number | null;
  /** そのときのビューポートの大きさ（比の計算用） */
  vw: number;
  vh: number;
}

export interface ClickTarget { tag: string; role: string | null; tour: string | null }

/** duck type（DOM の Element でも、テストの擬似要素でもよい） */
interface ElementLike {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => ElementLike | null;
}

const TAG_RE = /^[a-z][a-z0-9-]{0,24}$/;
const ROLE_RE = /^[a-z]{1,24}$/;
const TOUR_RE = /^[a-z0-9_-]{1,40}$/;
const MEANINGFUL_SELECTOR = "button,a,input,select,textarea,label,summary,[role],[data-tour-id],tr,li,td,th";

function token(v: string | null | undefined, re: RegExp): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return re.test(s) ? s : null;
}

/** クリックされた要素を、記録してよい情報（種類・role・領域の目印）だけに要約する。記録しない対象は null */
export function describeClickTarget(target: unknown): ClickTarget | null {
  const el = target as ElementLike | null;
  if (!el || typeof el.closest !== "function") return null;
  if (el.closest(`[${FEEDBACK_UI_ATTR}]`)) return null;
  const node = el.closest(MEANINGFUL_SELECTOR) ?? el;
  const tag = token(node.tagName, TAG_RE);
  if (!tag) return null;
  const role = token(node.getAttribute?.("role"), ROLE_RE);
  const tourHolder = node.getAttribute?.("data-tour-id") != null ? node : node.closest?.("[data-tour-id]") ?? null;
  const tour = token(tourHolder?.getAttribute?.("data-tour-id"), TOUR_RE);
  return { tag, role, tour };
}

/** 直近 max 件を保持する小さな記録器 */
export function createClickRecorder(max: number = FEEDBACK_CLICK_HISTORY_MAX) {
  let items: ClickRecord[] = [];
  return {
    push(rec: ClickRecord): void {
      items = [...items, rec].slice(-max);
    },
    /** 古い順のコピー */
    recent(): ClickRecord[] {
      return items.map((r) => ({ ...r }));
    },
    clear(): void {
      items = [];
    },
  };
}

const recorder = createClickRecorder();

export function getRecentClicks(): ClickRecord[] {
  return recorder.recent();
}

export function resetClickHistory(): void {
  recorder.clear();
}

export interface ClickHistoryDeps {
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
  now?: () => number;
  viewport?: () => { w: number; h: number };
}

/** 記録を始める。返り値の関数で止める（リスナーを必ず解除する）。履歴は開始時に空にする */
export function startClickHistory(deps: ClickHistoryDeps = {}): () => void {
  const target = deps.target ?? window;
  const now = deps.now ?? (() => Date.now());
  const viewport = deps.viewport ?? (() => ({ w: window.innerWidth, h: window.innerHeight }));
  recorder.clear();

  const onClick = (e: Event) => {
    const ev = e as MouseEvent;
    // プログラムが発行したクリック（label→input の転送など）は利用者の操作ではない
    if (ev.isTrusted === false) return;
    const d = describeClickTarget(ev.target);
    if (!d) return;
    const vp = viewport();
    // detail が 0 のクリックはキーボード操作（Enter・Space）。位置は意味を持たない
    const hasPoint = ev.detail !== 0 && Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY);
    recorder.push({
      ...d,
      at: now(),
      x: hasPoint ? Math.round(ev.clientX) : null,
      y: hasPoint ? Math.round(ev.clientY) : null,
      vw: vp.w,
      vh: vp.h,
    });
  };

  target.addEventListener("click", onClick, true);
  return () => {
    target.removeEventListener("click", onClick, true);
  };
}
