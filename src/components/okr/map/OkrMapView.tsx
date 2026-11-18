// 本番の OKR モードの地図。appStore の実データを adapter.ts で地図の形に変え、記録は repository.ts から読む。
// 記録の保存先は、ログイン中は Supabase（supabaseRepository.ts）、ゲストはメモリ（Supabase に触れない。Section 23）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Member as AppMember } from "../../../lib/localData/types";
import { currentQuarter, todayStr } from "../../../lib/date";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { isGuestMode } from "../../../lib/guestMode";
import { pickCurrentObjectiveForGroup } from "../../../lib/okr/deptScope";
import { selectScopedProjects, selectScopedTasks, useAppStore } from "../../../stores/appStore";
import App from "./App";
import { buildOkrMapCore } from "./adapter";
import { createOkrMapAi, type OkrMapAi } from "./aiClient";
import { writeKintonePlan, type KintoneApplyPlan } from "./kintone";
import type { OkrMapData } from "./dataset";
import { formatMd } from "./logic";
import { fillRecords, memoryRepository, type OkrMapRecords, type OkrMapRepository } from "./repository";
import { createSupabaseRepository } from "./supabaseRepository";
import "../okrTheme.css";
import "./mock.css";
import "./mock4.css";

interface Props {
  currentUser: AppMember;
  headerPadRight?: string;
  onOpenPersonalOkr?: () => void;
  /** 渡さないときは、ゲストならメモリ・それ以外は Supabase */
  repository?: OkrMapRepository;
}

export function OkrMapView({ currentUser, headerPadRight, onOpenPersonalOkr, repository: repoProp }: Props) {
  const objectives = useAppStore((s) => s.objectives);
  const keyResults = useAppStore((s) => s.keyResults);
  const taskForces = useAppStore((s) => s.taskForces);
  const projectTaskForces = useAppStore((s) => s.projectTaskForces);
  const taskTaskForces = useAppStore((s) => s.taskTaskForces);
  const members = useAppStore((s) => s.members);
  const groupId = useAppStore((s) => s.currentGroupId);
  const projects = useAppStore(selectScopedProjects);
  const tasks = useAppStore(selectScopedTasks);
  const today = todayStr();
  const quarter = currentQuarter();
  const [defaultRepo] = useState<OkrMapRepository>(() => (isGuestMode() ? memoryRepository : createSupabaseRepository()));
  const repository = repoProp ?? defaultRepo;
  // ゲストは AI を呼ばない（固定データのまま動く。Section 23）
  const [ai] = useState<OkrMapAi | null>(() => (isGuestMode() ? null : createOkrMapAi()));
  const applyKintone = useCallback(
    async (plan: KintoneApplyPlan) => {
      const s = useAppStore.getState();
      await writeKintonePlan(plan, {
        objective: pickCurrentObjectiveForGroup(s.objectives, s.currentGroupId),
        keyResults: s.keyResults,
        taskForces: s.taskForces,
        saveObjective: s.saveObjective,
        saveKeyResult: s.saveKeyResult,
        saveTaskForce: s.saveTaskForce,
        viewerId: currentUser.id,
        quarter: currentQuarter(),
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
    },
    [currentUser.id],
  );

  const core = useMemo(
    () =>
      buildOkrMapCore({ objectives, keyResults, taskForces, projectTaskForces, taskTaskForces, projects, tasks, members, groupId, viewerId: currentUser.id, today, quarter }),
    [objectives, keyResults, taskForces, projectTaskForces, taskTaskForces, projects, tasks, members, groupId, currentUser.id, today, quarter],
  );
  const krIds = useMemo(() => core.items.filter((i) => i.kind === "kr").map((i) => i.id), [core.items]);
  // 地図を作り直すのは「部署・本人・週・四半期」が変わったときだけ（baseKey）。KR の顔ぶれの変化と「Kintone に合わせた」後は
  // 記録だけ読み直して足し込む（作り直すと Kintone の読み取り結果・確定前の選択・書きかけが消えるため）
  const baseKey = `${groupId ?? ""}|${currentUser.id}|${core.weekStart}|${quarter}`;
  const [reloadSeq, setReloadSeq] = useState(0);
  const loadKey = `${baseKey}|${krIds.join(",")}|${reloadSeq}`;

  // 古い応答は世代番号で捨てる。保存に使う行IDの対応（repository.adopt）も、世代を確かめてから反映する
  const [loaded, setLoaded] = useState<{ key: string; baseKey: string; gen: number; rec: OkrMapRecords | null; error: string | null } | null>(null);
  const gen = useRef(0);
  const taskIds = useMemo(() => core.tasks.map((t) => t.id), [core.tasks]);
  const argsRef = useRef({ groupId, krIds, viewerId: currentUser.id, year: Number(today.slice(0, 4)), quarter, weekStart: core.weekStart, taskIds });
  argsRef.current = { groupId, krIds, viewerId: currentUser.id, year: Number(today.slice(0, 4)), quarter, weekStart: core.weekStart, taskIds };
  useEffect(() => {
    const my = ++gen.current;
    const base = baseKey;
    repository.load(argsRef.current).then(
      (rec) => {
        if (gen.current !== my) return;
        repository.adopt?.(rec);
        setLoaded({ key: loadKey, baseKey: base, gen: my, rec, error: null });
      },
      (e: unknown) => {
        if (gen.current === my) setLoaded((p) => ({ key: loadKey, baseKey: base, gen: my, rec: p?.baseKey === base ? p.rec : null, error: formatErrorForUser("OKRの記録を読み込めませんでした", e) }));
      },
    );
    // baseKey は loadKey に含まれる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, loadKey]);
  const reloadRecords = useCallback(() => setReloadSeq((n) => n + 1), []);

  // 次に資料を確定したときに加わる回。保存するので行IDとして使える形（uuid）にする。画面を開き直すまで同じもの
  const [nextCheckinId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `next-${today}`));
  const data = useMemo<OkrMapData | null>(() => {
    // 同じ baseKey の間は、読み直しの最中も前の記録で描き続ける
    if (!loaded || loaded.baseKey !== baseKey || !loaded.rec) return null;
    return { ...core, ...fillRecords(loaded.rec, krIds), nextCheckin: { id: nextCheckinId, date: today, title: `${formatMd(today)}のチェックイン` }, recordsGen: loaded.gen };
  }, [core, loaded, baseKey, krIds, today, nextCheckinId]);

  if (loaded?.key === loadKey && loaded.error && !data) {
    return (
      <div role="alert" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", fontSize: "12px", padding: "24px", whiteSpace: "pre-wrap" }}>
        {loaded.error}
      </div>
    );
  }
  if (!data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>;
  }
  // 部署・本人・週・四半期が変わったら、記録の状態を作り直す（記録は MockProvider の中で初期値として持つため）
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <App
        key={baseKey}
        data={data}
        embedded
        headerPadRight={headerPadRight}
        onOpenPersonalOkr={onOpenPersonalOkr}
        repository={repository}
        ai={ai}
        applyKintone={ai ? applyKintone : undefined}
        onRecordsChanged={reloadRecords}
      />
    </div>
  );
}
