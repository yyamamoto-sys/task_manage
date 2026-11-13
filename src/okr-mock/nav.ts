import type { OkrItem } from "./types";
import { krStyle } from "./fixtures";
import { moveText, type CurrentAssessment } from "./steps";
import type { Selection, ViewMode } from "./state";

/** 左のサイドバーの幅（本番 MainLayout の既定 160px・折りたたみ 48px に合わせる） */
export const SIDEBAR_W = 160;
export const SIDEBAR_W_COLLAPSED = 48;
/** この幅以下の画面では、サイドバーを最初から折りたたむ */
export const SIDEBAR_AUTO_COLLAPSE_PX = 900;
/** 流れの図は 760px 未満に縮めない。図＋詳細（360px）＋余白が収まる、メイン領域の中身の幅 */
const MAIN_NEEDS = 760 + 34 + 12 + 360;
const MAIN_SIDE_PADDING = 48;

export const sidebarWidth = (collapsed: boolean) => (collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W);

/** ウィンドウ幅がこの値以下だと、図と詳細は並べられない（詳細は右から出る引き出しになる）。mock4.css の2つの幅と同じ値 */
export const panelNarrowPx = (collapsed: boolean) => sidebarWidth(collapsed) + MAIN_SIDE_PADDING + MAIN_NEEDS - 1;

/** ページを切り替える。開いていた詳細は閉じる。同じページを押しても何も変えない */
export function switchPage(view: { mode: ViewMode; sel: Selection }, to: ViewMode): { mode: ViewMode; sel: Selection } {
  return view.mode === to ? view : { mode: to, sel: null };
}

export interface SidebarKr {
  id: string;
  label: string;
  text: string;
  color: string;
  pattern: number;
  /** AIの見立て。無いときは null（画面には「—」） */
  value: number | null;
  /** 前回から動いたときだけの「+2」。動いていない・前回なしは null（色で良し悪しは付けない） */
  tag: string | null;
  aria: string;
}

/** サイドバーのKR行。見立ては資料の確定から出るもので、仕事の登録範囲（利用の広がり）には左右されない */
export function sidebarKrRows(items: OkrItem[], assess: Record<string, CurrentAssessment | null>): SidebarKr[] {
  return items
    .filter((i) => i.kind === "kr")
    .map((k) => {
      const ca = assess[k.id] ?? null;
      const st = krStyle(k.id);
      const value = ca ? ca.cur.assessment.value : null;
      const move = ca && ca.prev ? ca.cur.assessment.value - ca.prev.assessment.value : null;
      const head = `${k.label} ${k.text}`;
      return {
        id: k.id,
        label: k.label,
        text: k.text,
        color: st.color,
        pattern: st.pattern,
        value,
        tag: move !== null && move !== 0 ? moveText(move) : null,
        aria: value === null ? `${head}：AIの見立て なし。押すと詳細を開きます` : `${head}：AIの見立て ${value}、前回から ${moveText(move)}。押すと詳細を開きます`,
      };
    });
}

/** その場所まで画面を送る。動きを減らす設定のときは滑らかにしない */
export function scrollToId(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el || typeof el.scrollIntoView !== "function") return;
  const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
}
