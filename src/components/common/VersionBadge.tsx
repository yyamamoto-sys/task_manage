// src/components/common/VersionBadge.tsx
//
// 【設計意図】
// アプリの隅に控えめに置くバージョン表示。画面上の文字は「v{APP_VERSION}」のみ。
// ビルド日時（Asia/Tokyo変換済み）はホバー時のtooltipにのみ出す。
// 配置場所（サイドバー最下部・ログイン画面・モバイルラボシート）ごとに位置決めのスタイルは
// 呼び出し側が持つ。この部品自身はテキストの見た目とtooltipだけを担う薄いラッパー。

import { APP_VERSION, formatBuildTime } from "../../lib/version";
import { useT } from "../../hooks/useT";

export function VersionBadge() {
  const t = useT();
  const buildTime = formatBuildTime(__BUILD_TIME__);
  return (
    <span
      title={t("common.version.tooltip", { version: APP_VERSION, buildTime })}
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
