// src/lib/account/initialAuthLink.ts
//
// 【設計意図】メールのリンクから戻ってきた直後の URL（ハッシュ・クエリ）を、起動時に1度だけ控え、
// **その場で replaceState（push しない）して URL からトークン・エラーを消す**。
// supabase-js の detectSessionInUrl は切ってある（client.ts）。auth-js の `location.hash = ''` は
// 履歴に新しい項目を積み、トークン付きの URL が戻るボタンで復元できてしまうため。
// トークンの取り込み（setSession）は auth.ts の applyInitialAuthLink が行う。
// main.tsx の最初の import に置く（他のモジュールより先に URL を控えるため）。
import { captureAuthLink, type AuthLinkResult } from "./recoveryFlow";

export const initialAuthLink: AuthLinkResult =
  typeof window === "undefined" ? { kind: "none" } : captureAuthLink(window);
