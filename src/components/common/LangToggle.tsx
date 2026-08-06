// src/components/common/LangToggle.tsx
//
// 【設計意図】
// EN/JA切替トグルの共通部品。元々 MainLayout.tsx のモバイルヘッダー／サイドバーフッターに
// 個別実装（コピペ）されていた同じボタンをここへ抽出した（Phase 1・2026-08-04）。
// ログイン前の画面（LoginScreen/UserSelectScreen/SetupWizard/AccessDeniedScreen）にも
// 同じ部品を配置する。
//
// title文言はあえて t() を通さず日英併記のまま固定する（「🌐 日本語 | English」）。
// このボタンは「現在の表示言語が何であっても、これが言語切替ボタンだと分かる」ことが
// 目的のため、現在言語だけで文言を訳すと本来の役割（言語を跨いだ道しるべ）を損なう。
//
// 【en辞書の動的import対応（v3.19）】 isLoadingEn が true の間（en辞書を初めて
// ダウンロード中）はクリック不可にし、小さい回転スピナーに差し替える。
//
// 【i18nはPhase 2以降凍結中の部分対応注記（v3.21・v3.22で表示経路を修正）】
// i18nはPhase 0（土台）＋Phase 1（アプリ骨格・共通UI・認証画面）までで凍結中。
// Phase 2以降（ダッシュボード/ガント/カンバン/リスト/タスク編集/OKR/管理画面等の各画面本体）は
// 未着手のため、ENに切り替えても画面の中身は日本語のままになる。これを不具合と誤解されない
// ようにするための注記を出す：
//   (a) title属性末尾に注記（常設・tooltipなのでレイアウト影響ゼロ）
//   (b) 初回のみ、lang="en"になった時点で1回だけ「見える」形で知らせる
//         - variant="icon"（モバイルヘッダー・ログイン前4画面）：吹き出し表示（8秒で
//           自動フェードアウト・✕で即閉じ可）
//         - variant="text"（PCサイドバーフッター）：吹き出しの代わりに showToast() を使う
//           （下記コメント参照。PCブラウザでログイン後にENへ切り替える主要経路が
//           tooltipのみでは何も見えなくなる実用上の穴があったため、v3.22でToastに変更）
// (a)(b)いずれも localStorage（KEYS.LANG_PARTIAL_NOTICE_SEEN）で「一度見せたら以後出さない」
// を管理する。吹き出し・Toastどちらの経路で見せても同じフラグを使うため「注記は生涯1回だけ」
// が両経路をまたいで成立する。
// Phase 2に着手し各画面がENに追従したら、この注記（title追記・吹き出し・Toast・辞書キー
// common.lang.partialNotice・KEYS.LANG_PARTIAL_NOTICE_SEEN）は不要になるため撤去すること。
//
// 【variant="text"（PCサイドバーフッター）でToastを使う理由】
// サイドバーの外枠（MainLayout.tsx の Sidebar 直下 div）は幅48/196pxで overflow:hidden。
// 読める幅を持つ吹き出し（最低150px前後）をこの枠内に収めようとすると、アンカー
// （EN/JAボタン）の位置によって左右どちらに出しても枠の外に出て切れてしまう。
// tooltip（title属性）だけに頼ると「ホバーしないと見えない」ため、PCブラウザでログイン後に
// 使える唯一のトグル（このvariant）でENに切り替えたユーザーに何も見えない穴になっていた
// （v3.21のレビューで発覚）。`showToast()`（`src/components/common/Toast.tsx`）はfixed配置
// でありサイドバーのoverflow:hiddenの影響を受けず、かつ`ToastContainer`は`App.tsx`の
// ログイン後の画面に必ずマウントされている（`variant="text"`自体もログイン後のサイドバー
// でしか使われないため前提を満たす）。この経路だけの特別対応であり、Toast自体の表示時間・
// スタイルは変更しない。

import { useEffect, useState } from "react";
import { useLangStore } from "../../stores/langStore";
import { useT } from "../../hooks/useT";
import { translate } from "../../lib/i18n";
import { KEYS } from "../../lib/localData/localStore";
import { showToast } from "./Toast";

/**
 * 「英語UIは一部対応」注記を生涯1回だけ見せるためのフラグ管理。
 * 未読（false）なら既読フラグを立てて true を返す。既読ならフラグは変更せず false を返す。
 * variant="icon"の吹き出し・variant="text"のToast、どちらの経路で呼ばれても同じフラグを
 * 共有するため、どちらか一方で見せたらもう一方では二度と出さない。
 */
