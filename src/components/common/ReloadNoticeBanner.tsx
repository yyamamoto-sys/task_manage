// src/components/common/ReloadNoticeBanner.tsx
//
// 【設計意図・v3.125】
// 「再読み込みが必要な更新が出たとき、開いている利用者にだけ再読み込みを促す」バナー。
// 既存の partialLoadWarning バナー（App.tsx・v3.122）と全く同じ構造（固定表示・warning
// トーン・右側にボタン1つ）を再利用し、新しい見た目の部品は作っていない。
//
// 🔴 出す条件は「実行中の APP_VERSION が サーバーの MIN_CLIENT_VERSION より古いとき」だけ
// （判定本体は純粋関数 src/lib/reloadNotice.ts の shouldShowReloadNotice()）。サーバーの
// version（通常のリリースで必ず上がる値）が新しいだけでは出さない（山本さんの明示的な
// 念押し）。
//
// 【取得】dist/version.json（vite.config.ts の versionManifestPlugin が
// src/lib/version.ts から書き出す）を、起動時・10分ごと・タブが前面に戻ったとき
// （visibilitychange）に cache:"no-store" ＋ クエリでキャッシュを避けて取得する。
// 取得失敗（fetch自体の失敗・非2xx・JSON崩れ）は console.warn のみに留め、バナーの
// 表示状態は変えない（既に出ている／いないをそのまま維持する）。
//
// 【自動では再読み込みしない】編集中の内容が消えるため、ボタンを押したときだけ
// window.location.reload() する。閉じるボタンは付けない（必須の更新のため）。
//
// 【開発時は動かさない】vite dev サーバーは dist/version.json を書き出さないため、
// import.meta.env.DEV のときは何もしない。

import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { APP_VERSION } from "../../lib/version";
import { shouldShowReloadNotice, CHUNK_LOAD_FAILED_EVENT } from "../../lib/reloadNotice";
import { reloadWithGuard } from "../../lib/reloadWithGuard";

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10分

interface VersionManifest {
  version?: unknown;
  minClientVersion?: unknown;
  buildTime?: unknown;
}

export function ReloadNoticeBanner() {
  const t = useT();
  // 版による通知（version.json の判定）とチャンク失敗の通知は別々に持つ。
  // 同じ state にすると、10分ごとの版チェックが「出さない」と判定したときにチャンク失敗の案内まで消してしまう
  const [versionOutdated, setVersionOutdated] = useState(false);
  const [chunkFailed, setChunkFailed] = useState(false);

  // lazyWithRetry がチャンクを読み込めなかったとき（新しい版の公開後の古いタブ）も同じバナーで知らせる（v3.146）。
  // 開発サーバーでも出せるよう、DEV の早期 return より前の別 effect に置く
  useEffect(() => {
    const onChunkFailed = (): void => setChunkFailed(true);
    window.addEventListener(CHUNK_LOAD_FAILED_EVENT, onChunkFailed);
    return () => window.removeEventListener(CHUNK_LOAD_FAILED_EVENT, onChunkFailed);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;

    const check = (): void => {
      fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<VersionManifest>;
        })
        .then(json => {
          if (cancelled) return;
          const minClientVersion =
            typeof json.minClientVersion === "string" ? json.minClientVersion : null;
          setVersionOutdated(shouldShowReloadNotice(APP_VERSION, minClientVersion));
        })
        .catch(e => {
          console.warn("[ReloadNoticeBanner] version.jsonの取得に失敗しました:", e);
          // 取得失敗ではバナーの表示状態を変えない（出す／出さないどちらも維持）
        });
    };

    check();
    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!versionOutdated && !chunkFailed) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,
      background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
      border: "1px solid var(--color-border-warning)",
      padding: "10px 16px", fontSize: "12px",
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      <span style={{ flex: 1 }}>
        ⚠ {versionOutdated ? t("layout.app.reloadNotice.body") : t("layout.app.chunkLoadFailed.body")}
      </span>
      <button
        onClick={() => { void reloadWithGuard(); }}
        style={{
          padding: "4px 12px", fontSize: "11px", fontWeight: "500",
          background: "var(--color-text-warning)", color: "#fff",
          border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
        }}
      >
        {t("layout.app.reloadNotice.reload")}
      </button>
    </div>
  );
}
