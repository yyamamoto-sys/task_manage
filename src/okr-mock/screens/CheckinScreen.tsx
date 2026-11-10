import { useState } from "react";
import { teams } from "../fixtures";
import { formatFull, nextCheckinDate, TODAY, WEEKDAYS } from "../logic";
import { useMock } from "../state";
import { MeetingMode } from "./MeetingMode";
import { PreReport } from "./PreReport";

export function CheckinScreen() {
  const { teamId, setTeamId } = useMock();
  const [tab, setTab] = useState<"pre" | "meeting">("pre");
  const team = teams.find((t) => t.id === teamId) ?? teams[0];
  const next = nextCheckinDate(TODAY, team.checkinWeekday);

  return (
    <div>
      <div className="print-hide">
        <h1 className="mk-h1">⑤ チェックイン</h1>
        <div className="mk-row" role="group" aria-label="チームの選択">
          {teams.map((t) => (
            <button key={t.id} type="button" className={`mk-btn${t.id === team.id ? " mk-btn-primary" : ""}`} aria-pressed={t.id === team.id} onClick={() => setTeamId(t.id)}>
              {t.name}（毎週{WEEKDAYS[t.checkinWeekday]}曜）
            </button>
          ))}
        </div>
        <p className="mk-lead" style={{ marginTop: 10 }}>
          次回のチェックイン：<strong>{formatFull(next)}</strong>
          {next === TODAY ? "（本日）" : ""}
        </p>
        <div className="mk-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "pre"} className={`mk-tab${tab === "pre" ? " is-active" : ""}`} onClick={() => setTab("pre")}>
            事前レポート（マネージャー向け）
          </button>
          <button type="button" role="tab" aria-selected={tab === "meeting"} className={`mk-tab${tab === "meeting" ? " is-active" : ""}`} onClick={() => setTab("meeting")}>
            会議モード
          </button>
        </div>
      </div>
      {tab === "pre" ? <PreReport key={team.id} team={team} /> : <MeetingMode key={team.id} team={team} />}
    </div>
  );
}
