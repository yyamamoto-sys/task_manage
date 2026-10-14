// src/lib/list/inlineAddRegistry.ts
//
// 【設計意図】
// FABの「＋ タスクを追加」から、リストビューの追加行へフォーカスを渡すための小さなレジストリ。
// ListView が（PC幅・編集可のときだけ）ハンドラを登録し、MainLayout のFABが問い合わせる
// pull 型（unsavedEditorRegistry と同じ流儀。zustand に入れるほどの業務データではない）。
// 登録が無い・ハンドラが false を返した場合は未処理＝呼び出し側が従来どおりポップアップを開く。

type Handler = (projectId: string | null) => boolean;

let handler: Handler | null = null;

/** 登録して解除関数を返す。後から登録されたものが勝つ（古い解除関数は新しい登録を消さない）。 */
export function registerListInlineAdd(h: Handler): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

/** 処理できたら true。false のときは呼び出し側がモーダルを開く。 */
export function requestListInlineAdd(projectId: string | null): boolean {
  return handler ? handler(projectId) : false;
}

export function _resetListInlineAddForTest(): void {
  handler = null;
}
