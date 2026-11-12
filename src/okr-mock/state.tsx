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
import { applyDrafts, compareOkr, crossedMilestones, itemsInQuarter, type LinkCtx, type Milestone, type Resolution } from "./logic";
import type { Band, Checkin, Decision, KrAnswer, KrRecord, OkrItem } from "./types";

export type ViewMode = "team" | "self";
export type Selection = { type: "kr"; id: string } | { type: "task"; id: string } | null;
export type ModalId = "goals" | "table" | null;
export interface Celebration {
  id: number;
  krId: string;
  kind: Milestone;
}

const okrInit = itemsInQuarter(okrAll, CURRENT_QUARTER);

interface MockState {
  viewerId: string;
  setViewerId: (id: string) => void;
  /** 本人（本人にしか見えない情報の持ち主）として見ているか */
  isOwner: boolean;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  guideOpen: boolean;
  closeGuide: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  modal: ModalId;
  setModal: (m: ModalId) => void;
  celebrations: Celebration[];
  decisionsOpen: boolean;
  setDecisionsOpen: (v: boolean) => void;
  /** 確定したばかりで、決定事項と宿題の欄に加わった件数 */
  newDecisions: number;
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
  /** 確定する。越えた節目（KRごと）を返す */
  confirmImport: (resourceId: string, values: Record<string, number | Band>) => Celebration[];
  /** つなぎ先の上書き（タスクID → KR ID） */
  overrides: Record<string, string>;
  setOverride: (taskId: string, krId: string | undefined) => void;
  linkCtx: LinkCtx;
  proposals: Record<string, "taken" | "skipped" | undefined>;
  setProposal: (taskId: string, v: "taken" | "skipped" | undefined) => void;
  how: Record<string, string>;
  setHow: (taskId: string, text: string | undefined) => void;
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

export interface InitialView {
  viewerId?: string;
  mode?: ViewMode;
  sel?: Selection;
  drawerOpen?: boolean;
}

export function MockProvider({ children, initial }: { children: ReactNode; initial?: InitialView }) {
  const [viewerId, setViewerId] = useState(initial?.viewerId ?? OWNER_ID);
  const [mode, setMode] = useState<ViewMode>(initial?.mode ?? "team");
  const [sel, setSel] = useState<Selection>(initial?.sel ?? null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(initial?.drawerOpen ?? false);
  const [modal, setModal] = useState<ModalId>(null);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [newDecisions, setNewDecisions] = useState(0);
  const [items, setItems] = useState<OkrItem[]>(okrInit);
  const [locked, setLocked] = useState(true);
  const [imported, setImported] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [records, setRecords] = useState<Record<string, KrRecord>>(recordsInit);
  const [checkins, setCheckins] = useState<Checkin[]>(checkinsInit);
  const [decisions, setDecisions] = useState<Decision[]>(decisionsInit);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Record<string, "taken" | "skipped" | undefined>>({});
  const [how, setHowState] = useState<Record<string, string>>({});
  const [personalLinks, setPersonalLinks] = useState(personalLinksInit);
  const [answers, setAnswers] = useState<Record<string, KrAnswer>>({});
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const celebTimer = useRef<number | undefined>(undefined);
  const celebSeq = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const linkCtx = useMemo<LinkCtx>(() => ({ pjs: pjsInit, items, overrides }), [items, overrides]);

  const value = useMemo<MockState>(
    () => ({
      viewerId,
      setViewerId,
      isOwner: viewerId === OWNER_ID,
      mode,
      setMode,
      sel,
      setSel,
      guideOpen,
      closeGuide: () => setGuideOpen(false),
      drawerOpen,
      setDrawerOpen,
      modal,
      setModal,
      celebrations,
      decisionsOpen,
      setDecisionsOpen,
      newDecisions,
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
        if (!res) return [];
        const ci = res.checkinId === nextCheckin.id ? nextCheckin : checkins.find((c) => c.id === res.checkinId);
        if (!ci) return [];
        const next = applyDrafts(records, res.drafts, values, ci.date);
        const found: Celebration[] = [];
        for (const d of res.drafts) {
          for (const kind of crossedMilestones(records[d.krId], next[d.krId])) {
            celebSeq.current += 1;
            found.push({ id: celebSeq.current, krId: d.krId, kind });
          }
        }
        setRecords(next);
        setCheckins((p) => (p.some((c) => c.id === ci.id) ? p : [...p, ci]));
        setDecisions((p) => [
          ...p.filter((d) => d.checkinId !== ci.id),
          ...res.decisions.map((d, i) => ({ ...d, id: `${ci.id}-${i}`, checkinId: ci.id })),
        ]);
        setNewDecisions(res.decisions.length);
        setDecisionsOpen(true);
        setCelebrations(found);
        window.clearTimeout(celebTimer.current);
        celebTimer.current = window.setTimeout(() => setCelebrations([]), 3600);
        return found;
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
      setHow: (taskId, text) =>
        setHowState((p) => {
          const n = { ...p };
          if (text) n[taskId] = text;
          else delete n[taskId];
          return n;
        }),
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
    [viewerId, mode, sel, guideOpen, drawerOpen, modal, celebrations, decisionsOpen, newDecisions, items, locked, imported, resolutions, records, checkins, decisions, overrides, linkCtx, proposals, how, personalLinks, answers, toast, showToast],
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
