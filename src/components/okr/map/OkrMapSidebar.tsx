import { useOkrMapBridge } from "./bridge";
import { SidebarNav } from "./parts/SidebarNav";

/**
 * MainLayout のサイドバーに置く、OKRモードのメニュー・KR一覧・資料を読ませる。
 * 地図の画面（遅延読み込み）が載せた内容を描くだけ。まだ載っていない間は何も出さない
 */
export function OkrMapSidebar({ collapsed }: { collapsed: boolean }) {
  const view = useOkrMapBridge((s) => s.view);
  const actions = useOkrMapBridge((s) => s.actions);
  if (!view || !actions) return null;
  return (
    <div className="mk-sb-embedded">
      <SidebarNav
        mode={view.mode}
        krs={view.krs}
        selKrId={view.selKrId}
        collapsed={collapsed}
        onMode={actions.setMode}
        onKr={actions.openKr}
        onDocs={actions.openDocs}
      />
    </div>
  );
}
