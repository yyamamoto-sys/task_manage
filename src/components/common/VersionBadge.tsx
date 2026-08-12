// src/components/common/VersionBadge.tsx
//
// 【設計意図】
// アプリの隅に控えめに置くバージョン表示。画面上の文字は「v{APP_VERSION}」のみ。
// ビルド日時（Asia/Tokyo変換済み）はホバー時のtooltipにのみ出す。
// 配置場所（サイドバー最下部・ログイン画面・モバイルラボシート）ごとに位置決めのスタイルは
// 呼び出し側が持つ。この部品自身はテキストの見た目とtooltipだけを担う薄いラッパー。
//
// 【v3.61で変更】onClick を渡すとバージョン履歴モーダルを開ける押せる表示になる（<button>化。
// ホバーで下線・カーソルがpointerに変わる）。onClick を渡さない場合は元の<span>のまま
// （後方互換）。押せることが伝わるよう aria-label を付ける（title属性のtooltipとは別に、
// スクリーンリーダー向けに「バージョン履歴を表示」を明示する）。

import { APP_VERSION, formatBuildTime } from "../../lib/version";
import { useT } from "../../hooks/useT";

interface Props {
  /** 渡すとクリック可能な表示になる（バージョン履歴モーダルを開く用途）。省略時は従来のspan表示 */
  onClick?: () => void;
}

export function VersionBadge({ onClick }: Props) {
  const t = useT();
  const buildTime = formatBuildTime(__BUILD_TIME__);
  const tooltip = t("common.version.tooltip", { version: APP_VERSION, buildTime });

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        aria-label={`バージョン履歴を表示（現在 v${APP_VERSION}）`}
        className="version-badge-clickable"
        style={{
          fontSize: "10px",
          color: "var(--color-text-tertiary)",
          whiteSpace: "nowrap",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        v{APP_VERSION}
      </button>
    );
  }

  return (
    <span
      title={tooltip}
      style={{
        fontSize: "10px",
        color: "var(--color-text-tertiary)",
        userSelect: "none",
        cursor: "default",
        whiteSpace: "nowrap",
      }}
    >
      v{APP_VERSION}
    </span>
  );
}
