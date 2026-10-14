// src/lib/docs/guideAccess.ts
//
// 【設計意図】ガイド記事を「この人に見せるか」の唯一の判定元。
// 管理者向けの記事（audience が admin だけ）を一般メンバーの目次・リンク・？ボタン・HTML保存から外す。
//
// 【限界】これは表示の制御であって秘匿ではない。記事の本文は JS バンドルに丸ごと入っており、
// 開発者ツールで読もうと思えば一般メンバーにも読める。秘密（鍵・内部URL・個人情報）は記事に書かない。
//
// HelpButton は常時ロードされるため、このファイルは manifest（全記事本文）を import しない。

import type { DocEntry } from "./types";
import { isGuestMember } from "../guestMode";

export interface GuideViewer {
  isAdmin: boolean;
}

/** 管理者・保守担当（maintainer＝ガイドの書き手）だけが対象の記事か。audience 未指定・空は全員向け（manifest 側で ["all"] になる） */
export function isAdminOnlyDoc(doc: Pick<DocEntry, "audience">): boolean {
  const a = doc.audience;
  return Array.isArray(a) && a.length > 0 && a.every(x => x === "admin" || x === "maintainer");
}

/** この閲覧者に記事を見せてよいか。doc が無い（undefined）場合は false */
export function canViewGuideDoc(doc: Pick<DocEntry, "audience"> | undefined | null, viewer: GuideViewer): boolean {
  if (!doc) return false;
  return viewer.isAdmin || !isAdminOnlyDoc(doc);
}

export function filterViewableDocs<T extends Pick<DocEntry, "audience">>(docs: readonly T[], viewer: GuideViewer): T[] {
  return docs.filter(d => canViewGuideDoc(d, viewer));
}

/** ガイドを管理者として見せる人か（ゲストは管理者権限を持っていても対象外）。MainLayout・HTML保存・？ボタンで共有 */
export function isGuideAdmin(
  user: { id: string; is_admin?: boolean; is_super_admin?: boolean } | null | undefined,
): boolean {
  if (!user || isGuestMember(user)) return false;
  return user.is_admin === true || user.is_super_admin === true;
}
