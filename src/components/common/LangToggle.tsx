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

import { useLangStore } from "../../stores/langStore";

interface Props {
  /** "icon": 32x32の正方形ボタン（モバイルヘッダー・ログイン前画面等）／
   *  "text": テキストのみの小さいボタン（サイドバーフッター等） */
  variant?: "icon" | "text";
  style?: React.CSSProperties;
}

export function LangToggle({ variant = "icon", style }: Props) {
  const lang = useLangStore(s => s.lang);
  const toggleLang = useLangStore(s => s.toggleLang);
  const title = lang === "ja"
    ? "🌐 日本語 | English（クリックで English に切替）"
    : "🌐 日本語 | English（click to switch to 日本語）";

  if (variant === "text") {
    return (
      <button
        onClick={toggleLang}
        title={title}
        style={{
          fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)",
          background: "transparent", border: "none", cursor: "pointer", padding: "2px",
          ...style,
        }}
      >
        {lang === "ja" ? "EN" : "JA"}
      </button>
    );
  }

  return (
    <button
      onClick={toggleLang}
      title={title}
      style={{
        width: "32px", height: "32px", borderRadius: "var(--radius-md)",
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border-primary)",
        cursor: "pointer", fontSize: "11px", fontWeight: 600,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, color: "var(--color-text-secondary)",
        ...style,
      }}
    >
      {lang === "ja" ? "EN" : "JA"}
    </button>
  );
}
