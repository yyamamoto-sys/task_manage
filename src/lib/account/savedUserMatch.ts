// localStorage の「前回ユーザー」で自動ログインしてよいかの判定（巡回56回目 M72・v3.176）。
//
// 【なぜ】以前は Auth メールが members と合わなくても、前回ユーザーの id が members に居れば黙って
// そのメンバー行でログインしていた。同じブラウザで別の人（個人Gmail等）が入ると前の人の行になる。
// Auth メールと前回ユーザーのメールが一致するときだけ許可する。メール未設定の行は一致を確認できない
// ため対象外（メンバー選択画面から本人が選ぶ。選ぶと handleLogin が Auth メールを補完する）。
import type { Member } from "../localData/types";

const norm = (s: string) => s.trim().toLowerCase();

export function resolveSavedUserAutoLogin(
  savedUserId: string | null | undefined,
  activeMembers: Member[],
  authEmail: string | null | undefined,
): Member | null {
  if (!savedUserId || !authEmail || !norm(authEmail)) return null;
  const member = activeMembers.find(m => m.id === savedUserId);
  if (!member || !member.email || !norm(member.email)) return null;
  return norm(member.email) === norm(authEmail) ? member : null;
}
