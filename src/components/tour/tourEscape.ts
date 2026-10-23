// src/components/tour/tourEscape.ts
//
// 【設計意図・v3.186】ツアー中の Esc の扱い（純関数・テスト用）。
// ・IME の変換中の Esc（変換の取り消し）では終了しない。ご意見の入力欄のように入力しながら進む段
//   （keepFocus）で、日本語の変換を取り消しただけでツアーが終わっていた。
// ・開いているドロップダウン（CustomSelect・role="listbox"）があるときは、そちらを閉じる Esc に任せる。
// ・ツアーを終えるときは Esc をここで止める（lib/overlayEscape.ts と同じ流儀）。背後のモーダル
//   （ご意見の送信画面など）も同じ Esc で一緒に閉じていた。1回目の Esc はツアーだけ終える。
// window の capture 段階で受ける前提（TourProvider）。

import { closeOnEscapeAndStop, type EscapeLikeEvent } from "../../lib/overlayEscape";

export function handleTourEscape(e: EscapeLikeEvent, hasOpenDropdown: boolean, end: () => void): boolean {
  if (hasOpenDropdown) return false;
  return closeOnEscapeAndStop(e, end);
}
