// src/components/settings/SettingsTop.tsx
//
// 設定のトップ（v3.155）。見出し3つ（個人／部署の管理／アプリの管理）の下にカードを並べる。
// 誰に何が見えるかは buildSettingsCardGroups（src/lib/settings/settingsPages.ts）が決める。
// カード全体が1つの button。PC は多列グリッド、モバイル（幅768px以下）は1列の行型（右端に「›」）。

import type { CSSProperties } from "react";
import { useT } from "../../hooks/useT";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  settingsGroupTitleKey, settingsPageDescKey, settingsPageTitleKey,
  type SettingsCardGroup, type SettingsCountKey, type SettingsPageId,
} from "../../lib/settings/settingsPages";

interface Props {
  groups: SettingsCardGroup[];
  counts: Record<SettingsCountKey, number>;
  /** 編集対象の部署の表示（表示部署が2つ以上あるときだけ渡す） */
  deptName: string | null;
  onOpen: (id: SettingsPageId) => void;
}

const clamp2: CSSProperties = {
  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
};

export function SettingsTop({ groups, counts, deptName, onOpen }: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  return (
    <div>
      {groups.map((g, gi) => (
        <section key={g.group} aria-label={t(settingsGroupTitleKey(g.group))}>
          <div style={{ marginTop: gi === 0 ? 0 : "28px", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              {t(settingsGroupTitleKey(g.group))}
            </h2>
            {g.group === "department" && (
              <div style={{ marginTop: "4px", fontSize: "12px", lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
                {t("layout.settings.deptNote")}
                {deptName && <> ／ {t("layout.settings.deptTarget", { name: deptName })}</>}
              </div>
            )}
          </div>
          <div style={isMobile
            ? { display: "flex", flexDirection: "column", gap: "8px" }
            : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
            {g.pages.map(def => {
              const desc = t(settingsPageDescKey(def.id));
              const count = def.countKey ? counts[def.countKey] : null;
              return (
                <button
                  key={def.id}
                  type="button"
                  className="settings-card"
                  title={desc}
                  onClick={() => onOpen(def.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px", textAlign: "left", width: "100%",
                    padding: isMobile ? "12px 14px" : "16px 18px", minHeight: isMobile ? "64px" : "92px",
                    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)",
                    cursor: "pointer", color: "var(--color-text-primary)", fontFamily: "inherit",
                  }}
                >
                  <span aria-hidden="true" style={{
                    width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "22px", background: "var(--color-bg-secondary)",
                  }}>{def.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 700 }}>{t(settingsPageTitleKey(def.id))}</span>
                      {count !== null && (
                        <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                          {t("layout.settings.card.count", { n: count })}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--color-text-secondary)", ...clamp2 }}>{desc}</span>
                  </span>
                  {isMobile && <span aria-hidden="true" style={{ fontSize: "20px", color: "var(--color-text-tertiary)" }}>›</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
