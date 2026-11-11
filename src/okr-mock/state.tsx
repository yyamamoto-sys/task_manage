import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  checkpointsDec,
  checkpointsInit,
  CURRENT_QUARTER,
  fixedSynergies,
  kintoneTexts,
  members,
  okrItems as okrAll,
  pjsInit,
  QUARTER_INFO,
  selfReportsInit,
  tasks,
  teams,
} from "./fixtures";
import { buildSynergies, compareOkr, itemsInQuarter, TODAY, weekWindow, type Resolution } from "./logic";
import type { Checkpoint, OkrItem, Pj, SelfReport, Synergy, SynergyStatus } from "./types";

export type ScreenId = "home" | "import" | "map" | "kr" | "link" | "checkin" | "review" | "plan";

const okrInit = itemsInQuarter(okrAll, CURRENT_QUARTER);

interface MockState {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  items: OkrItem[];
  locked: boolean;
  lockedAt: string;
  imported: boolean;
  setImported: (v: boolean) => void;
  resolutions: Record<string, Resolution>;
  setResolution: (id: string, r: Resolution) => void;
  lock: (finalTexts: Record<string, string>) => void;
  unlockDemo: () => void;
  pjs: Pj[];
  linkPj: (pjId: string, tfId: string) => void;
  unlinkPj: (pjId: string, tfId: string) => void;
  selectedKr: string;
  setSelectedKr: (id: string) => void;
  openKr: (id: string) => void;
  teamId: string;
  setTeamId: (id: string) => void;
  reminded: Set<string>;
  markReminded: (ids: string[]) => void;
  toast: string | null;
  showToast: (msg: string) => void;
  kintone: Record<string, string>;
  reports: Record<string, SelfReport>;
  setReport: (tfId: string, patch: Partial<Pick<SelfReport, "level" | "note">>) => void;
  checkpoints: Checkpoint[];
  decImported: boolean;
  importCheckpoints: () => void;
  synergies: Synergy[];
  synergyStatus: Record<string, SynergyStatus | undefined>;
  setSynergyStatus: (id: string, st: SynergyStatus | undefined) => void;
  pendingSynergies: Synergy[];
  pickedSynergies: Synergy[];
}

const Ctx = createContext<MockState | null>(null);

export function useMock(): MockState {
  const v = useContext(Ctx);
  if (!v) throw new Error("MockProvider の外です");
  return v;
}

export function MockProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenId>("home");
  const [items, setItems] = useState<OkrItem[]>(okrInit);
  const [locked, setLocked] = useState(true);
  const [imported, setImported] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [pjs, setPjs] = useState<Pj[]>(pjsInit);
  const [selectedKr, setSelectedKr] = useState("kr1");
  const [teamId, setTeamId] = useState("ta");
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, SelfReport>>(selfReportsInit);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(checkpointsInit);
  const [synergyStatus, setSynStatus] = useState<Record<string, SynergyStatus | undefined>>({});
  const timer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const synergies = useMemo(
    () => [...buildSynergies({ tasks, pjs, items, today: TODAY, members }), ...fixedSynergies],
    [pjs, items],
  );

  const value = useMemo<MockState>(
    () => ({
      screen,
      setScreen,
      items,
      locked,
      lockedAt: QUARTER_INFO[CURRENT_QUARTER].lockedAt,
      imported,
      setImported,
      resolutions,
      setResolution: (id, r) => setResolutions((p) => ({ ...p, [id]: r })),
      lock: (finalTexts) => {
        setItems((prev) => prev.map((i) => (i.kind === "tf" ? { ...i, text: finalTexts[i.id] ?? i.text } : i)));
        setLocked(true);
      },
      unlockDemo: () => {
        setItems(okrInit);
        setLocked(false);
        setImported(false);
        setResolutions({});
      },
      pjs,
      linkPj: (pjId, tfId) =>
        setPjs((p) => p.map((x) => (x.id === pjId && !x.tfIds.includes(tfId) ? { ...x, tfIds: [...x.tfIds, tfId] } : x))),
      unlinkPj: (pjId, tfId) =>
        setPjs((p) => p.map((x) => (x.id === pjId ? { ...x, tfIds: x.tfIds.filter((t) => t !== tfId) } : x))),
      selectedKr,
      setSelectedKr,
      openKr: (id) => {
        setSelectedKr(id);
        setScreen("kr");
      },
      teamId,
      setTeamId,
      reminded,
      markReminded: (ids) => setReminded((p) => new Set([...p, ...ids])),
      toast,
      showToast,
      kintone: kintoneTexts,
      reports,
      setReport: (tfId, patch) =>
        setReports((p) => ({ ...p, [tfId]: { ...(p[tfId] ?? { level: "順調", note: "" }), ...patch, date: TODAY } })),
      checkpoints,
      decImported: checkpoints.some((c) => c.month === "2026-12"),
      importCheckpoints: () => setCheckpoints((p) => (p.some((c) => c.month === "2026-12") ? p : [...p, ...checkpointsDec])),
      synergies,
      synergyStatus,
      setSynergyStatus: (id, st) => setSynStatus((p) => ({ ...p, [id]: st })),
      pendingSynergies: synergies.filter((x) => !synergyStatus[x.id]),
      pickedSynergies: synergies.filter((x) => synergyStatus[x.id] === "picked"),
    }),
    [screen, items, locked, imported, resolutions, pjs, selectedKr, teamId, reminded, toast, showToast, reports, checkpoints, synergies, synergyStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 突き合わせの対象は今期のTFだけ（目標・KRは半期の間ずっと固定） */
export function useCompareRows() {
  const { items, kintone } = useMock();
  return useMemo(
    () =>
      compareOkr(
        items.filter((i) => i.kind === "tf"),
        kintone,
      ),
    [items, kintone],
  );
}

/** 画面で選んでいるチームの「今週」（前回チェックインの翌日〜今回のチェックイン日） */
export function useWeek() {
  const { teamId } = useMock();
  const team = teams.find((t) => t.id === teamId) ?? teams[0];
  return { team, win: weekWindow(TODAY, team.checkinWeekday) };
}
