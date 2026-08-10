// src/lib/projectInvite/pendingInvite.ts
//
// 【設計意図】
// 3-2の🔴要件（メール確認が有効な環境への対応）。signUp() の直後、確認メールが届く前の
// この端末に「まだ受諾できていない招待」を一時保持する。メール確認後にこの端末で再度
// 認証済み状態になったとき（App.tsx の AuthenticatedApp。詳細はそちらのコメント参照）に
// 自動で accept_project_invite() を呼ぶために使う。
//
// 【設計判断：なぜ signUp 成功時点で無条件（needsConfirmation の値に関わらず）に保存するか】
// needsConfirmation=false（メール確認不要な環境）の場合、App.tsx の onAuthStateChange
// リスナーが signUp 成功と同時に authenticated=true を検知し、この登録フォームが
// accept_project_invite() を呼び終える前に unmount されるレースが起こり得る
// （signUp と同時にSupabase Authのセッションが張られるため）。accept_project_invite() の
// 呼び出しをフォーム自身の責務にせず、常に「AuthenticatedApp側の唯一の受け口」で行う
// ことで、needsConfirmation の有無に関わらず単一の実装・単一のテスト対象にする
// （実装は App.tsx 参照。設計判断の詳細はそちらにも記載）。
//
// 🔴 保存するのはこの登録フォームで本人が入力した内容のみ。パスワードは保存しない。
// 招待コード自体も24時間で失効する使い捨て値であり、機密性は本人のメールアドレス程度に
// 留まる（localStorageに残る情報の機密度としては既存の CURRENT_USER 等と同水準）。

import { KEYS } from "../localData/localStore";

export interface PendingProjectInvite {
  code: string;
  email: string;
  displayName: string;
  shortName: string;
  initials: string;
  colorBg: string;
  colorText: string;
  savedAt: string;
}

/**
 * localStorageから読み出した生の文字列を検証する純粋関数（テスト対象）。
 * 壊れたJSON・必須フィールド欠落は例外を投げず黙って null を返す
 * （起動時に呼ばれるため、ここで例外を投げてアプリを止めてはいけない）。
 */
export function parsePendingProjectInvite(raw: string | null): PendingProjectInvite | null {
  if (!raw) return null;
  let obj: Partial<PendingProjectInvite>;
  try {
    obj = JSON.parse(raw) as Partial<PendingProjectInvite>;
  } catch {
    return null;
  }
  if (
    typeof obj.code !== "string" || obj.code === "" ||
    typeof obj.email !== "string" || obj.email === "" ||
    typeof obj.displayName !== "string" || obj.displayName === "" ||
    typeof obj.shortName !== "string" || obj.shortName === "" ||
    typeof obj.initials !== "string" ||
    typeof obj.colorBg !== "string" ||
    typeof obj.colorText !== "string" ||
    typeof obj.savedAt !== "string"
  ) {
    return null;
  }
  return {
    code: obj.code,
    email: obj.email,
    displayName: obj.displayName,
    shortName: obj.shortName,
    initials: obj.initials,
    colorBg: obj.colorBg,
    colorText: obj.colorText,
    savedAt: obj.savedAt,
  };
}

export function savePendingProjectInvite(data: PendingProjectInvite): void {
  localStorage.setItem(KEYS.PENDING_PROJECT_INVITE, JSON.stringify(data));
}

export function loadPendingProjectInvite(): PendingProjectInvite | null {
  return parsePendingProjectInvite(localStorage.getItem(KEYS.PENDING_PROJECT_INVITE));
}

export function clearPendingProjectInvite(): void {
  localStorage.removeItem(KEYS.PENDING_PROJECT_INVITE);
}
