// src/lib/personalOkr/resyncRegistry.ts
//
// 【設計意図・M65】
// v3.171 の「非表示10分→復帰時の全件再取得」（App.tsx の createResyncRunner）に個人OKRも乗せるための
// 連絡口。個人OKRのストアは「自分」タブを開いたときに初めて読み込まれる（Section 19）ため、App.tsx は
// ストアを import できない。ストアが読み込まれたときに自分の再取得をここへ登録し、App.tsx は
// この小さなモジュールだけを呼ぶ。ストアが未読み込みなら何も起きない（問い合わせも増えない）。

let handler: (() => void) | null = null;

export function setPersonalOkrResyncHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function requestPersonalOkrResync(): void {
  handler?.();
}
