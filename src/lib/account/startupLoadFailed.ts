// src/lib/account/startupLoadFailed.ts
//
// 【設計意図】
// 初回のデータ取得（members 等）が失敗すると members は空のままになり、isWizardDone が false になる。
// そのまま「システム空判定 → アクセス拒否画面」へ進むと、通信の失敗なのに
// 「このメールアドレスはまだメンバーとして登録されていません」と案内してしまう。
// 取得に失敗していて、まだ誰としてもログインしていないときは、アクセス拒否ではなく取得失敗の画面を出す。

export interface StartupLoadFailedInput {
  loading: boolean;
  isWizardDone: boolean;
  hasCurrentUser: boolean;
  error: string | null;
}

export function shouldShowStartupLoadFailed(i: StartupLoadFailedInput): boolean {
  return !i.loading && !i.isWizardDone && !i.hasCurrentUser && !!i.error;
}
