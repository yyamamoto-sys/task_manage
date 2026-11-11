import { useEffect, useState } from "react";
import { members, OWNER_ID, VIEWER_IDS } from "./fixtures";
import { formatFull, TODAY } from "./logic";
import { MockProvider, useMock, type ScreenId } from "./state";
import { DailyScreen } from "./screens/DailyScreen";
import { DecisionsScreen } from "./screens/DecisionsScreen";
import { DocScreen } from "./screens/DocScreen";
import { GoalsScreen } from "./screens/GoalsScreen";
import { MapScreen } from "./screens/MapScreen";
import { MyOkrScreen } from "./screens/MyOkrScreen";
import { ReflectScreen } from "./screens/ReflectScreen";
import { TableScreen } from "./screens/TableScreen";
import { TaskLinkScreen } from "./screens/TaskLinkScreen";

const NAV: { id: ScreenId; no: string; label: string; priv?: boolean }[] = [
  { id: "map", no: "1", label: "地図" },
  { id: "table", no: "2", label: "対照表" },
  { id: "import-doc", no: "3", label: "資料を読ませる" },
  { id: "decisions", no: "4", label: "決定事項と宿題" },
  { id: "myokr", no: "5", label: "自分のOKR", priv: true },
  { id: "tasklink", no: "6", label: "仕事のつなぎ", priv: true },
  { id: "reflect", no: "7", label: "週の振り返り", priv: true },
  { id: "daily", no: "8", label: "日々の画面の見本" },
  { id: "goals", no: "-", label: "目標の取り込み" },
];

function Shell() {
  const { screen, setScreen, toast, viewerId, setViewerId, locked } = useMock();
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
        <label className="mk-small">
          見ている人{" "}
          <select className="mk-select" style={{ width: 190, display: "inline-block" }} value={viewerId} onChange={(e) => setViewerId(e.target.value)}>
            {VIEWER_IDS.map((id) => {
              const m = members.find((x) => x.id === id)!;
              return (
                <option key={id} value={id}>
                  {m.name}（{id === OWNER_ID ? "本人・" : ""}{m.role}）
                </option>
              );
            })}
          </select>
        </label>
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
              {n.priv && <span className="mk-chip" style={{ marginLeft: "auto" }}>本人のみ</span>}
              {n.id === "goals" && !locked && <span className="mk-dot" title="確定待ち" />}
            </button>
          ))}
        </nav>
        <main className="mk-main">
          {screen === "map" && <MapScreen />}
          {screen === "table" && <TableScreen />}
          {screen === "import-doc" && <DocScreen />}
          {screen === "decisions" && <DecisionsScreen />}
          {screen === "myokr" && <MyOkrScreen />}
          {screen === "tasklink" && <TaskLinkScreen />}
          {screen === "reflect" && <ReflectScreen />}
          {screen === "daily" && <DailyScreen />}
          {screen === "goals" && <GoalsScreen />}
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
