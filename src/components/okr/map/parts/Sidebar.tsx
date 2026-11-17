import { scrollToId, sidebarKrRows } from "../nav";
import { useMock } from "../state";
import { nameOf } from "../ui";
import { SidebarNav } from "./SidebarNav";

export const MOCK_VERSION = "mock v15";
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
 * 本番アプリ（MainLayout の Sidebar）に似せた左のサイドバー。テストで1枚の画面を確かめるための見本で、
 * 本番の OKR モードでは描かない（中身の SidebarNav だけを MainLayout のサイドバーに置く）。
 * 上からロゴ・モード切替・検索／AI（見た目だけ）・メニュー（チーム／わたし）・KR・資料を読ませる、下段にアバターと版。
 * 幅は既定 160px、折りたたむと 48px。
 */
export function Sidebar() {
  const { mode, setMode, sel, setSel, assess, items, setDrawerOpen, viewerId, sidebarCollapsed: collapsed, setSidebarCollapsed } = useMock();
  const krs = sidebarKrRows(items, assess);
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

        <SidebarNav
          mode={mode}
          krs={krs}
          selKrId={sel?.type === "kr" ? sel.id : null}
          collapsed={collapsed}
          onMode={setMode}
          onKr={openKr}
          onDocs={() => setDrawerOpen(true)}
        />
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
