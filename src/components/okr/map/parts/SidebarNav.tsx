import type { SidebarKr } from "../nav";
import type { ViewMode } from "../state";

export interface SidebarNavProps {
  mode: ViewMode;
  krs: SidebarKr[];
  selKrId: string | null;
  collapsed: boolean;
  onMode: (m: ViewMode) => void;
  onKr: (krId: string) => void;
  onDocs: () => void;
}

const PAGES: { id: ViewMode; icon: string; label: string; note?: string }[] = [
  { id: "team", icon: "👥", label: "チーム" },
  { id: "self", icon: "👤", label: "わたし", note: "本人だけ" },
];

/**
 * OKRモードのサイドバーの中身（メニュー＝チーム／わたし・KR一覧・資料を読ませる）。
 * 本番では MainLayout のサイドバーに、テストでは App の中の見本のサイドバーに置く。状態は持たない
 */
export function SidebarNav({ mode, krs, selKrId, collapsed, onMode, onKr, onDocs }: SidebarNavProps) {
  return (
    <>
      <nav aria-labelledby="mk-sb-menu-h" data-tour-id="okr-map-menu">
        {!collapsed && (
          <div id="mk-sb-menu-h" className="mk-sb-h">
            メニュー
          </div>
        )}
        {collapsed && (
          <span id="mk-sb-menu-h" className="mk-sr">
            メニュー
          </span>
        )}
        {PAGES.map((p) => {
          const on = mode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`mk-sb-btn${on ? " is-active" : ""}`}
              aria-current={on ? "page" : undefined}
              aria-label={p.note ? `${p.label}（${p.note}）` : p.label}
              title={p.note ? `${p.label}（${p.note}）` : p.label}
              onClick={() => onMode(p.id)}
            >
              <span aria-hidden="true">{p.icon}</span>
              {!collapsed && (
                <span className="mk-sb-label">
                  {p.label}
                  {p.note && <small className="mk-sb-note">{p.note}</small>}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mk-sb-section" role="group" aria-labelledby="mk-sb-kr-h" data-tour-id="okr-map-kr-list">
        {!collapsed && (
          <div id="mk-sb-kr-h" className="mk-sb-h">
            KR
          </div>
        )}
        {collapsed && (
          <span id="mk-sb-kr-h" className="mk-sr">
            KR
          </span>
        )}
        {krs.map((k) => {
          const on = selKrId === k.id;
          const short = `${k.label}：AIの見立て ${k.value ?? "なし"}${k.tag ? `（前回から ${k.tag}）` : ""}`;
          return (
            <button
              key={k.id}
              type="button"
              className={`mk-sb-btn mk-sb-kr${on ? " is-active" : ""}`}
              aria-label={k.aria}
              aria-current={on ? "true" : undefined}
              title={collapsed ? `${short}（${k.text}）` : `${k.label} ${k.text}`}
              onClick={() => onKr(k.id)}
            >
              <span className={`mk-kdot${k.pattern > 0 ? " has-pattern" : ""}`} aria-hidden="true" style={{ background: k.color }} />
              {!collapsed && (
                <span className="mk-sb-label">
                  {k.label}
                  <span className="mk-sb-val">{k.value ?? "—"}</span>
                  {k.tag && <small className="mk-sb-tag">{k.tag}</small>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button type="button" className="mk-sb-btn mk-sb-docs" data-tour-id="okr-map-docs" aria-label="資料を読ませる" title="資料を読ませる（チェックインの後に）" onClick={onDocs}>
        <span aria-hidden="true">📄</span>
        {!collapsed && <span className="mk-sb-label">資料を読ませる</span>}
      </button>
    </>
  );
}
