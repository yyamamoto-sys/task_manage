// src/lib/projectInvite/inviteRules.ts
//
// 【設計意図】
// プロジェクト招待（docs/dev/project-invite-plan.md）の検証ロジックのうち、
// 純粋関数として切り出せる部分（メールドメインの許可判定・有効期限の判定・コード生成の
// 長さ/文字種）の参照実装。
//
// 【本番の判定経路ではない】
// 実際の強制は supabase/migrations/20260810_add_project_invites.sql の
// create_project_invite() / accept_project_invite()（SQL・SECURITY DEFINER）が担う。
// このリポジトリのテスト環境（Vitest/Node）は実際のPostgresを起動してSQL関数を直接
// 検証する手段が無いため、SQL側のロジックと手順を1対1で対応させた参照実装をここに用意し、
// 境界値・エッジケースをテストで固定する（supabase/functions/ai-consult/guestQuota.ts の
// simulateConsumeGuestAiQuota() と同じ位置づけ。CLAUDE.md Section 23参照）。
// **SQL側（create_project_invite/accept_project_invite）を変更したら、この参照実装と
// コメントの対応も必ず一緒に見直すこと。**

/**
 * 許可メールドメインの既定値。create_project_invite() 内の v_allowed_domains と
 * 同じ値を保つこと（変更する場合は両方直す。複数指定できる形にしている）。
 */
export const DEFAULT_ALLOWED_INVITE_EMAIL_DOMAINS = ["amita-net.co.jp"];

/**
 * メールアドレスの「最後の@より後ろ」だけを安全に取り出す。
 *
 * 複数の@を含む不正な入力（例: "a@amita-net.co.jp@evil.com"）に対して、最初の@で
 * 区切ると誤って許可ドメインの文字列を取り出してしまう。SQL側
 * （substring(email from '@([^@]+)$')）と同じ考え方で「末尾のドメインだけ」を返す。
 */
function extractDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at === -1 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1);
  return domain === "" ? null : domain;
}

/**
 * 招待先メールアドレスのドメインが許可リストに含まれるかを判定する。
 *
 * 🔴 「@以降が完全一致」で判定する（部分一致・前方一致・後方一致にしない）。
 * "user@amita-net.co.jp.evil.com" のようなドメインを後方一致（endsWith）で判定すると
 * 通ってしまうため、必ず配列の要素と文字列として完全に等しいかどうかだけを見る。
 * サブドメイン（"sub.amita-net.co.jp"）も自動では許可しない
 * （許可したい場合は allowedDomains にサブドメインを明示的に追加する運用にする）。
 */
export function isAllowedInviteEmailDomain(
  email: string,
  allowedDomains: string[] = DEFAULT_ALLOWED_INVITE_EMAIL_DOMAINS,
): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  const normalizedAllowed = allowedDomains.map(d => d.trim().toLowerCase());
  return normalizedAllowed.includes(domain);
}

/** 招待コードの有効期限（発行から24時間後）を計算する。SQL側は now() + interval '24 hours'。 */
export function computeInviteExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
}

/** 招待コードが期限切れかどうかを判定する（expiresAt <= now と同じ境界。SQL側に合わせる）。 */
export function isInviteExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export const INVITE_CODE_LENGTH = 64;
const INVITE_CODE_PATTERN = /^[0-9a-f]+$/;

/**
 * 招待コードの生成方式の参照実装。
 * SQL側（create_project_invite）はpgcryptoに依存せず、PostgreSQL 13+のコア組み込み関数
 * gen_random_uuid()を2回連結して64桁の16進文字列を作る（ハイフンを除去）。ここでは
 * Web Crypto の crypto.randomUUID()（Node 19+・主要ブラウザで利用可）で同じ手順を再現し、
 * 生成結果の長さ・文字種をテストで固定する。
 * **この関数はクライアント側で招待コードを生成するためのものではない**（コードは必ず
 * サーバー側=SQL関数が生成し、平文は戻り値で1度だけ返す。設計書§6）。
 */
export function generateInviteCode(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

/** 招待コードの見た目上の形式（長さ・16進数）を検証する。ハッシュ照合の代わりにはならない。 */
export function isValidInviteCodeFormat(code: string): boolean {
  return code.length === INVITE_CODE_LENGTH && INVITE_CODE_PATTERN.test(code);
}
