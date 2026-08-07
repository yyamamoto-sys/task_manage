// supabase/functions/ai-consult/guestQuota.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）のAI利用回数制限のうち「しきい値を超えたかどうかの判定」だけを
// 切り出した純粋関数。カウント自体（原子的なインクリメント）は
// supabase/migrations/20260807_add_guest_ai_quota.sql の consume_guest_ai_quota()
// が担い、「常に無条件でインクリメントしてインクリメント後の件数を返す」だけをする。
// 判定と加算を別々のクエリ（SELECTで確認→UPDATEで加算）に分けると、その間に別リクエストが
// 割り込んで上限を超えてしまう（TOCTOUレース）。consume_guest_ai_quota() の加算は
// Postgresの一意インデックスの行ロックで直列化されるため、「呼び出しごとに一意で単調増加する
// 件数」を必ず受け取れる。この関数はその結果に対して「しきい値（3/日/ブラウザ・10/日/全体）を
// 超えたか」を判定するだけなので、TOCTOUレースの影響を受けない。
//
// しきい値の数字はこのファイルにも持たない。呼び出し元（index.ts）の定数
// GUEST_AI_PER_BROWSER_DAILY_LIMIT / GUEST_AI_GLOBAL_DAILY_LIMIT が唯一の管理場所。
//
// Deno依存・Supabase依存が無い純粋関数のため、Vitestからこのファイルをそのまま
// import してテストできる（src/lib/ai/__tests__/guestQuota.test.ts 参照）。

export interface GuestQuotaDecision {
  allowed: boolean;
  reason: "ok" | "per_browser" | "global";
}

/**
 * @param browserCountAfterIncrement consume_guest_ai_quota() が返す、今回の呼び出しを
 *   含めた「このブラウザ（匿名Authユーザー）の本日の件数」
 * @param globalCountAfterIncrement 同じく「全ゲスト共通・本日の件数」
 * @param perBrowserLimit 1ブラウザあたりの1日の上限
 * @param globalLimit 全ゲスト共通の1日の上限
 */
export function decideGuestAiQuota(
  browserCountAfterIncrement: number,
  globalCountAfterIncrement: number,
  perBrowserLimit: number,
  globalLimit: number,
): GuestQuotaDecision {
  // 全体枠の判定を優先する：このブラウザ自身は個人枠内でも、共有枠（コストの天井）が
  // 尽きていれば「全体が埋まっている」ことを正しく伝える（逆の優先順位だと、実際は
  // 全体枠切れなのに「あなたが使い切った」という誤った案内になってしまう）。
  if (globalCountAfterIncrement > globalLimit) return { allowed: false, reason: "global" };
  if (browserCountAfterIncrement > perBrowserLimit) return { allowed: false, reason: "per_browser" };
  return { allowed: true, reason: "ok" };
}
