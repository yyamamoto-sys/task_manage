import { useT } from "../../hooks/useT";

interface AppLogoProps {
  size: number;
  variant: "full" | "icon" | "compact";
}

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

  const nameFont = variant === "full" ? Math.max(15, Math.round(size * 0.55)) : 15;
  return (
    <div title={label} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
      <LogoMark size={size} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, textAlign: "left" }}>
        <span style={{ fontSize: `${nameFont}px`, fontWeight: 700, lineHeight: 1.15, color: "var(--color-text-primary)", whiteSpace: "nowrap", flexShrink: 0 }}>
          {name}
        </span>
        {variant === "full" && (
          <span style={{ fontSize: "11px", lineHeight: 1.2, color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, maxWidth: "100%" }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
