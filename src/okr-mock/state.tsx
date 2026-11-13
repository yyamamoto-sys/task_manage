import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addOutcomeNotes, detectConflicts, mergeAssessments, mergeDecisions, mergeDrafts, mergeLearnings, notesOfResources } from "./confirm";
import {
  assessInit,
  checkinsInit,
  CURRENT_QUARTER,
  decisionsInit,
  DEFAULT_VIEWER,
  historyInit,
  kintoneRows,
  krBands,
  learningsInit,
  nextCheckin,
  okrItems as okrAll,
  pjsInit,
  QUARTER_INFO,
  REACH_PJ_IDS,
  recordsInit,
  resources,
  tasks as allTasks,
  WEEK_START,
} from "./fixtures";
import { applyConfirm, compareOkr, defaultKrIdsOfTask, importKintone, itemsInQuarter, type LinkCtx } from "./logic";
import { crossedStep, currentAssessment, deltaText, type CurrentAssessment } from "./steps";
import type { AssessEntry, Checkin, ClaimStatus, Decision, KintoneRow, KrAnswer, KrRecord, Learning, OkrItem, OutcomeNote, Task } from "./types";
import { addHistory, registeredTasks, type History, type Reach } from "./reach";
import * as U from "./userState";

export type ViewMode = "team" | "self";
export type Selection = { type: "kr"; id: string } | { type: "task"; id: string } | null;
export type ModalId = "goals" | "table" | null;
export interface Celebration {
  id: number;
  krId: string;
  /** 越えた段（例：70） */
  step: number;
}
/** 確定の直後に、見立てが動いたKRに出す増減の札（＋2 など） */
export interface Change {
  krId: string;
  text: string;
}

const okrInit = itemsInQuarter(okrAll, CURRENT_QUARTER);

