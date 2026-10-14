import { useT } from "../../hooks/useT";

interface AppLogoProps {
  size: number;
  variant: "full" | "icon" | "compact";
}

/** 正式名称（1語1行で表示する）。ブランド表記のため言語で切り替えない。 */
const FULL_NAME_WORDS = ["AMITA", "Management", "Platform"] as const;

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <rect width="64" height="64" rx="14" fill="#a3452a" />
      <rect x="27" y="12" width="10" height="7" rx="3.5" fill="#f8eee0" />
      <rect x="21" y="23" width="9" height="7" rx="3.5" fill="#f8eee0" />
      <rect x="34" y="23" width="9" height="7" rx="3.5" fill="#f8eee0" />
      <rect x="16" y="34" width="32" height="7" rx="3.5" fill="#f3c4a3" />
      <rect x="11" y="45" width="10" height="7" rx="3.5" fill="#f8eee0" />
      <rect x="43" y="45" width="10" height="7" rx="3.5" fill="#f8eee0" />
    </svg>
  );
}

export function AppLogo({ size, variant }: AppLogoProps) {
  const t = useT();
  const name = t("layout.sidebar.appName");
  const subtitle = t("layout.sidebar.appSubtitle");
  const label = `${name}（${subtitle}）`;

  if (variant === "icon") {
    return (
      <span role="img" aria-label={label} title={label} style={{ display: "inline-flex", flexShrink: 0 }}>
        <LogoMark size={size} />
      </span>
    );
  }

  // フルネームを1語1行で3行に積み、3行の合計がアイコンの高さに納まるようにする（山本さん指示・2026-10-14）。
  // compact（1行）は略称を出す。
  if (variant === "compact") {
    return (
      <div title={label} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <LogoMark size={size} />
        <span style={{ fontSize: "15px", fontWeight: 700, lineHeight: 1.15, color: "var(--color-text-primary)", whiteSpace: "nowrap", flexShrink: 0 }}>
          {name}
        </span>
      </div>
    );
  }

  const lineHeight = size / FULL_NAME_WORDS.length;
  const fontSize = Math.floor(lineHeight * 0.92);
  return (
    <div title={label} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
      <LogoMark size={size} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", height: `${size}px`, flexShrink: 0, textAlign: "left" }}>
        {FULL_NAME_WORDS.map((w, i) => (
          <span key={w} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, fontWeight: i === 0 ? 800 : 600, letterSpacing: i === 0 ? "0.04em" : "0.01em", color: i === 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}
