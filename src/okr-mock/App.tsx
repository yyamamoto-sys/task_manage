import { useEffect, useState } from "react";
import { formatFull, TODAY } from "./logic";
import { MockProvider, useMock, type ScreenId } from "./state";
import { CheckinScreen } from "./screens/CheckinScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { KrDetailScreen } from "./screens/KrDetailScreen";
import { MapScreen } from "./screens/MapScreen";
import { Placeholder } from "./screens/Placeholder";

const NAV: { id: ScreenId; no: string; label: string }[] = [
  { id: "home", no: "①", label: "期のホーム" },
  { id: "import", no: "②", label: "取り込み・突き合わせ" },
  { id: "map", no: "③", label: "OKRマップ" },
  { id: "kr", no: "④", label: "KR詳細" },
  { id: "checkin", no: "⑤", label: "チェックイン" },
  { id: "review", no: "⑥", label: "期末の振り返り" },
  { id: "plan", no: "⑦", label: "計画（次期の下書き）" },
];

function Shell() {
  const { screen, setScreen, toast, locked } = useMock();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, [dark]);

  return (
    <div className="mk-app">
      <div className="mk-banner print-hide" role="note">
        OKRモード モック（架空データ・保存されません）
        <span className="mk-banner-sub">今日＝{formatFull(TODAY)}で固定</span>
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setDark((d) => !d)}>
          {dark ? "ライトにする" : "ダークにする"}
        </button>
      </div>
      <div className="mk-body">
        <nav className="mk-nav print-hide" aria-label="OKRモードの画面">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`mk-nav-item${screen === n.id ? " is-active" : ""}`}
              aria-current={screen === n.id ? "page" : undefined}
              onClick={() => setScreen(n.id)}
            >
              <span className="mk-nav-no">{n.no}</span>
              <span className="mk-nav-label">{n.label}</span>
              {n.id === "import" && !locked && <span className="mk-dot" title="確定待ち" />}
            </button>
          ))}
        </nav>
        <main className="mk-main">
          {screen === "home" && <HomeScreen />}
          {screen === "import" && <ImportScreen />}
          {screen === "map" && <MapScreen />}
          {screen === "kr" && <KrDetailScreen />}
          {screen === "checkin" && <CheckinScreen />}
          {screen === "review" && (
            <Placeholder title="⑥ 期末の振り返り" note="期の終わりに、KRごとの結果と学びを振り返る画面です。次版で作成します。" />
          )}
          {screen === "plan" && (
            <Placeholder title="⑦ 計画（次期の下書き）" note="次の期のOKR案を下書きする副次的な画面です。次版で作成します。" />
          )}
        </main>
      </div>
      {toast && (
        <div className="mk-toast print-hide" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <MockProvider>
      <Shell />
    </MockProvider>
  );
}
