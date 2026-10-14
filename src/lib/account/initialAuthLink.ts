// src/lib/account/initialAuthLink.ts
//
// 【設計意図】再設定メールのリンクから戻ってきた直後の URL（ハッシュ・クエリ）を、起動時に1度だけ控える。
// supabase-js は createClient 後に非同期でハッシュを読んで消すため、React が購読を張る頃には
// 見えなくなっていることがある（PASSWORD_RECOVERY のイベントを取りこぼしうる）。main.tsx の
// 一番最初に import して、supabase の初期化より前に評価されるようにする。
import { parseAuthLink, type AuthLinkResult } from "./recoveryFlow";

export const initialAuthLink: AuthLinkResult =
  typeof window === "undefined" ? { kind: "none" } : parseAuthLink(window.location.hash, window.location.search);
