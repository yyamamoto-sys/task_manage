import { scrollToId, sidebarKrRows } from "../nav";
import { useMock, type ViewMode } from "../state";
import { nameOf } from "../ui";

export const MOCK_VERSION = "mock v12";
const ONLY_OKR = "モックでは OKR モードだけ動きます";

/** 押せない見た目の部品（本番にある操作。モックでは動かさない） */
function Inert({ icon, label, collapsed }: { icon: string; label: string; collapsed: boolean }) {
  return (
    <button type="button" className="mk-sb-btn is-inert" aria-disabled="true" aria-label={label} title={ONLY_OKR} onClick={(e) => e.preventDefault()}>
      <span aria-hidden="true">{icon}</span>
      {!collapsed && <span className="mk-sb-label">{label}</span>}
    </button>
  );
}

/**
 * 本番アプリ（MainLayout の Sidebar）に似せた左のサイドバー。
 * 上からロゴ・モード切替・検索／AI（見た目だけ）・メニュー（全て／チーム／わたし）・KR・資料を読ませる、下段にアバターと版。
 * 幅は既定 160px、折りたたむと 48px。
 */
export function Sidebar() {
  const { mode, setMode, sel, setSel, assess, items, setDrawerOpen, viewerId, sidebarCollapsed: collapsed, setSidebarCollapsed } = useMock();
  const krs = sidebarKrRows(items, assess);
  const pages: { id: ViewMode; icon: string; label: string; note?: string }[] = [
    { id: "all", icon: "🗺", label: "全て" },
    { id: "team", icon: "👥", label: "チーム" },
    { id: "self", icon: "👤", label: "わたし", note: "本人だけ" },
  ];
  const openKr = (id: string) => {
    setSel({ type: "kr", id });
    scrollToId("mk-flow-h");
  };
  const name = nameOf(viewerId);

  return (
    <aside className={`mk-sidebar print-hide${collapsed ? " is-collapsed" : ""}`} aria-label="サイドバー">
      <div className="mk-sb-top">
        {!collapsed && (
          <span className="mk-sb-logo">
            <strong>AMP</strong>
            <small>モック</small>
          </span>
        )}
        <button
          type="button"
          className="mk-sb-fold"
          aria-label={collapsed ? "メニューを開く" : "メニューを閉じる"}
          title={collapsed ? "メニューを開く" : "メニューを閉じる"}
          aria-expanded={!collapsed}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
        </button>
      </div>

      <div className="mk-sb-scroll">
        <div className="mk-sb-modes" role="group" aria-label="モード切替">
          <button
            type="button"
            className="mk-sb-mode is-inert"
            aria-disabled="true"
            aria-pressed="false"
            aria-label="計画モード"
            title={ONLY_OKR}
            onClick={(e) => e.preventDefault()}
          >
            <span aria-hidden="true">📋</span>
            {!collapsed && <span> 計画</span>}
          </button>
          <button type="button" className="mk-sb-mode is-on" aria-pressed="true" aria-label="OKRモード（選択中）" title="OKRモード">
            <span aria-hidden="true">🎯</span>
            {!collapsed && <span> OKR</span>}
          </button>
        </div>

        <Inert icon="🔍" label={collapsed ? "検索" : "検索..."} collapsed={collapsed} />
        <Inert icon="✨" label="AIツールを開く" collapsed={collapsed} />

        <nav aria-labelledby="mk-sb-menu-h">
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
          {pages.map((p) => {
            const on = mode === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`mk-sb-btn${on ? " is-active" : ""}`}
                aria-current={on ? "page" : undefined}
                aria-label={p.note ? `${p.label}（${p.note}）` : p.label}
                title={p.note ? `${p.label}（${p.note}）` : p.label}
                onClick={() => setMode(p.id)}
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

        <div className="mk-sb-section" role="group" aria-labelledby="mk-sb-kr-h">
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
            const on = sel?.type === "kr" && sel.id === k.id;
            const short = `${k.label}：AIの見立て ${k.value ?? "なし"}${k.tag ? `（前回から ${k.tag}）` : ""}`;
            return (
              <button
                key={k.id}
                type="button"
                className={`mk-sb-btn mk-sb-kr${on ? " is-active" : ""}`}
                aria-label={k.aria}
                aria-current={on ? "true" : undefined}
                title={collapsed ? `${short}（${k.text}）` : `${k.label} ${k.text}`}
                onClick={() => openKr(k.id)}
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

        <button
          type="button"
          className="mk-sb-btn mk-sb-docs"
          aria-label="資料を読ませる"
          title="資料を読ませる（チェックインの後に）"
          onClick={() => setDrawerOpen(true)}
        >
          <span aria-hidden="true">📄</span>
          {!collapsed && <span className="mk-sb-label">資料を読ませる</span>}
        </button>
      </div>

      <div className="mk-sb-bottom">
        <span className="mk-sb-avatar" role="img" aria-label={`見ている人：${name}`} title={`見ている人：${name}`}>
          {name.charAt(0)}
        </span>
        {!collapsed && <small className="mk-sb-ver">{MOCK_VERSION}</small>}
      </div>
    </aside>
  );
}