function consumeFirstTimePartialNotice(): boolean {
  let seen = false;
  try { seen = localStorage.getItem(KEYS.LANG_PARTIAL_NOTICE_SEEN) === "1"; } catch { /* 利用不可は無視 */ }
  if (seen) return false;
  try { localStorage.setItem(KEYS.LANG_PARTIAL_NOTICE_SEEN, "1"); } catch { /* 利用不可・容量不足は無視 */ }
  return true;
}

interface Props {
  /** "icon": 32x32の正方形ボタン（モバイルヘッダー・ログイン前画面等）／
   *  "text": テキストのみの小さいボタン（サイドバーフッター等） */
  variant?: "icon" | "text";
  style?: React.CSSProperties;
}

function Spinner({ size }: { size: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: "50%",
        border: "2px solid currentColor", borderTopColor: "transparent",
        display: "inline-block", animation: "lang-toggle-spin 0.7s linear infinite",
      }}
    />
  );
}

/** 初回ENのみ出す注記吹き出し（8秒後フェードアウト・×で即閉じ可）。variant="icon" 専用。 */
function PartialNoticeBubble({ state, onDismiss, message }: {
  state: "visible" | "fading";
  onDismiss: () => void;
  message: string;
}) {
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        zIndex: 50,
        width: "220px",
        maxWidth: "calc(100vw - 24px)",
        padding: "8px 10px 8px 12px",
        display: "flex", alignItems: "flex-start", gap: "6px",
        background: "var(--color-bg-info)",
        border: "1px solid var(--color-border-info)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        fontSize: "11px", lineHeight: 1.5,
        color: "var(--color-text-info)",
        opacity: state === "fading" ? 0 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="close"
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--color-text-info)", fontSize: "12px", lineHeight: 1,
          padding: "0", flexShrink: 0, opacity: 0.7,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function LangToggle({ variant = "icon", style }: Props) {
  const lang = useLangStore(s => s.lang);
  const isLoadingEn = useLangStore(s => s.isLoadingEn);
  const toggleLang = useLangStore(s => s.toggleLang);
  const t = useT();

  const [notice, setNotice] = useState<"hidden" | "visible" | "fading">("hidden");

  // variant="text"（PCサイドバーフッター）はToastで、variant="icon"は吹き出しで出す（上部コメント参照）。
  useEffect(() => {
    if (lang !== "en") return;

    if (variant === "text") {
      if (consumeFirstTimePartialNotice()) {
        showToast(translate("en", "common.lang.partialNotice"), "info");
      }
      return;
    }

    if (!consumeFirstTimePartialNotice()) return;
    setNotice("visible");
    const fadeTimer = setTimeout(() => setNotice("fading"), 8000);
    const removeTimer = setTimeout(() => setNotice("hidden"), 8300);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, [lang, variant]);

  const baseTitle = isLoadingEn
    ? "English データを読み込み中…"
    : lang === "ja"
      ? "🌐 日本語 | English（クリックで English に切替）"
      : "🌐 日本語 | English（click to switch to 日本語）";
  // 現在ENのときだけ、末尾に「一部の画面のみ対応」の注記(en)をtooltipへ追記する。
  const title = (!isLoadingEn && lang === "en")
    ? `${baseTitle}\n\n${t("common.lang.partialNotice")}`
    : baseTitle;

  // keyframesはグローバルCSSに定義がないため、このコンポーネント内で一度だけ注入する
  const keyframes = "@keyframes lang-toggle-spin { to { transform: rotate(360deg); } }";

  if (variant === "text") {
    return (
      <span style={{ position: "relative", display: "inline-flex" }}>
        <button
          onClick={toggleLang}
          title={title}
          disabled={isLoadingEn}
          style={{
            fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)",
            background: "transparent", border: "none", cursor: isLoadingEn ? "wait" : "pointer", padding: "2px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            ...style,
          }}
        >
          <style>{keyframes}</style>
          {isLoadingEn ? <Spinner size={11} /> : (lang === "ja" ? "EN" : "JA")}
        </button>
      </span>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        onClick={toggleLang}
        title={title}
        disabled={isLoadingEn}
        style={{
          width: "32px", height: "32px", borderRadius: "var(--radius-md)",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          cursor: isLoadingEn ? "wait" : "pointer", fontSize: "11px", fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, color: "var(--color-text-secondary)",
          ...style,
        }}
      >
        <style>{keyframes}</style>
        {isLoadingEn ? <Spinner size={14} /> : (lang === "ja" ? "EN" : "JA")}
      </button>
      {notice !== "hidden" && (
        <PartialNoticeBubble
          state={notice}
          onDismiss={() => setNotice("hidden")}
          message={t("common.lang.partialNotice")}
        />
      )}
    </span>
  );
}
