import { useEffect, useState } from "react";
import { members, OWNER_ID, VIEWER_IDS } from "./fixtures";
import { formatFull, TODAY } from "./logic";
import { MockProvider, useMock, type InitialView } from "./state";
import { CompareTable } from "./parts/CompareTable";
import { DecisionsFold } from "./parts/DecisionsFold";
import { DetailPanel } from "./parts/DetailPanel";
import { DocDrawer } from "./parts/DocDrawer";
import { FlowDiagram } from "./parts/FlowDiagram";
import { FocusCard } from "./parts/FocusCard";
import { SelfSection } from "./parts/SelfSection";
import { TeamBand } from "./parts/TeamBand";
import { GoalsScreen } from "./screens/GoalsScreen";
import { Modal } from "./ui";

function Header() {
  const { viewerId, setViewerId, mode, setMode, setDrawerOpen, setModal, locked } = useMock();
  return (
    <header className="mk-head print-hide">
      <div className="mk-head-title">
        <svg width={34} height={34} viewBox="-17 -17 34 34" aria-hidden="true">
          <circle r={15} fill="#3b6fd4" opacity={0.15} />
          <circle cx={-6} cy={5} r={4} fill="#e08a00" />
          <circle cx={7} cy={-6} r={4} fill="#1a9a6b" />
          <circle cx={8} cy={8} r={3} fill="#c2338a" />
          <path d="M-6 5 C-2 -4 2 -6 7 -6 M-6 5 C0 9 4 9 8 8" stroke="#3b6fd4" strokeWidth={2} fill="none" strokeLinecap="round" />
        </svg>
        <div>
          <h1 className="mk-h1" style={{ margin: 0 }}>
            OKRモード
          </h1>
          <div className="mk-concept">日々の仕事と OKR をつなぐ地図</div>
        </div>
      </div>
      <span className="mk-spacer" />
      <label className="mk-small">
        見ている人{" "}
        <select className="mk-select" style={{ width: 190, display: "inline-block" }} value={viewerId} onChange={(e) => setViewerId(e.target.value)}>
          {VIEWER_IDS.map((id) => {
            const m = members.find((x) => x.id === id)!;
            return (
              <option key={id} value={id}>
                {m.name}（{id === OWNER_ID ? "本人・" : ""}
                {m.role}）
              </option>
            );
          })}
        </select>
      </label>
      <div className="mk-seg" role="radiogroup" aria-label="表示の切替">
        {(
          [
            ["team", "チーム"],
            ["self", "自分"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={`mk-seg-item${mode === id ? " is-on" : ""}`}>
            <input type="radio" name="mk-mode" className="mk-sr" checked={mode === id} onChange={() => setMode(id)} />
            {label}
          </label>
        ))}
      </div>
      <button type="button" className="mk-btn mk-btn-primary" onClick={() => setDrawerOpen(true)}>
        資料を読ませる
      </button>
      <button type="button" className="mk-iconbtn" aria-label={`目標の取り込み${locked ? "" : "（確定待ち）"}`} title="目標の取り込み" onClick={() => setModal("goals")}>
        <svg width={18} height={18} viewBox="-10 -10 20 20" aria-hidden="true">
          <circle r={3} fill="none" stroke="currentColor" strokeWidth={1.8} />
          <path
            d="M0 -8 L1.6 -5.4 L4.6 -6.4 L5 -3.3 L8 -2.2 L6.2 0.4 L8 3 L5 4 L4.4 7 L1.4 6 L0 8.6 L-1.4 6 L-4.4 7 L-5 4 L-8 3 L-6.2 0.4 L-8 -2.2 L-5 -3.3 L-4.6 -6.4 L-1.6 -5.4 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
        {!locked && <span className="mk-dot mk-dot-abs" />}
      </button>
    </header>
  );
}

function Guide() {
  const { guideOpen, closeGuide, setDrawerOpen, setMode, isOwner } = useMock();
  if (!guideOpen) return null;
  return (
    <nav className="mk-guide print-hide" aria-label="はじめての人向けの案内">
      <ol className="mk-guide-steps">
        <li>
          <span className="mk-guide-no">1</span>
          <button type="button" className="mk-linkbtn" onClick={() => setDrawerOpen(true)}>
            資料を読ませる
          </button>
        </li>
        <li>
          <span className="mk-guide-no">2</span>
          <span>地図で進みを見る</span>
        </li>
        <li>
          <span className="mk-guide-no">3</span>
          <button type="button" className="mk-linkbtn" onClick={() => setMode("self")} disabled={!isOwner} title={isOwner ? undefined : "本人の立場のときに使えます"}>
            自分の仕事を確かめる
          </button>
        </li>
      </ol>
      <button type="button" className="mk-btn mk-btn-sm" onClick={closeGuide} aria-label="案内を閉じる">
        閉じる
      </button>
    </nav>
  );
}

function Shell() {
  const { toast, sel, mode, isOwner, drawerOpen, modal, setModal } = useMock();
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
      <main className="mk-main mk-onepage">
        <Header />
        <Guide />
        <TeamBand />
        <FocusCard />
        <div className={`mk-flowwrap${sel ? " has-panel" : ""}`}>
          <FlowDiagram />
          <DetailPanel />
        </div>
        {mode === "self" && isOwner && <SelfSection />}
        <DecisionsFold />
      </main>
      {drawerOpen && <DocDrawer />}
      {modal === "goals" && (
        <Modal title="目標の取り込み" onClose={() => setModal(null)} wide>
          <GoalsScreen />
        </Modal>
      )}
      {modal === "table" && (
        <Modal title="表で見る（全KRの目標と現状）" onClose={() => setModal(null)} wide>
          <CompareTable />
        </Modal>
      )}
      {toast && (
        <div className="mk-toast print-hide" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function App({ initial }: { initial?: InitialView }) {
  return (
    <MockProvider initial={initial}>
      <Shell />
    </MockProvider>
  );
}
