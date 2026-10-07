// src/lib/version.ts
//
// 【設計意図】
// アプリのバージョン番号の唯一の正本。他のどこにもバージョン文字列をハードコードしない
// （package.json の version は今回のスコープ外・0.1.0 のまま同期しない。CLAUDE.md参照）。
// CLAUDE.md 冒頭のバージョン表記（例：`v3.25`）と一致することを
// src/lib/__tests__/version.test.ts で機械的に検査する（modalStyles.test.ts と同じ
// 「ファイルを読んで検査する」方式）。バージョンを上げるときは、CLAUDE.md と
// この APP_VERSION の両方を更新すること（CLAUDE.md Section 11参照。片方だけ上げると
// テストが落ちて気づける）。
//
// v は含めない（"3.25" のように）。表示側で `v{APP_VERSION}` と組み立てる。
export const APP_VERSION = "3.138";

/**
 * 【設計意図・v3.125】
 * 「この版より古い画面のまま使い続けると不具合が出る」という最低クライアント版数。
 * dist/version.json（vite.config.ts の versionManifestPlugin がこのファイルから書き出す。
 * 値を二重管理しない）として配信され、実行中のアプリ（src/components/common/
 * ReloadNoticeBanner.tsx）が定期的に取得して、実行中の APP_VERSION がこの値より古い
 * ときだけ再読み込みを促すバナーを出す（src/lib/reloadNotice.ts の判定関数参照）。
 *
 * 通常は APP_VERSION と同じ値のまま据え置く（＝今の版のクライアントのままで安全）。
 * DBの列の削除・改名・RLSの変更で旧フロントの書き込みが失敗するようになる・Edge
 * Functionの入出力の非互換・localStorageの形式変更など、「開いたままの古い画面が
 * 壊れた動作をする」変更を入れるリリースでだけ、この値をそのリリースの版まで引き上げる
 * こと（CLAUDE.md Section 63参照）。機能追加や見た目の変更だけでは上げない。
 */
export const MIN_CLIENT_VERSION = "3.136";

/**
 * 【設計意図】
 * ビルド日時（vite.config.ts の define で埋め込む __BUILD_TIME__、UTC ISO文字列）を、
 * Asia/Tokyo のローカル時刻表記（"YYYY-MM-DD HH:mm"）に変換する。
 * 本番ビルドは Vercel（UTC環境）で走るため、変換せずに出すとUTC表記のまま混乱を招く。
 * Intl.DateTimeFormat の hour12:false は一部ICU実装で深夜0時が "24:00" になる既知の不具合
 * があるため、代わりに hourCycle:"h23" を明示して回避する。
 */
export function formatBuildTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
