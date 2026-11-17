import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useOkrMapBridge } from "./bridge";
import { flowAllInit, setFlowAllFor, SIDEBAR_AUTO_COLLAPSE_PX, sidebarWidth, switchPage, type FlowAll } from "./nav";
import { addOutcomeNotes, confirmSaveOf, detectConflicts, mergeAssessments, mergeDecisions, mergeDrafts, mergeLearnings, notesOfResources } from "./confirm";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { activeData, krBands, PERSONAL_NAME, setActiveData, type OkrMapData } from "./dataset";
import { applyConfirm, compareOkr, defaultKrIdsOfTask, howKey, importKintone, krIdsOfTask, PERSONAL_PJ, type LinkCtx } from "./logic";
import { crossedStep, currentAssessment, deltaText, type CurrentAssessment } from "./steps";
import { KrDefConflictError, memoryRepository, type HintDef, type OkrMapRepository } from "./repository";
import type { AiCandidate, AssessEntry, Checkin, ClaimStatus, Decision, KintoneRow, KrAnswer, KrDef, KrRecord, Learning, OkrItem, OutcomeNote, Resource, Task } from "./types";
import type { OkrMapAi } from "./aiClient";
import { orderTasksForAi, resourceKindOf, type CheckinAiContext } from "./checkinAi";
import { planKintoneApply, readingFromImport, type KintoneApplyPlan, type KintoneReading } from "./kintone";
import type { SuggestKr } from "./suggestAi";
import { addHistory, registeredTasks, type History, type Reach } from "./reach";
import * as U from "./userState";

export type ViewMode = "team" | "self";
export type Selection = { type: "kr"; id: string } | { type: "tf"; id: string } | { type: "pj"; id: string } | { type: "task"; id: string } | null;
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

