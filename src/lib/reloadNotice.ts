// src/lib/reloadNotice.ts
//
// 【設計意図・v3.125】
// 「再読み込みが必要な更新が出たとき、開いている利用者にだけ再読み込みを促す」判定を
// 純粋関数に切り出したもの（CLAUDE.md Section 63参照）。副作用（fetch・setInterval・
// visibilitychange購読）は src/components/common/ReloadNoticeBanner.tsx 側が持つ。
//
// 🔴 出す条件は「実行中の APP_VERSION が サーバーの minClientVersion より古いとき」だけ。
// サーバーの version（通常のリリースのたびに上がる値）が新しいだけでは出さない
// （山本さんの明示的な念押し）。取得失敗（fetch自体の失敗・非2xx・JSON崩れ）は、
// 呼び出し側が minClientVersion に null を渡すことで表現する（この関数はnullなら
// 常にfalseを返す。失敗を理由に誤ってバナーを出さない・消さない）。

/**
 * バージョン文字列（"3.9" のような "." 区切り）をセグメントごとの数値として比較する。
 * 文字列比較（"3.10" < "3.9"）ではなくセグメントを Number() で数値化してから比較するため、
 * "3.9" と "3.10" を正しく "3.9 < 3.10" と判定できる。
 *
 * 戻り値：a が b より古ければ負の数・同じなら0・a が b より新しければ正の数
 * （Array.prototype.sort の比較関数と同じ約定）。
 *
 * 【不正な値の扱い】数値化できないセグメント（空文字列・数字以外の文字列等）は 0 として
 * 扱う。例外を投げず、常に有限の数値を返す総関数にするための割り切り（NaN を伝播させると
 * 呼び出し側の if 判定が常にfalseになり「出すべきときに出ない」事故の芽になるため）。
 */
export function compareVersions(a: string, b: string): number {
  const toSegments = (v: string): number[] =>
    v.split(".").map(seg => {
      const n = Number(seg);
      return Number.isFinite(n) ? n : 0;
    });

  const as = toSegments(a);
  const bs = toSegments(b);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = as[i] ?? 0;
    const bv = bs[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * 「再読み込みを促すバナーを出すべきか」の唯一の判定。
 *
 * @param currentVersion 実行中のアプリの APP_VERSION
 * @param minClientVersion サーバー（dist/version.json）から取得した minClientVersion。
 *   取得に失敗した場合は呼び出し側が null を渡すこと（取得失敗ではバナーを出さない）。
 */
export function shouldShowReloadNotice(
  currentVersion: string,
  minClientVersion: string | null,
): boolean {
  if (minClientVersion === null) return false;
  return compareVersions(currentVersion, minClientVersion) < 0;
}
