/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Windows通知（Web Push）の VAPID 公開鍵。未設定ならWindows通知のトグルを無効にする */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** "1" のとき開発サーバーでも画面のエラーを記録する（既定は送らない） */
  readonly VITE_LOG_CLIENT_ERRORS_IN_DEV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** vite.config.ts の define で埋め込むビルド日時（UTCのISO文字列）。src/lib/version.ts 参照。 */
declare const __BUILD_TIME__: string;
