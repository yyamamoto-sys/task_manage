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
// 【バナーの再読み込みはボタンを押したときだけ】閉じるボタンは付けない（必須の更新のため）。
// 全体バナーは MIN_CLIENT_VERSION 判定のときだけ（v3.163）。バーが出ていても操作はブロックしない（本体を押し下げる）。
// 別に、操作が10分以上無いときだけ黙って切り替える「自動更新」を持つ（v3.152・下記 effect・Section 63）。
//
// 【開発時は動かさない】vite dev サーバーは dist/version.json を書き出さないため、
// import.meta.env.DEV のときは何もしない。

import { useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { APP_VERSION } from "../../lib/version";
import { shouldShowReloadNotice } from "../../lib/reloadNotice";
import { reloadWithGuard } from "../../lib/reloadWithGuard";
import { hasUnsavedEditors } from "../../lib/editing/unsavedEditorRegistry";
import { isGuestMode } from "../../lib/guestMode";
import {
  AUTO_UPDATE_EVAL_INTERVAL_MS, AUTO_UPDATE_EVALUATE_EVENT, isAutoUpdateAiBusy, isInputFocused, isModalOpen,
  readAutoReloadRecord, shouldAutoReload, writeAutoReloadRecord,
} from "../../lib/autoUpdate";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;

/** バーの高さを本体へ伝える CSS 変数（globals.css の body・ベルの位置が参照する） */
export const RELOAD_BAR_HEIGHT_VAR = "--reload-bar-h";

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10分

interface VersionManifest {
  version?: unknown;
  minClientVersion?: unknown;
  buildTime?: unknown;
}

export function ReloadNoticeBanner() {
  const t = useT();
  // 出す条件は MIN_CLIENT_VERSION による判定（versionOutdated）だけ。チャンクの読み込み失敗では出さない
  // （v3.163：失敗時は lazyWithRetry が安全なら黙って再読み込み・そうでなければその画面の位置にだけ案内を出す）
  const [versionOutdated, setVersionOutdated] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  // バーは position:fixed で上部を覆うため、出している間は高さ分だけ本体（body の padding-top）を押し下げ、
  // 操作をブロックしない（globals.css の --reload-bar-h）
  useEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!versionOutdated || !el) {
      root.style.removeProperty(RELOAD_BAR_HEIGHT_VAR);
      return;
    }
    const apply = (): void => { root.style.setProperty(RELOAD_BAR_HEIGHT_VAR, `${el.offsetHeight}px`); };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty(RELOAD_BAR_HEIGHT_VAR); };
  }, [versionOutdated]);

  const serverVersionRef = useRef<string | null>(null);

  // 【自動更新・v3.152】操作が10分以上無く、未保存の編集・入力中・モーダル・AI会話・ゲストのいずれでもないとき、
  // サーバーの版が新しければ黙って再読み込みする（判定は lib/autoUpdate.ts の shouldAutoReload）
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let lastActivity = Date.now();
    const onActivity = (): void => { lastActivity = Date.now(); };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { capture: true, passive: true });

    const evaluate = (): void => {
      const serverVersion = serverVersionRef.current;
      const now = Date.now();
      const ok = shouldAutoReload({
        serverVersion,
        currentVersion: APP_VERSION,
        idleMs: now - lastActivity,
        hasUnsaved: hasUnsavedEditors(),
        inputFocused: isInputFocused(),
        modalOpen: isModalOpen(),
        aiBusy: isAutoUpdateAiBusy(),
        isGuest: isGuestMode(),
        lastAutoReload: readAutoReloadRecord(),
        now,
      });
      if (!ok || serverVersion === null) return;
      // 記録を書けない環境ではループ防止が効かないので reload しない
      if (!writeAutoReloadRecord({ version: serverVersion, at: now })) return;
      window.location.reload();
    };

    const id = window.setInterval(evaluate, AUTO_UPDATE_EVAL_INTERVAL_MS);
    window.addEventListener(AUTO_UPDATE_EVALUATE_EVENT, evaluate);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(AUTO_UPDATE_EVALUATE_EVENT, evaluate);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true });
    };
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
          serverVersionRef.current = typeof json.version === "string" ? json.version : null;
          window.dispatchEvent(new Event(AUTO_UPDATE_EVALUATE_EVENT));
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

  if (!versionOutdated) return null;

  return (
    <div ref={barRef} style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,
      background: "var(--color-bg-warning)", color: "var(--color-text-warning)",
      border: "1px solid var(--color-border-warning)",
      padding: "10px 16px", fontSize: "12px",
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      <span style={{ flex: 1 }}>
        ⚠ {t("layout.app.reloadNotice.body")}
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