interface MockState {
  /** 見ている人。「本人」＝この人（個人OKR・つなぎ先の変更・どう役立つか・振り返り・今週やる・提案の採否の持ち主） */
  viewerId: string;
  setViewerId: (id: string) => void;
  /** 開いているページ。team＝チーム、self＝わたし（サイドバーのメニューで切り替える） */
  mode: ViewMode;
  /** 流れの図を全体表示にしているか（ページごとに覚える） */
  flowAll: FlowAll;
  setFlowAll: (page: ViewMode, on: boolean) => void;
  /** ページを切り替える。詳細パネルは閉じる。anchor を渡すと、切替後にその場所へ移る（無ければ先頭へ） */
  setMode: (m: ViewMode, anchor?: string) => void;
  pageAnchor: MutableRefObject<string | null>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
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
  /** 画面が読んでいるデータ一式（本番のデータ＋記録） */
  data: OkrMapData;
  /** 「わたし」から今の個人OKRの画面を開く（本番だけ。段階4で見た目を合わせる） */
  onOpenPersonalOkr?: () => void;
  locked: boolean;
  lockedAt: string;
  imported: boolean;
  setImported: (v: boolean) => void;
  /** Kintone（正式な内容）に合わせて確定する（本番は O・KR・TF・段の基準文を書いてからロック）。うまくいったら true */
  importFromKintone: () => Promise<boolean>;
  /** AI を使えるか（ゲスト・テストでは使わない。固定データのまま動く） */
  aiReady: boolean;
  /** Kintone の PDF・テキストを読む（AI）。失敗は例外 */
  readKintone: (file: File) => Promise<void>;
  /** 読んだ Kintone の内容（O・KR・段の基準文・取り込めないTF） */
  kintoneReading: KintoneReading | null;
  /** 読ませた資料（全回分） */
  resources: Resource[];
  /** 資料を読ませただけで、まだ確定していない回 */
  openCheckins: Checkin[];
  /** 資料を1件ずつ AI に読ませて保存する。読めなかった資料の理由を返す */
  readResources: (files: File[], checkin: Checkin, onProgress?: (done: number) => void) => Promise<string[]>;
  /** どのKRにもつながらない仕事の、つなぎ先の候補を AI に出させる（PJごと・保存しない） */
  suggestCandidates: (task: Task) => Promise<void>;
  /** 仕事がKRにどう役立つかの案を AI に出させる（保存しない） */
  suggestHow: (task: Task, krId: string) => Promise<void>;
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
  /** KRごとの段の基準文・証拠（手入力で直せる） */
  krDefs: Record<string, KrDef>;
  /** KRの段の基準文・証拠・手がかりの定めを保存する（手入力） */
  saveKrDef: (krId: string, def: KrDef, hint: HintDef | null) => Promise<boolean>;
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
  flowAll?: Partial<FlowAll>;
  sel?: Selection;
  drawerOpen?: boolean;
  /** サイドバーを折りたたんだ状態で始める（描画の確認用。既定は画面幅 900px 以下のときだけ折りたたむ） */
  collapsed?: boolean;
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

export function MockProvider({
  children,
  initial,
  data: dataProp,
  onOpenPersonalOkr,
  repository = memoryRepository,
  ai = null,
  applyKintone,
}: {
  children: ReactNode;
  initial?: InitialView;
  data?: OkrMapData;
  onOpenPersonalOkr?: () => void;
  /** 記録の保存先。既定はメモリ（テスト・ゲスト）。本番は supabaseRepository */
  repository?: OkrMapRepository;
  /** AI の呼び出し。null（既定・ゲスト・テスト）は AI を使わず、データにある内容だけで動く */
  ai?: OkrMapAi | null;
  /** 「Kintone に合わせる」で O・KR・TF 本体を書く（本番は appStore の保存関数を通す） */
  applyKintone?: (plan: KintoneApplyPlan) => Promise<void>;
}) {
  const loaded = dataProp ?? activeData();
  if (!loaded) throw new Error("地図のデータがありません");
  // 段の基準文・読ませた資料・AIの候補・Kintone の読み取りは画面で増える・直るので、その分を重ねたものを「いまのデータ」にする
  const [krDefsState, setKrDefs] = useState(loaded.krDefs);
  const [resources, setResources] = useState<Resource[]>(loaded.resources);
  const [aiCands, setAiCands] = useState<Record<string, AiCandidate[]>>(loaded.aiCandidates);
  const [howOpts, setHowOpts] = useState<Record<string, string[]>>(loaded.howOptions);
  const [kintoneReading, setKintoneReading] = useState<KintoneReading | null>(null);
  const data = useMemo(() => {
    if (krDefsState === loaded.krDefs && resources === loaded.resources && aiCands === loaded.aiCandidates && howOpts === loaded.howOptions && !kintoneReading) return loaded;
    return { ...loaded, krDefs: krDefsState, resources, aiCandidates: aiCands, howOptions: howOpts, kintoneRows: kintoneReading ? kintoneReading.rows : loaded.kintoneRows };
  }, [loaded, krDefsState, resources, aiCands, howOpts, kintoneReading]);
  // 子の部品は dataset.ts から読む。子より先に描画されるここで、いまのデータに差し替える
  setActiveData(data);
  const { tasks: allTasks, nextCheckin, weekStart: WEEK_START } = data;
  const [openCheckins, setOpenCheckins] = useState<Checkin[]>(loaded.openCheckins ?? []);
  const [viewerId, setViewerId] = useState(initial?.viewerId ?? data.viewerId);
  const [mode, setModeState] = useState<ViewMode>(initial?.mode ?? "team");
  const [flowAll, setFlowAllState] = useState<FlowAll>(() => flowAllInit(initial?.flowAll));
  const setFlowAll = useCallback((page: ViewMode, on: boolean) => setFlowAllState((f) => setFlowAllFor(f, page, on)), []);
  const [sel, setSel] = useState<Selection>(initial?.sel ?? null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => initial?.collapsed ?? (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_PX}px)`).matches),
  );
  const pageAnchor = useRef<string | null>(null);
  const setMode = useCallback(
    (m: ViewMode, anchor?: string) => {
      pageAnchor.current = anchor ?? null;
      const next = switchPage({ mode, sel }, m);
      setModeState(next.mode);
      setSel(next.sel);
    },
    [mode, sel],
  );
  const [guideOpen, setGuideOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(initial?.drawerOpen ?? false);
  const [modal, setModal] = useState<ModalId>(null);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [changes, setChanges] = useState<Change[]>(initial?.changes ?? []);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [newDecisions, setNewDecisions] = useState(0);
  // Kintone の取り込みで差し替えたTF構成。null＝本番のデータのまま
  const [itemsOverride, setItems] = useState<OkrItem[] | null>(null);
  const items = itemsOverride ?? data.items;
  const [locked, setLocked] = useState(data.lock.locked);
  const [imported, setImported] = useState(data.kintoneRows !== null);
  const [records, setRecords] = useState<Record<string, KrRecord>>(data.records);
  const [history, setHistory] = useState<History>(data.history);
  const [assessHist, setAssessHist] = useState<Record<string, AssessEntry[]>>(data.assess);
  const [learnings, setLearnings] = useState<Learning[]>(initial?.learnings ?? data.learnings);
  const [reach, setReachState] = useState<Reach>(initial?.reach ?? "all");
  const [checkins, setCheckins] = useState<Checkin[]>(data.checkins);
  const [decisions, setDecisions] = useState<Decision[]>(data.decisions);
  const [confirmedBy, setConfirmedBy] = useState<Record<string, string>>(initial?.confirmedBy ?? data.confirmedBy ?? {});
  const [users, setUsers] = useState<U.UserStates>(() => {
    const base = U.initialUserStates(WEEK_START);
    for (const [uid, claims] of Object.entries(initial?.outcome?.claims ?? {})) base[uid] = { ...U.userOf(base, uid), claims };
    if (initial?.overrides) {
      for (const uid of new Set([...Object.keys(base), ...Object.keys(initial.overrides)])) base[uid] = { ...U.userOf(base, uid), overrides: initial.overrides[uid] ?? {} };
    }
    return base;
  });
  const [outcomeNotes, setOutcomeNotes] = useState<OutcomeNote[]>(initial?.outcome?.notes ?? data.outcomeNotes ?? []);
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

  // 保存は画面の更新のあとに裏で行う。失敗したら原因つきで知らせる（Section 15）。画面の状態は戻さない
  const persist = useCallback((p: Promise<void>) => {
    p.catch((e: unknown) => showToast(formatErrorForUser("保存できませんでした", e)));
  }, [showToast]);

  // 人ごとの状態を変えて、本人の分の変化を保存する。つなぎ先は仕事1件1行なので全員分を足したもので差分を取る
  const usersRef = useRef(users);
  usersRef.current = users;
  const updateUsers = useCallback(
    (fn: (s: U.UserStates) => U.UserStates) => {
      const prev = usersRef.current;
      const next = fn(prev);
      if (next === prev) return;
      usersRef.current = next;
      setUsers(next);
      const [before, after] = U.viewerChange(prev, next, viewerId);
      persist(repository.saveUser(viewerId, before, after));
    },
    [viewerId, repository, persist],
  );

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

  const assess = useMemo(
    () => Object.fromEntries(Object.keys(data.krDefs).map((k) => [k, currentAssessment(assessHist[k] ?? [])])) as Record<string, CurrentAssessment | null>,
    [assessHist, data.krDefs],
  );
  const me = U.userOf(users, viewerId);
  const overridesAll = useMemo(() => U.mergedOverrides(users), [users]);
  const reachPjIds = data.reachPjIds;
  const regTasks = useMemo(() => registeredTasks(allTasks, reach, viewerId, reachPjIds ?? []), [allTasks, reach, viewerId, reachPjIds]);
  const confirmedLinks = useMemo(() => U.confirmedLinks(users, outcomeNotes, regTasks), [users, outcomeNotes, regTasks]);
  const linkCtx = useMemo<LinkCtx>(() => ({ pjs: data.pjs, items, overrides: overridesAll }), [data.pjs, items, overridesAll]);

  const value = useMemo<MockState>(
    () => ({
      viewerId,
      setViewerId,
      mode,
      setMode,
      flowAll,
      setFlowAll,
      pageAnchor,
      sidebarCollapsed,
      setSidebarCollapsed,
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
      data,
      onOpenPersonalOkr,
      locked,
      lockedAt: data.lock.lockedAt ?? "",
      imported,
      setImported,
      importFromKintone: async () => {
        const rows = data.kintoneRows;
        if (!rows) return false;
        const next = importKintone(items, rows, data.currentQuarter.quarter);
        const lock = { groupId: data.groupId, viewerId, year: Number(data.today.slice(0, 4)), quarter: data.currentQuarter.quarter, lockedOn: data.today, snapshot: next };
        if (!kintoneReading || !applyKintone) {
          // テスト（架空データ）：画面の上だけで差し替える
          setItems(next);
          setLocked(true);
          persist(repository.saveLock(lock));
          return true;
        }
        const plan = planKintoneApply(kintoneReading, items, krDefsState);
        // アプリにだけあるTFは消さないので、確定の記録にも残す
        lock.snapshot = [...next, ...items.filter((i) => i.kind === "tf" && !rows.some((r) => r.id === i.id))];
        try {
          await applyKintone(plan);
          for (const b of plan.bands) {
            const cur = krDefsState[b.krId] ?? { bands: b.bands, evidence: "" };
            const h = records[b.krId]?.hint;
            const def: KrDef = { ...cur, bands: b.bands };
            await repository.saveKrDef(b.krId, def, h ? { unit: h.unit, start: h.start, target: h.target, direction: h.direction } : null, viewerId);
            setKrDefs((p) => ({ ...p, [b.krId]: def }));
          }
          await repository.saveLock(lock);
        } catch (e) {
          if (e instanceof KrDefConflictError) setKrDefs((p) => ({ ...p, [e.krId]: e.def }));
          showToast(formatErrorForUser("Kintone の内容に合わせられませんでした", e));
          return false;
        }
        // O・KR・TF は appStore に書いたので、地図はそちらから作り直される（画面の上での差し替えはしない）
        setItems(null);
        setLocked(true);
        return true;
      },
      aiReady: ai !== null,
      kintoneReading,
      readKintone: async (file) => {
        if (!ai) return;
        const analysis = await ai.readKintone(file);
        setKintoneReading(readingFromImport(analysis, items, file.name));
        setImported(true);
      },
      resources,
      openCheckins,
      readResources: async (files, checkin, onProgress) => {
        if (!ai) return [];
        const errors: string[] = [];
        const krItems = items.filter((i) => i.kind === "kr");
        const nameOfId = (id: string | null) => (id ? (data.members.find((m) => m.id === id)?.name ?? "") : "");
        const pjName = (id: string) => (id === PERSONAL_PJ ? PERSONAL_NAME : (data.pjs.find((p) => p.id === id)?.name ?? ""));
        const ordered = orderTasksForAi(allTasks);
        const memberIds = new Set([viewerId, ...ordered.flatMap((t) => t.assigneeIds ?? [t.assigneeId])]);
        const ctx: CheckinAiContext = {
          krs: krItems.map((k) => ({ id: k.id, label: k.label, text: k.text, def: krDefsState[k.id] ?? null, hint: records[k.id]?.hint ?? null, current: assess[k.id]?.cur.assessment.value ?? null })),
          tasks: ordered.map((t) => ({ id: t.id, title: t.title, assignee: nameOfId(t.assigneeId), pj: pjName(t.pjId) })),
          members: data.members.filter((m) => memberIds.has(m.id)).map((m) => ({ id: m.id, name: m.name })),
        };
        let done = 0;
        for (const file of files) {
          try {
            const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `res-${Date.now()}-${done}`;
            const res = await ai.readResource(file, ctx, { id, name: file.name, kind: resourceKindOf(file.name), checkinId: checkin.id });
            await repository.saveResource({ groupId: data.groupId, viewerId, checkin, resource: res });
            setResources((p) => [...p, res]);
            setOpenCheckins((p) => (p.some((c) => c.id === checkin.id) || checkins.some((c) => c.id === checkin.id) ? p : [...p, checkin]));
          } catch (e) {
            errors.push(formatErrorForUser(`${file.name} を読めませんでした`, e));
          }
          done += 1;
          onProgress?.(done);
        }
        return errors;
      },
      suggestCandidates: async (task) => {
        if (!ai) return;
        const krs = suggestKrs(items, krDefsState);
        const pjName = task.pjId === PERSONAL_PJ ? PERSONAL_NAME : (data.pjs.find((p) => p.id === task.pjId)?.name ?? "");
        const titles = allTasks.filter((t) => t.pjId === task.pjId && t.status !== "完了" && krIdsOfTask(t, linkCtx).length === 0).map((t) => t.title);
        try {
          const list = await ai.suggestCandidates(krs, pjName, titles.length > 0 ? titles : [task.title]);
          setAiCands((p) => ({ ...p, [task.pjId]: list }));
          if (list.length === 0) showToast("役立ちそうなKRの候補は見つかりませんでした");
        } catch (e) {
          showToast(formatErrorForUser("AIの候補を出せませんでした", e));
        }
      },
      suggestHow: async (task, krId) => {
        if (!ai) return;
        const kr = suggestKrs(items, krDefsState).find((k) => k.id === krId);
        if (!kr) return;
        const pjName = task.pjId === PERSONAL_PJ ? PERSONAL_NAME : (data.pjs.find((p) => p.id === task.pjId)?.name ?? "");
        try {
          const list = await ai.suggestHow(kr, pjName, task.title);
          setHowOpts((p) => ({ ...p, [howKey(task.id, krId)]: list }));
          if (list.length === 0) showToast("案を出せませんでした。もう一度試してください");
        } catch (e) {
          showToast(formatErrorForUser("AIの案を出せませんでした", e));
        }
      },
      unlockDemo: () => {
        setItems(null);
        setLocked(false);
        setImported(false);
      },
      kintone: data.kintoneRows ?? [],
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
        const ci =
          selected[0].checkinId === nextCheckin.id
            ? nextCheckin
            : (checkins.find((c) => c.id === selected[0].checkinId) ?? openCheckins.find((c) => c.id === selected[0].checkinId));
        if (!ci) return [];
        setOpenCheckins((p) => p.filter((c) => c.id !== ci.id));
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
        const nextLearnings = mergeLearnings(learnings, selected, ci);
        const nextDecisions = mergeDecisions(decisions, selected, ci);
        const notes = notesOfResources(selected);
        const nextNotes = addOutcomeNotes(outcomeNotes, notes);
        persist(repository.saveConfirm(confirmSaveOf({ groupId: data.groupId, viewerId, ci, selected, drafts, nextRecords: next, nextHist, nextLearnings, nextDecisions, notes, nextNotes, tasks: allTasks })));
        setRecords(next);
        setAssessHist(nextHist);
        setLearnings(nextLearnings);
        setHistory((p) => addHistory(p, drafts.map((d) => d.krId), Object.fromEntries(drafts.map((d) => [d.krId, next[d.krId].hint?.value ?? d.value])), ci.date));
        setCheckins((p) => (p.some((c) => c.id === ci.id) ? p : [...p, ci]));
        setDecisions(nextDecisions);
        setConfirmedBy((p) => ({ ...p, [ci.id]: viewerId }));
        setOutcomeNotes(nextNotes);
        // 届けた結びつき（pending）は saveConfirm が書く。ここでは画面の状態だけ変える
        usersRef.current = U.deliverClaims(usersRef.current, notes, allTasks);
        setUsers(usersRef.current);
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
      setOverride: (task, krIds) => updateUsers((p) => U.setOverride(p, viewerId, task, krIds, defaultKrIdsOfTask(task, linkCtx))),
      proposals: me.proposals,
      takeProposal: (task, krId) =>
        updateUsers((p) => U.takeProposal(p, viewerId, task, krId, U.mergedOverrides(p)[task.id] ?? defaultKrIdsOfTask(task, linkCtx), defaultKrIdsOfTask(task, linkCtx))),
      setProposal: (taskId, krId, v) => updateUsers((p) => U.setProposal(p, viewerId, taskId, krId, v)),
      junctionOnly,
      setJunctionOnly,
      how: me.how,
      setHow: (taskId, krId, text) => updateUsers((p) => U.setHow(p, viewerId, taskId, krId, text)),
      personalLinks: me.personalLinks,
      togglePersonalLink: (personalId, krId) => updateUsers((p) => U.toggleLink(p, viewerId, personalId, krId)),
      answers: me.answers,
      setAnswer: (krId, patch) => updateUsers((p) => U.setAnswer(p, viewerId, WEEK_START, krId, patch)),
      picks: me.picks[WEEK_START] ?? [],
      togglePick: (task) => updateUsers((p) => U.togglePick(p, viewerId, WEEK_START, task)),
      outcomeNotes,
      claims: me.claims,
      answerClaim: (noteKey, task, v) => updateUsers((p) => U.answerClaim(p, viewerId, task, noteKey, v)),
      confirmedLinks,
      krDefs: krDefsState,
      saveKrDef: async (krId, def, hint) => {
        const apply = (d: KrDef, h: HintDef | null) => {
          setKrDefs((p) => ({ ...p, [krId]: d }));
          setRecords((p) => {
            const r = p[krId] ?? { krId, updatedAt: "", prevAt: "", source: null };
            const rec: KrRecord = { ...r };
            if (h) rec.hint = { ...h, value: r.hint?.value ?? h.start, prev: r.hint?.prev ?? h.start };
            else delete rec.hint;
            return { ...p, [krId]: rec };
          });
        };
        try {
          await repository.saveKrDef(krId, def, hint, viewerId);
        } catch (e) {
          // 競合：生のエラーは出さず、読み直した最新の内容に差し替えて知らせる
          if (e instanceof KrDefConflictError) {
            apply(e.def, e.hint);
            showToast(e.message);
          } else {
            showToast(formatErrorForUser("保存できませんでした", e));
          }
          return false;
        }
        apply(def, hint);
        showToast("保存しました");
        return true;
      },
      toast,
      showToast,
    }),
    [data, onOpenPersonalOkr, repository, ai, applyKintone, kintoneReading, openCheckins, persist, updateUsers, krDefsState, allTasks, nextCheckin, resources, WEEK_START, viewerId, reach, regTasks, history, assessHist, assess, learnings, mode, setMode, flowAll, setFlowAll, sidebarCollapsed, sel, guideOpen, drawerOpen, modal, junctionOnly, celebrations, changes, decisionsOpen, newDecisions, items, locked, imported, records, checkins, decisions, confirmedBy, linkCtx, me, outcomeNotes, confirmedLinks, toast, showToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function suggestKrs(items: OkrItem[], defs: Record<string, KrDef>): SuggestKr[] {
  return items.filter((i) => i.kind === "kr").map((k) => ({ id: k.id, label: k.label, text: k.text, def: defs[k.id] ?? null }));
}

/** 右の AI 相談パネルの幅（閉じているとき・見本では 0） */
export function useConsultPx(): number {
  return useOkrMapBridge((s) => s.consultPx);
}

/** いまのサイドバーの幅。本番は MainLayout が bridge に載せた実際の幅、見本（テスト）は自分のサイドバーの幅 */
export function useSidebarPx(): number {
  const { sidebarCollapsed } = useMock();
  const real = useOkrMapBridge((s) => s.sidebarPx);
  return real ?? sidebarWidth(sidebarCollapsed);
}

/** Kintone（正式な内容）とアプリの今期のTFの突き合わせ */
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