interface MockState {
  /** 見ている人。「本人」＝この人（個人OKR・つなぎ先の変更・どう役立つか・振り返り・今週やる・提案の採否の持ち主） */
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
  /** KRごとの、回ごとの見立て（資料ごと） */
  assessHist: Record<string, AssessEntry[]>;
  /** KRごとの、いまの見立てと前回の見立て */
  assess: Record<string, CurrentAssessment | null>;
  /** 資料から拾った学び・気づき */
  learnings: Learning[];
  checkins: Checkin[];
  decisions: Decision[];
  /** 回ごとに、最後に確定した人 */
  confirmedBy: Record<string, string>;
  /** 確定する（資料は複数選べる）。越えた節目を返す */
  confirmImport: (resourceIds: string[], picks: Record<string, number>, values: Record<string, number>) => Celebration[];
  linkCtx: LinkCtx;
  /** 利用の広がり（モックの確認用の切替）。成果は変わらず、アプリに登録された仕事の範囲だけが変わる */
  reach: Reach;
  setReach: (r: Reach) => void;
  /** アプリに登録された仕事（利用の広がりで絞ったもの）。画面の仕事の数字はすべてこれから数える */
  tasks: Task[];
  /** 回ごとの成果の値（KRの詳細の「成果の推移」） */
  history: History;
  /** 見ている人の分だけ */
  overrides: Record<string, string[]>;
  /** つなぎ先を選び直す（KRの集合。空＝どれにもつながない）。undefined＝PJの既定に戻す */
  setOverride: (task: Task, krIds: string[] | undefined) => void;
  /** 提案の採否（仕事×KRごと） */
  proposals: Record<string, "taken" | "skipped">;
  /** 提案を1件採る。いまのつなぎ先に足す（置き換えない） */
  takeProposal: (task: Task, krId: string) => void;
  setProposal: (taskId: string, krId: string, v: "skipped" | undefined) => void;
  /** 地図で結節点の仕事とその帯だけを強調するか */
  junctionOnly: boolean;
  setJunctionOnly: (v: boolean) => void;
  how: Record<string, string>;
  setHow: (taskId: string, krId: string, text: string | undefined) => void;
  personalLinks: { personalId: string; krId: string }[];
  togglePersonalLink: (personalId: string, krId: string) => void;
  answers: Record<string, KrAnswer>;
  setAnswer: (krId: string, patch: KrAnswer) => void;
  /** 今週「やる」と選んだ仕事（仕事ID） */
  picks: string[];
  togglePick: (task: Task) => void;
  /** 確定した成果の記述（全員分・足し合わせ済み） */
  outcomeNotes: OutcomeNote[];
  /** 見ている人に届いた結びつき（claimKey → 答え）。本人の分だけ */
  claims: Record<string, ClaimStatus>;
  answerClaim: (noteKey: string, task: Task, v: "yes" | "no") => void;
  /** 「そのとおり」と確かめられた結びつき（全員に見える） */
  confirmedLinks: U.ConfirmedLink[];
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
  /** 利用の広がりを指定して始める（描画の確認用。既定は全員が登録） */
  reach?: Reach;
  /** 結節点だけを強調した状態で始める（描画の確認用） */
  junctionOnly?: boolean;
  /** 本人が選んだつなぎ先の初期状態を差し替える（利用者ID → 仕事ID → KRの集合。描画の確認用。書かない利用者は空） */
  overrides?: Record<string, Record<string, string[]>>;
  /** 確定済みの成果の記述と、利用者ごとの結びつきへの答え（描画の確認用） */
  outcome?: { notes: OutcomeNote[]; claims: Record<string, Record<string, ClaimStatus>> };
  /** 学び・気づきの初期状態を差し替える（描画の確認用） */
  learnings?: Learning[];
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
  const [history, setHistory] = useState<History>(historyInit);
  const [assessHist, setAssessHist] = useState<Record<string, AssessEntry[]>>(assessInit);
  const [learnings, setLearnings] = useState<Learning[]>(initial?.learnings ?? learningsInit);
  const [reach, setReachState] = useState<Reach>(initial?.reach ?? "all");
  const [checkins, setCheckins] = useState<Checkin[]>(checkinsInit);
  const [decisions, setDecisions] = useState<Decision[]>(decisionsInit);
  const [confirmedBy, setConfirmedBy] = useState<Record<string, string>>(initial?.confirmedBy ?? {});
  const [users, setUsers] = useState<U.UserStates>(() => {
    const base = U.initialUserStates(WEEK_START);
    for (const [uid, claims] of Object.entries(initial?.outcome?.claims ?? {})) base[uid] = { ...U.userOf(base, uid), claims };
    if (initial?.overrides) {
      for (const uid of new Set([...Object.keys(base), ...Object.keys(initial.overrides)])) base[uid] = { ...U.userOf(base, uid), overrides: initial.overrides[uid] ?? {} };
    }
    return base;
  });
  const [outcomeNotes, setOutcomeNotes] = useState<OutcomeNote[]>(initial?.outcome?.notes ?? []);
  const [toast, setToast] = useState<string | null>(null);
  const [junctionOnly, setJunctionOnly] = useState(initial?.junctionOnly ?? false);
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

