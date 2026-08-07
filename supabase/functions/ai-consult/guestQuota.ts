// supabase/functions/ai-consult/guestQuota.ts
//
// 【設計意図・v3.30で役割変更】
// ゲスト（サンプル閲覧）のAI利用回数制限の「判定＋条件付き加算」は、v3.30以降
// consume_guest_ai_quota()（supabase/migrations/20260807_add_guest_ai_quota.sql）の中で
// 完結している（上限未満のときだけ加算し、拒否ならどちらのカウンタも進めない。TOCTOUレース
// 防止のため判定と加算を同一SQL文に閉じる必要があるため）。index.ts は RPC の戻り値
// （allowed / reason）をそのまま使うだけで、この関数を呼ばない。
//
// 【この関数が存在する理由（本番の判定経路ではない）】
// SQL側の状態遷移ロジック（条件付き加算・拒否時の全体枠の補償）は、このリポジトリの
// テスト環境（Vitest/Node）から実際のPostgresを起動して検証する手段が無いため、直接は
// テストできない。そのため、SQL関数と**手順を1対1で対応させた**参照実装をここに用意し、
// 境界値（3回目/4回目・10回目/11回目）・「拒否がどちらのカウンタも進めないこと」・
// 「片方が拒否されたときにもう片方の補償が効くこと」をVitestで固定する
// （src/lib/ai/__tests__/guestQuota.test.ts）。
//
// **SQL側（consume_guest_ai_quota）を変更したら、この関数とコメントの対応も必ず
// 一緒に見直すこと。** ズレるとテストが「安全である」と言い続けたまま実体だけ壊れる。

export interface GuestQuotaState {
  /** そのブラウザ（匿名Authユーザー）の当日の呼び出し成功回数 */
  browserCount: number;
  /** 全ゲスト共通・当日の呼び出し成功回数 */
  globalCount: number;
}

export interface GuestQuotaConsumeResult {
  allowed: boolean;
  reason: "ok" | "per_browser" | "global";
  /** 加算後の状態。拒否時は補償済み（=呼び出し前と全く同じ値）を返す。 */
  nextState: GuestQuotaState;
}

/**
 * consume_guest_ai_quota() のSQLロジックをTypeScriptで再現した参照実装。
 * 手順は完全に対応させている：
 *   ① 全体枠を条件付きで加算 → 上限到達なら reason="global"（ブラウザ別枠には触れない）
 *   ② ブラウザ別枠を条件付きで加算 → 上限到達なら①の加算を取り消して reason="per_browser"
 *   ③ 両方通れば allowed=true
 */
export function simulateConsumeGuestAiQuota(
  state: GuestQuotaState,
  perBrowserLimit: number,
  globalLimit: number,
): GuestQuotaConsumeResult {
  // ① 全体枠（コストの天井）を先に条件付きで加算する。
  if (state.globalCount >= globalLimit) {
    // 尽きている。ブラウザ別カウンタには一切触れない＝状態は不変。
    return { allowed: false, reason: "global", nextState: { ...state } };
  }
  const globalCountAfter = state.globalCount + 1;

  // ② ブラウザ別（匿名Authユーザー別）の上限を条件付きで加算する。
  if (state.browserCount >= perBrowserLimit) {
    // 拒否。①で加算した全体枠を取り消す（補償）→ 呼び出し前と全く同じ状態に戻す。
    return { allowed: false, reason: "per_browser", nextState: { ...state } };
  }
  const browserCountAfter = state.browserCount + 1;

  return {
    allowed: true,
    reason: "ok",
    nextState: { browserCount: browserCountAfter, globalCount: globalCountAfter },
  };
}
