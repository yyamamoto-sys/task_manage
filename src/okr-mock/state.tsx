import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectConflicts, mergeDecisions, mergeDrafts } from "./confirm";
import {
  checkinsInit,
  CURRENT_QUARTER,
  decisionsInit,
  DEFAULT_VIEWER,
  kintoneRows,
  nextCheckin,
  okrItems as okrAll,
  pjsInit,
  QUARTER_INFO,
  recordsInit,
  resources,
  WEEK_START,
} from "./fixtures";
import { applyDrafts, compareOkr, crossedMilestones, deltaText, importKintone, itemsInQuarter, type LinkCtx, type Milestone } from "./logic";
import type { Band, Checkin, Decision, KintoneRow, KrAnswer, KrRecord, OkrItem, Task } from "./types";
import * as U from "./userState";

export type ViewMode = "team" | "self";
export type Selection = { type: "kr"; id: string } | { type: "task"; id: string } | null;
export type ModalId = "goals" | "table" | null;
export interface Celebration {
  id: number;
  krId: string;
  kind: Milestone;
}
/** 確定の直後に、値が動いたKRに出す増減の札 */
export interface Change {
  krId: string;
  text: string;
}

const okrInit = itemsInQuarter(okrAll, CURRENT_QUARTER);

interface MockState {
  /** 見ている人。「本人」＝この人（個人OKR・つなぎ先の変更・どう効くか・振り返り・今週やる・提案の採否の持ち主） */
  viewerId: string;
  setViewerId: (id: string) => void;
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
  changes: Change[];
  decisionsOpen: boolean;
  setDecisionsOpen: (v: boolean) => void;
  /** 確定したばかりで、決定事項と宿題の欄に加わった件数 */
  newDecisions: number;
  items: OkrItem[];
  locked: boolean;
  lockedAt: string;
  imported: boolean;
  setImported: (v: boolean) => void;
  /** Kintone（正）の内容を取り込んで確定する */
  importFromKintone: () => void;
  unlockDemo: () => void;
  kintone: KintoneRow[];
  records: Record<string, KrRecord>;
  checkins: Checkin[];
  decisions: Decision[];
  /** 回ごとに、最後に確定した人 */
  confirmedBy: Record<string, string>;
  /** 確定する（資料は複数選べる）。越えた節目を返す */
  confirmImport: (resourceIds: string[], picks: Record<string, number>, values: Record<string, number | Band>) => Celebration[];
  linkCtx: LinkCtx;
  /** 見ている人の分だけ */
  overrides: Record<string, string>;
  setOverride: (task: Task, krId: string | undefined) => void;
  proposals: Record<string, "taken" | "skipped">;
  takeProposal: (task: Task, krId: string) => void;
  setProposal: (taskId: string, v: "skipped" | undefined) => void;
  how: Record<string, string>;
  setHow: (taskId: string, krId: string, text: string | undefined) => void;
  personalLinks: { personalId: string; krId: string }[];
  togglePersonalLink: (personalId: string, krId: string) => void;
  answers: Record<string, KrAnswer>;
  setAnswer: (krId: string, patch: KrAnswer) => void;
  /** 今週「やる」と選んだ仕事（仕事ID） */
  picks: string[];
  togglePick: (task: Task) => void;
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
  confirmedBy?: Record<string, string>;
  changes?: Change[];
}

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MockProvider({ children, initial }: { children: ReactNode; initial?: InitialView }) {
  const [viewerId, setViewerId] = useState(initial?.viewerId ?? DEFAULT_VIEWER);
  const [mode, setMode] = useState<ViewMode>(initial?.mode ?? "team");
  const [sel, setSel] = useState<Selection>(initial?.sel ?? null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(initial?.drawerOpen ?? false);
  const [modal, setModal] = useState<ModalId>(null);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [changes, setChanges] = useState<Change[]>(initial?.changes ?? []);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [newDecisions, setNewDecisions] = useState(0);
  const [items, setItems] = useState<OkrItem[]>(okrInit);
  const [locked, setLocked] = useState(true);
  const [imported, setImported] = useState(true);
  const [records, setRecords] = useState<Record<string, KrRecord>>(recordsInit);
  const [checkins, setCheckins] = useState<Checkin[]>(checkinsInit);
  const [decisions, setDecisions] = useState<Decision[]>(decisionsInit);
  const [confirmedBy, setConfirmedBy] = useState<Record<string, string>>(initial?.confirmedBy ?? {});
  const [users, setUsers] = useState<U.UserStates>(() => U.initialUserStates(WEEK_START));
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const celebTimer = useRef<number | undefined>(undefined);
  const celebSeq = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // 増減の札：動きを減らす設定では静止表示にして、次の操作で消す。それ以外は少し経ったら消す
  const hasChanges = changes.length > 0;
  useEffect(() => {
    if (!hasChanges) return;
    const clear = () => setChanges([]);
    if (reducedMotion()) {
      window.addEventListener("pointerdown", clear, { once: true });
      window.addEventListener("keydown", clear, { once: true });
      return () => {
        window.removeEventListener("pointerdown", clear);
        window.removeEventListener("keydown", clear);
      };
    }
    const id = window.setTimeout(clear, 9000);
    return () => window.clearTimeout(id);
  }, [hasChanges, changes]);

  const me = U.userOf(users, viewerId);
  const overridesAll = useMemo(() => U.mergedOverrides(users), [users]);
  const linkCtx = useMemo<LinkCtx>(() => ({ pjs: pjsInit, items, overrides: overridesAll }), [items, overridesAll]);

  const value = useMemo<MockState>(
    () => ({
      viewerId,
      setViewerId,
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
      changes,
      decisionsOpen,
      setDecisionsOpen,
      newDecisions,
      items,
      locked,
      lockedAt: QUARTER_INFO[CURRENT_QUARTER].lockedAt,
      imported,
      setImported,
      importFromKintone: () => {
        setItems((prev) => importKintone(prev, kintoneRows, CURRENT_QUARTER));
        setLocked(true);
      },
      unlockDemo: () => {
        setItems(okrInit);
        setLocked(false);
        setImported(false);
      },
      kintone: kintoneRows,
      records,
      checkins,
      decisions,
      confirmedBy,
      confirmImport: (resourceIds, picks, values) => {
        const selected = resources.filter((r) => resourceIds.includes(r.id));
        if (selected.length === 0) return [];
        const ci = selected[0].checkinId === nextCheckin.id ? nextCheckin : checkins.find((c) => c.id === selected[0].checkinId);
        if (!ci) return [];
        const conflicts = detectConflicts(selected, records, ci.date);
        const drafts = mergeDrafts(selected, conflicts, picks);
        const next = applyDrafts(records, drafts, values, ci.date);
        const found: Celebration[] = [];
        const deltas: Change[] = [];
        for (const d of drafts) {
          for (const kind of crossedMilestones(records[d.krId], next[d.krId])) {
            celebSeq.current += 1;
            found.push({ id: celebSeq.current, krId: d.krId, kind });
          }
          const text = deltaText(records[d.krId], next[d.krId]);
          if (text) deltas.push({ krId: d.krId, text });
        }
        setRecords(next);
        setCheckins((p) => (p.some((c) => c.id === ci.id) ? p : [...p, ci]));
        setDecisions((p) => mergeDecisions(p, selected, ci));
        setConfirmedBy((p) => ({ ...p, [ci.id]: viewerId }));
        setNewDecisions(selected.reduce((s, r) => s + r.decisions.length, 0));
        setDecisionsOpen(true);
        setChanges(deltas);
        setCelebrations(found);
        window.clearTimeout(celebTimer.current);
        celebTimer.current = window.setTimeout(() => setCelebrations([]), 3600);
        return found;
      },
      linkCtx,
      overrides: me.overrides,
      setOverride: (task, krId) => setUsers((p) => U.setOverride(p, viewerId, task, krId)),
      proposals: me.proposals,
      takeProposal: (task, krId) => setUsers((p) => U.takeProposal(p, viewerId, task, krId)),
      setProposal: (taskId, v) => setUsers((p) => U.setProposal(p, viewerId, taskId, v)),
      how: me.how,
      setHow: (taskId, krId, text) => setUsers((p) => U.setHow(p, viewerId, taskId, krId, text)),
      personalLinks: me.personalLinks,
      togglePersonalLink: (personalId, krId) => setUsers((p) => U.toggleLink(p, viewerId, personalId, krId)),
      answers: me.answers,
      setAnswer: (krId, patch) => setUsers((p) => U.setAnswer(p, viewerId, WEEK_START, krId, patch)),
      picks: me.picks[WEEK_START] ?? [],
      togglePick: (task) => setUsers((p) => U.togglePick(p, viewerId, WEEK_START, task)),
      toast,
      showToast,
    }),
    [viewerId, mode, sel, guideOpen, drawerOpen, modal, celebrations, changes, decisionsOpen, newDecisions, items, locked, imported, records, checkins, decisions, confirmedBy, linkCtx, me, toast, showToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Kintone（正）とアプリの今期のTFの突き合わせ */
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
