// src/components/common/FullScreenLoading.tsx
//
// 【設計意図】
// App.tsx の起動シーケンス（①認証セッション確認 → ②システム空判定 →
// ③ログインユーザー自動マッチング → ④データ読み込み）は、ユーザーから見れば
// 一連の「起動待ち」でしかない。しかし従来は①〜③が小さいスピナーのみ、④だけが
// アイコン＋プログレスバー＋ヒントカードという別デザインだったため、
// 「別々のローディングが2回起きた」ように見えていた（山本さん指摘、2026-07-27）。
//
// この共有コンポーネントで見た目を統一し、①〜④を通じて「1枚の画面がずっと
// 出ている」ように見せる。中身のヒント（LoadingTips）は経過時間ベースで回転する
// ため、画面が切り替わっても続きから流れる（LoadingTips.tsx参照）。
//
// 【縦位置を1pxも動かさない制約】
// message/progress/hintの有無によってテキスト＋バー＋補足行ブロックの高さが
// 変わると、スピナーやヒントカードのY座標がずれて「画面が切り替わった」ように
// 見えてしまい、本コンポーネントの目的そのものを損なう。そのため：
//   ・プログレスバーのトラックは progress の有無に関わらず常に描画する（塗りだけ出し分け）
//   ・補足行は空文字にせず、内容が無いときは半角スペースで高さを保つ
//   ・text/バー/補足行を包む幅200pxのブロックは常に同じ子要素構成にする

import { LoadingTips } from "./LoadingTips";
import { useT } from "../../hooks/useT";

interface FullScreenLoadingProps {
  /** 見出しテキスト。既定は t("common.loading")（App.tsx の④は「データを読み込み中...」を渡す） */
  message?: string;
  /** 0〜100。省略時はプログレスバーの塗りを出さない（トラックは常に描画） */
  progress?: number;
  /** 補足行に出す再試行メッセージ等。省略時は progress があれば "n%"、無ければ空 */
  hint?: string;
}

export function FullScreenLoading({
  message,
  progress,
  hint,
}: FullScreenLoadingProps) {
  const t = useT();
  const effectiveMessage = message ?? t("common.loading");
  const subText = hint || (progress !== undefined ? `${progress}%` : " ");

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: "24px",
      background: "var(--color-bg-primary)",
    }}>
      {/* アイコン */}
      <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-bg-tertiary)" strokeWidth="3" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-brand)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="68 38" />
      </svg>

      {/* テキスト＋プログレスバー。progress/hintの有無で高さが変わらないよう固定する */}
      <div style={{ textAlign: "center", lineHeight: 1.6, width: "200px" }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>
          {effectiveMessage}
        </div>

        {/* 決定的プログレスバー：トラックは常に描画し、塗りは progress がある時だけ */}
        <div style={{
          height: "5px", borderRadius: "3px",
          background: "var(--color-bg-tertiary)", overflow: "hidden",
        }}>
          {progress !== undefined && (
            <div style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--color-brand)",
              borderRadius: "3px",
              transition: "width 0.25s ease",
            }} />
          )}
        </div>

        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
          {subText}
        </div>
      </div>

      {/* 待ち時間に操作テクニックのヒントを表示（ガイドツアーでは扱っていない内容） */}
      <LoadingTips />
    </div>
  );
}
