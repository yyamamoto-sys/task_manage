// src/lib/projectInvite/loggedInInviteFlow.ts
//
// 【設計意図】
// Phase 4（山本さんの指摘）：ログイン済みの既存メンバーが招待リンク（?invite=<code>）を
// 開いた場合の受け入れ経路。Phase 3（pendingInvite.ts）は「未ログイン→signUp」経路専用で、
// 既にmembersに登録済みのユーザーがこのURLを開いても何も起きない（App.tsxのautoMatch()が
// 成功して通常画面に入り、招待コードはURLに残ったまま無視される）。
//
// ここに置く純粋関数は、App.tsx（AuthenticatedApp）のuseEffectが使う判定・組み立て処理の
// うち、副作用を持たない部分を切り出したもの（テスト対象）。実際のRPC呼び出し
// （acceptProjectInvite）・確認ダイアログ（confirmDialog）・リロード等の副作用はApp.tsx側に
// 残す。

import type { Member } from "../localData/types";
import type { AcceptProjectInviteParams } from "../supabase/projectInviteStore";

/**
 * ログイン済み・membersに登録済みのユーザーに対して、URLの招待コードを
 * 自動受諾フローの対象にするかどうかを判定する。
 * - 招待コードが無い（null/空文字）→ 対象外
 * - currentUser が未確定（まだ自動マッチング中等）→ 対象外
 *   （currentUserが確定してから初めて「この人の情報で受諾してよいか」を判断できるため）
 */
export function shouldPromptLoggedInInviteAccept(
  inviteCode: string | null,
  currentUser: Member | null,
): boolean {
  if (!inviteCode || inviteCode.trim() === "") return false;
  if (!currentUser) return false;
  return true;
}

/**
 * 既存メンバー（currentUser）の現在の表示名・略称・イニシャル・色をそのまま使って
 * accept_project_invite() の呼び出しパラメータを組み立てる。
 *
 * 🔴 これらの値は既存メンバー分岐（supabase/migrations/20260812_accept_invite_for_existing_member.sql）
 * ではSQL側で無視される（既存の表示名・色を上書きしないため）。ここで渡すのは、
 * 関数の必須引数チェック（空文字なら例外）に引っかからないようにするための形式的な値であり、
 * 実際にDBへ書き込まれることは無い。
 */
export function buildAcceptPayloadForExistingMember(
  code: string,
  authEmail: string,
  currentUser: Member,
): AcceptProjectInviteParams {
  return {
    code,
    email: authEmail,
    displayName: currentUser.display_name,
    shortName: currentUser.short_name,
    initials: currentUser.initials,
    colorBg: currentUser.color_bg,
    colorText: currentUser.color_text,
  };
}

/**
 * URLから invite クエリパラメータだけを取り除いた文字列を返す（他のクエリ・ハッシュは
 * 維持する）。招待の受諾を試みた（成功・失敗・キャンセルのいずれでも）後にURLから
 * コードを消し、リロードや再訪問で同じ確認・同じRPC呼び出しが繰り返されないようにする。
 * 不正なURL文字列が渡された場合は、例外を投げずそのまま返す（安全側フォールバック）。
 */
export function stripInviteParamFromUrl(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has("invite")) return href;
    url.searchParams.delete("invite");
    return url.toString();
  } catch {
    return href;
  }
}
