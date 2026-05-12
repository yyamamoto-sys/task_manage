// src/lib/lazyWithRetry.ts
//
// 【設計意図】
// React.lazy で読み込む動的 import のチャンクファイル名は Vite のビルドごとに
// ハッシュが変わる（例：MeetingImportPanel-CYWw0tvJ.js）。
// Vercel が再デプロイすると古いハッシュのチャンクは消えるため、古い index.html を
// 開いたままのユーザーが lazy コンポーネントを開こうとすると、もう存在しない
// チャンクを fetch して "Failed to fetch dynamically imported module" でクラッシュする。
//
// → 初回の読み込み失敗時に一度だけページをリロードして最新のチャンク名を取り直す。
//   リロード後も失敗する場合（＝本当のネットワーク障害や壊れたデプロイ）は
//   無限リロードを避けるためエラーをそのまま投げて ErrorBoundary に委ねる。

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

const RELOAD_FLAG_PREFIX = "chunk-reload:";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(async () => {
    const flagKey = RELOAD_FLAG_PREFIX + name;
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(flagKey); } catch { /* sessionStorage 不可環境は無視 */ }
      return mod;
    } catch (err) {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(flagKey) === "1"; } catch { /* noop */ }
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(flagKey, "1"); } catch { /* noop */ }
        window.location.reload();
        // リロードが走るので、描画を止めるため永遠に解決しない Promise を返す
        return new Promise<{ default: T }>(() => { /* never resolves */ });
      }
      throw err;
    }
  });
}
