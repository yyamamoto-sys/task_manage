import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  checkinsInit,
  CURRENT_QUARTER,
  decisionsInit,
  kintoneTexts,
  nextCheckin,
  okrItems as okrAll,
  OWNER_ID,
  personalLinksInit,
  pjsInit,
  QUARTER_INFO,
  recordsInit,
  resources,
} from "./fixtures";
import { applyDrafts, compareOkr, itemsInQuarter, type LinkCtx, type Resolution } from "./logic";
import type { Band, Checkin, Decision, KrAnswer, KrRecord, OkrItem } from "./types";

export type ScreenId = "map" | "table" | "import-doc" | "decisions" | "myokr" | "tasklink" | "reflect" | "daily" | "goals";

const okrInit = itemsInQuarter(okrAll, CURRENT_QUARTER);

interface MockState {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  viewerId: string;
  setViewerId: (id: string) => void;
  /** 本人（本人にしか見えない情報の持ち主）として見ているか */
  isOwner: boolean;
  items: OkrItem[];
  locked: boolean;
  lockedAt: string;
  imported: boolean;
  setImported: (v: boolean) => void;
  resolutions: Record<string, Resolution>;
  setResolution: (id: string, r: Resolution) => void;
  lock: (finalTexts: Record<string, string>) => void;
  unlockDemo: () => void;
  kintone: Record<string, string>;
  records: Record<string, KrRecord>;
  checkins: Checkin[];
  decisions: Decision[];
  confirmImport: (resourceId: string, values: Record<string, number | Band>) => void;
  selectedKr: string | null;
  setSelectedKr: (id: string | null) => void;
  openKrRow: (id: string) => void;
  /** つなぎ先の上書き（タスクID → KR ID） */
  overrides: Record<string, string>;
  setOverride: (taskId: string, krId: string | undefined) => void;
  linkCtx: LinkCtx;
  proposals: Record<string, "taken" | "skipped" | undefined>;
  setProposal: (taskId: string, v: "taken" | "skipped" | undefined) => void;
  how: Record<string, string>;
  setHow: (taskId: string, text: string) => void;
  personalLinks: { personalId: string; krId: string }[];
  togglePersonalLink: (personalId: string, krId: string) => void;
  answers: Record<string, KrAnswer>;
  setAnswer: (krId: string, patch: KrAnswer) => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<MockState | null>(null);

export function useMock(): MockState {
  const v = useContext(Ctx);
  if (!v) throw new Error("MockProvider の外です");
  return v;
}

export function MockProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenId>("map");
  const [viewerId, setViewerId] = useState(OWNER_ID);
  const [items, setItems] = useState<OkrItem[]>(okrInit);
  const [locked, setLocked] = useState(true);
  const [imported, setImported] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [records, setRecords] = useState<Record<string, KrRecord>>(recordsInit);
  const [checkins, setCheckins] = useState<Checkin[]>(checkinsInit);
  const [decisions, setDecisions] = useState<Decision[]>(decisionsInit);
  const [selectedKr, setSelectedKr] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Record<string, "taken" | "skipped" | undefined>>({});
  const [how, setHowState] = useState<Record<string, string>>({});
  const [personalLinks, setPersonalLinks] = useState(personalLinksInit);
  const [answers, setAnswers] = useState<Record<string, KrAnswer>>({});
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const linkCtx = useMemo<LinkCtx>(() => ({ pjs: pjsInit, items, overrides }), [items, overrides]);

  const value = useMemo<MockState>(
    () => ({
      screen,
      setScreen,
      viewerId,
      setViewerId,
      isOwner: viewerId === OWNER_ID,
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
      kintone: kintoneTexts,
      records,
      checkins,
      decisions,
      confirmImport: (resourceId, values) => {
        const res = resources.find((r) => r.id === resourceId);
        if (!res) return;
        const ci = res.checkinId === nextCheckin.id ? nextCheckin : checkins.find((c) => c.id === res.checkinId);
        if (!ci) return;
        setRecords((p) => applyDrafts(p, res.drafts, values, ci.date));
        setCheckins((p) => (p.some((c) => c.id === ci.id) ? p : [...p, ci]));
        setDecisions((p) => [
          ...p.filter((d) => d.checkinId !== ci.id),
          ...res.decisions.map((d, i) => ({ ...d, id: `${ci.id}-${i}`, checkinId: ci.id })),
        ]);
      },
      selectedKr,
      setSelectedKr,
      openKrRow: (id) => {
        setSelectedKr(id);
        setScreen("table");
      },
      overrides,
      setOverride: (taskId, krId) =>
        setOverrides((p) => {
          const n = { ...p };
          if (krId) n[taskId] = krId;
          else delete n[taskId];
          return n;
        }),
      linkCtx,
      proposals,
      setProposal: (taskId, v) => setProposals((p) => ({ ...p, [taskId]: v })),
      how,
      setHow: (taskId, text) => setHowState((p) => ({ ...p, [taskId]: text })),
      personalLinks,
      togglePersonalLink: (personalId, krId) =>
        setPersonalLinks((p) =>
          p.some((l) => l.personalId === personalId && l.krId === krId)
            ? p.filter((l) => !(l.personalId === personalId && l.krId === krId))
            : [...p, { personalId, krId }],
        ),
      answers,
      setAnswer: (krId, patch) => setAnswers((p) => ({ ...p, [krId]: { ...p[krId], ...patch } })),
      toast,
      showToast,
    }),
    [screen, viewerId, items, locked, imported, resolutions, records, checkins, decisions, selectedKr, overrides, linkCtx, proposals, how, personalLinks, answers, toast, showToast],
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
