// src/lib/account/signedOutCleanup.ts
//
// 【設計意図】
// 明示のログアウト（handleLogout）は window.location.reload() で前のユーザーの状態を全部捨てる。
// しかしセッション失効・別タブでのサインアウトでは SIGNED_OUT が届くだけでアプリは再読み込みされず、
// appStore（前ユーザーのタスク・PJ・メンバー）・localStorage の「前回ユーザー」・各ストアがそのまま残る。
// 同じタブで別の人がログインすると、autoMatch の「前回ユーザー」フォールバックが前の人の
// メンバー行を選んでしまい、読み込み前の短い間は前の人のデータも見える。
// 迷ったらリロードを選ぶ方針（handleLogout と同じ）で、認証済みだったタブの SIGNED_OUT は再読み込みで切る。

export interface SignedOutInput {
  event: string;
  /** このタブが実ユーザーとして認証済みだったか（起動時の匿名セッション掃除や未ログイン画面での SIGNED_OUT は対象外） */
  wasAuthenticated: boolean;
  /** パスワード再設定画面の間は、画面自身が signOut と印の後始末を行うので割り込まない */
  recoveryActive: boolean;
  isGuest: boolean;
}

export function shouldReloadOnSignedOut(i: SignedOutInput): boolean {
  return i.event === "SIGNED_OUT" && i.wasAuthenticated && !i.recoveryActive && !i.isGuest;
}
