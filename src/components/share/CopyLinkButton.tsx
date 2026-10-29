// src/components/share/CopyLinkButton.tsx
//
// 「リンクをコピー」の小さなアイコンボタン（v3.192。ビュー・タスク詳細で共用）。
// URL は押した時点で組み立てる（getUrl）。ラベルは title／aria-label に出す。
import { useT } from "../../hooks/useT";
import { copyShareLink } from "../../lib/share/copyShareLink";

interface Props {
  getUrl: () => string;
  labelKey: string;
  size?: number;
}

export function CopyLinkButton({ getUrl, labelKey, size = 22 }: Props) {
  const t = useT();
  const label = t(labelKey);
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); void copyShareLink(getUrl(), t); }}
      title={label}
      aria-label={label}
      style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, padding: 0,
        background: "transparent", border: "none", cursor: "pointer",
        borderRadius: "var(--radius-md)",
        color: "var(--color-text-tertiary)",
        fontSize: "12px", lineHeight: 1,
      }}
    >
      🔗
    </button>
  );
}
