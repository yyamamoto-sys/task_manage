// 開いているドロップダウン（CustomSelect のパネル）が Esc を受け止めるための判定（M70）。
// モーダルの Esc は document の keydown（バブリング）で待っている。ドロップダウンは後から開くので
// 同じ document の listener では後ろに並び、stopImmediatePropagation でもモーダル側を止められない。
// そこでパネル側は window の capture 段階で受け、モーダルへ届く前に止める。
// これでモーダルごとに判定を足さなくても、全モーダルで「1回目の Esc はドロップダウンだけ閉じる」になる。

export interface EscapeLikeEvent {
  key: string;
  isComposing?: boolean;
  preventDefault: () => void;
  stopImmediatePropagation: () => void;
}

/** Esc ならパネルを閉じてイベントをここで止める。止めたら true。IME の変換中の Esc は触らない。 */
export function closeOnEscapeAndStop(e: EscapeLikeEvent, close: () => void): boolean {
  if (e.key !== "Escape" || e.isComposing) return false;
  close();
  e.preventDefault();
  e.stopImmediatePropagation();
  return true;
}
