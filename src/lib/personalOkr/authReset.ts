// src/lib/personalOkr/authReset.ts
//
// 【設計意図】
// personalOkrUiStore はモジュール単位のシングルトン。明示のログアウトは
// window.location.reload() で状態ごと消えるが、セッション失効・別タブでのサインアウトでは
// アプリが再読み込みされず、同じタブで別のユーザーがログインすると前のユーザーの
// 個人OKR（評価を含む）がそのまま見えてしまう。認証イベントから「ストアを空に戻すか」を決める。
//
// ゲスト（サンプル閲覧）はメモリ上のサンプルを持っているため対象外。ゲスト用の匿名セッションの
// イベントも無視する（App.tsx の onAuthStateChange と同じ扱い）。

export interface AuthResetInput {
  prevUserId: string | null;
  event: string;
  userId: string | null;
  isAnonymous: boolean;
  isGuest: boolean;
}

export function decideAuthReset(i: AuthResetInput): { reset: boolean; userId: string | null } {
  if (i.isAnonymous || i.isGuest) return { reset: false, userId: i.prevUserId };
  if (i.event === "SIGNED_OUT") return { reset: true, userId: null };
  if (i.userId) {
    return { reset: i.prevUserId !== null && i.prevUserId !== i.userId, userId: i.userId };
  }
  return { reset: false, userId: i.prevUserId };
}
