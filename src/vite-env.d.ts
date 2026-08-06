/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** vite.config.ts の define で埋め込むビルド日時（UTCのISO文字列）。src/lib/version.ts 参照。 */
declare const __BUILD_TIME__: string;