  const assess = useMemo(() => Object.fromEntries(Object.keys(krBands).map((k) => [k, currentAssessment(assessHist[k] ?? [])])) as Record<string, CurrentAssessment | null>, [assessHist]);
  const me = U.userOf(users, viewerId);
  const overridesAll = useMemo(() => U.mergedOverrides(users), [users]);
  const regTasks = useMemo(() => registeredTasks(allTasks, reach, viewerId, REACH_PJ_IDS), [reach, viewerId]);
  const confirmedLinks = useMemo(() => U.confirmedLinks(users, outcomeNotes, regTasks), [users, outcomeNotes, regTasks]);
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
      assessHist,
      assess,
      learnings,
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
        const assessed = selected.flatMap((r) => r.assessments.map((a) => ({ krId: a.krId, source: a.source })));
        const next = applyConfirm(records, drafts, values, assessed, ci.date);
        const nextHist = mergeAssessments(assessHist, selected, ci, krBands);
        const found: Celebration[] = [];
        const deltas: Change[] = [];
        for (const krId of new Set(assessed.map((a) => a.krId))) {
          const before = currentAssessment(assessHist[krId] ?? []);
          const after = currentAssessment(nextHist[krId] ?? []);
          if (!before || !after) continue;
          const step = crossedStep(before.cur.assessment.value, after.cur.assessment.value, krBands[krId]);
          if (step !== null) {
            celebSeq.current += 1;
            found.push({ id: celebSeq.current, krId, step });
          }
          const text = deltaText(before.cur.assessment.value, after.cur.assessment.value);
          if (text) deltas.push({ krId, text });
        }
        setRecords(next);
        setAssessHist(nextHist);
        setLearnings((p) => mergeLearnings(p, selected, ci));
        setHistory((p) => addHistory(p, drafts.map((d) => d.krId), Object.fromEntries(drafts.map((d) => [d.krId, next[d.krId].hint?.value ?? d.value])), ci.date));
        setCheckins((p) => (p.some((c) => c.id === ci.id) ? p : [...p, ci]));
        setDecisions((p) => mergeDecisions(p, selected, ci));
        setConfirmedBy((p) => ({ ...p, [ci.id]: viewerId }));
        const notes = notesOfResources(selected);
        setOutcomeNotes((p) => addOutcomeNotes(p, notes));
        setUsers((p) => U.deliverClaims(p, notes, allTasks));
        setNewDecisions(selected.reduce((s, r) => s + r.decisions.length, 0));
        setDecisionsOpen(true);
        setChanges(deltas);
        setCelebrations(found);
        window.clearTimeout(celebTimer.current);
        celebTimer.current = window.setTimeout(() => setCelebrations([]), 3600);
        return found;
      },
      linkCtx,
      reach,
      setReach: (r) => {
        setReachState(r);
        setSel(null);
      },
      tasks: regTasks,
      history,
      overrides: me.overrides,
      setOverride: (task, krIds) => setUsers((p) => U.setOverride(p, viewerId, task, krIds, defaultKrIdsOfTask(task, linkCtx))),
      proposals: me.proposals,
      takeProposal: (task, krId) =>
        setUsers((p) => U.takeProposal(p, viewerId, task, krId, U.userOf(p, viewerId).overrides[task.id] ?? defaultKrIdsOfTask(task, linkCtx), defaultKrIdsOfTask(task, linkCtx))),
      setProposal: (taskId, krId, v) => setUsers((p) => U.setProposal(p, viewerId, taskId, krId, v)),
      junctionOnly,
      setJunctionOnly,
      how: me.how,
      setHow: (taskId, krId, text) => setUsers((p) => U.setHow(p, viewerId, taskId, krId, text)),
      personalLinks: me.personalLinks,
      togglePersonalLink: (personalId, krId) => setUsers((p) => U.toggleLink(p, viewerId, personalId, krId)),
      answers: me.answers,
      setAnswer: (krId, patch) => setUsers((p) => U.setAnswer(p, viewerId, WEEK_START, krId, patch)),
      picks: me.picks[WEEK_START] ?? [],
      togglePick: (task) => setUsers((p) => U.togglePick(p, viewerId, WEEK_START, task)),
      outcomeNotes,
      claims: me.claims,
      answerClaim: (noteKey, task, v) => setUsers((p) => U.answerClaim(p, viewerId, task, noteKey, v)),
      confirmedLinks,
      toast,
      showToast,
    }),
    [viewerId, reach, regTasks, history, assessHist, assess, learnings, mode, sel, guideOpen, drawerOpen, modal, junctionOnly, celebrations, changes, decisionsOpen, newDecisions, items, locked, imported, records, checkins, decisions, confirmedBy, linkCtx, me, outcomeNotes, confirmedLinks, toast, showToast],
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
