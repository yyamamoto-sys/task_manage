import { useEffect, useRef, useState } from "react";
import { scrollToId } from "./nav";
import { members, PERIOD_START, REACH_PJ_IDS, tasks as allTasks, VIEWER_IDS } from "./fixtures";
import { formatFull, TODAY } from "./logic";
import { reachCounts, registeredTasks, type Reach } from "./reach";
import { MockProvider, useMock, type InitialView } from "./state";
import { CompareTable } from "./parts/CompareTable";
import { DecisionsFold } from "./parts/DecisionsFold";
import { DetailPanel } from "./parts/DetailPanel";
import { DocDrawer } from "./parts/DocDrawer";
import { FlowDiagram } from "./parts/FlowDiagram";
import { FocusCard } from "./parts/FocusCard";
import { ClaimsBanner } from "./parts/Claims";
import { SelfHead, SelfPicks, SelfSection } from "./parts/SelfSection";
import { Sidebar } from "./parts/Sidebar";
import { TeamBand } from "./parts/TeamBand";
import { OBlock, RecentLearnings } from "./parts/OBlock";
import { GoalsScreen } from "./screens/GoalsScreen";
import { Modal } from "./ui";

function Header() {
  const { setModal, locked } = useMock();
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
      <button type="button" className="mk-iconbtn" aria-label={`O・KRの取り込み${locked ? "" : "（確定待ち）"}`} title="O・KRの取り込み" onClick={() => setModal("goals")}>
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
  const { guideOpen, closeGuide, setMode } = useMock();
  if (!guideOpen) return null;
  return (
    <nav className="mk-guide print-hide" aria-label="はじめての人向けの案内">
      <ol className="mk-guide-steps">
        <li>
          <span className="mk-guide-no">1</span>
          <span>左の「チーム」で全体、「わたし」で自分の仕事を見ます</span>
        </li>
        <li>
          <span className="mk-guide-no">2</span>
          <span>左の KR を押すと詳細が開きます</span>
        </li>
        <li>
          <span className="mk-guide-no">3</span>
          <a className="mk-linkbtn" href="#mk-flow-h">
            地図で見立てを見る
          </a>
        </li>
        <li>
          <span className="mk-guide-no">4</span>
          <button type="button" className="mk-linkbtn" onClick={() => setMode("self", "mk-focus-h")}>
            「わたし」で今週やる仕事を選ぶ
          </button>
        </li>
      </ol>
      <button type="button" className="mk-btn mk-btn-sm" onClick={closeGuide} aria-label="案内を閉じる">
        閉じる
      </button>
      <ul className="mk-guide-terms">
        <li>
          <b>見立て</b>：資料の記述からAIが出した、KRのいまの位置（60〜100）
        </li>
        <li>
          <b>段</b>：60・70・80…の目安。60 が出発点
        </li>
        <li>
          <b>手がかり</b>：状態を観るための数字（例：12社／30社）
        </li>
        <li>
          <b>地図</b>：仕事から KR、O へのつながりを示す図
        </li>
      </ul>
    </nav>
  );
}

function FlowAndDetail() {
  return (
    <div className="mk-flowwrap">
      <FlowDiagram />
      <DetailPanel />
    </div>
  );
}

function Shell() {
  const { toast, mode, pageAnchor, sidebarCollapsed, drawerOpen, modal, setModal, viewerId, setViewerId, reach, setReach, linkCtx } = useMock();
  const pjsCounts = reachCounts(registeredTasks(allTasks, "pjs", viewerId, REACH_PJ_IDS), linkCtx, PERIOD_START);
  const reachLabels: Record<Reach, string> = {
    all: "全員が登録（いまの架空データ）",
    pjs: `${pjsCounts.total}PJ中${pjsCounts.registered}PJ（一部のPJだけ登録）`,
    solo: "1人だけ（見ている人の仕事だけ登録）",
  };
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }, [dark]);

  // ページを切り替えたら先頭へ戻す（場所を指定されたときはそこへ）。最初の表示では動かさない
  const mainRef = useRef<HTMLElement>(null);
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const anchor = pageAnchor.current;
    pageAnchor.current = null;
    if (anchor && document.getElementById(anchor)) scrollToId(anchor);
    else {
      mainRef.current?.scrollTo?.(0, 0);
      window.scrollTo?.(0, 0);
    }
  }, [mode, pageAnchor]);

  return (
    <div className={`mk-app${sidebarCollapsed ? " is-sb-collapsed" : ""}`}>
      <div className="mk-banner print-hide" role="note">
        OKRモード モック（架空データ・保存されません）
        <span className="mk-banner-sub">今日＝{formatFull(TODAY)}で固定</span>
        <label className="mk-small mk-viewer">
          見ている人（モック用の切替）{" "}
          <select className="mk-select" style={{ width: 170, display: "inline-block" }} value={viewerId} onChange={(e) => setViewerId(e.target.value)}>
            {VIEWER_IDS.map((id) => {
              const m = members.find((x) => x.id === id)!;
              return (
                <option key={id} value={id}>
                  {m.name}（{m.role}）
                </option>
              );
            })}
          </select>
        </label>
        <label className="mk-small mk-viewer">
          利用の広がり（モック用の切替・成果は変わりません）{" "}
          <select className="mk-select" style={{ width: 250, display: "inline-block" }} value={reach} onChange={(e) => setReach(e.target.value as Reach)}>
            {(["all", "pjs", "solo"] as const).map((r) => (
              <option key={r} value={r}>
                {reachLabels[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setDark((d) => !d)}>
          {dark ? "ライトにする" : "ダークにする"}
        </button>
      </div>
      <div className="mk-shell">
        <Sidebar />
        <main ref={mainRef} className="mk-main mk-onepage">
          <Header />
          <Guide />
          {mode === "team" ? (
            <>
              <OBlock />
              <TeamBand />
              <RecentLearnings />
              <ClaimsBanner />
              <FlowAndDetail />
              <DecisionsFold />
            </>
          ) : (
            <>
              <SelfHead />
              <FocusCard />
              <SelfPicks />
              <FlowAndDetail />
              <SelfSection />
            </>
          )}
        </main>
      </div>
      {drawerOpen && <DocDrawer />}
      {modal === "goals" && (
        <Modal title="O・KRの取り込み" onClose={() => setModal(null)} wide>
          <GoalsScreen />
        </Modal>
      )}
      {modal === "table" && (
        <Modal title="表で見る（全KRの段の基準といま）" onClose={() => setModal(null)} wide>
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
