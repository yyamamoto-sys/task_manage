// 本番の OKR モードの地図。appStore の実データを adapter.ts で地図の形に変え、記録は repository.ts から読む。
// ゲストでも同じ経路（appStore にはサンプルデータが入り、記録の読み込みはメモリ上の空実装なので Supabase に触れない）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { Member as AppMember } from "../../../lib/localData/types";
import { currentQuarter, todayStr } from "../../../lib/date";
import { selectScopedProjects, selectScopedTasks, useAppStore } from "../../../stores/appStore";
import App from "./App";
import { buildOkrMapCore } from "./adapter";
import type { OkrMapData } from "./dataset";
import { formatMd } from "./logic";
import { fillRecords, memoryRepository, type OkrMapRecords, type OkrMapRepository } from "./repository";
import "./mock.css";
import "./mock4.css";

interface Props {
  currentUser: AppMember;
  headerPadRight?: string;
  onOpenPersonalOkr?: () => void;
  /** 段階2で Supabase の実装に差し替える */
  repository?: OkrMapRepository;
}

export function OkrMapView({ currentUser, headerPadRight, onOpenPersonalOkr, repository = memoryRepository }: Props) {
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

  const core = useMemo(
    () =>
      buildOkrMapCore({ objectives, keyResults, taskForces, projectTaskForces, taskTaskForces, projects, tasks, members, groupId, viewerId: currentUser.id, today, quarter }),
    [objectives, keyResults, taskForces, projectTaskForces, taskTaskForces, projects, tasks, members, groupId, currentUser.id, today, quarter],
  );
  const krIds = useMemo(() => core.items.filter((i) => i.kind === "kr").map((i) => i.id), [core.items]);
  const loadKey = `${groupId ?? ""}|${krIds.join(",")}`;

  // 記録は「部署・KRの顔ぶれ」が変わったときだけ読み直す。古い応答は世代番号で捨てる
  const [loaded, setLoaded] = useState<{ key: string; rec: OkrMapRecords } | null>(null);
  const gen = useRef(0);
  useEffect(() => {
    const my = ++gen.current;
    const ids = loadKey.slice(loadKey.indexOf("|") + 1).split(",").filter(Boolean);
    void repository.load({ groupId, krIds: ids }).then((rec) => {
      if (gen.current === my) setLoaded({ key: loadKey, rec });
    });
  }, [repository, groupId, loadKey]);

  const data = useMemo<OkrMapData | null>(() => {
    if (!loaded || loaded.key !== loadKey) return null;
    return { ...core, ...fillRecords(loaded.rec, krIds), nextCheckin: { id: `next-${today}`, date: today, title: `${formatMd(today)}のチェックイン` } };
  }, [core, loaded, loadKey, krIds, today]);

  if (!data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>;
  }
  // 部署やKRの顔ぶれが変わったら、記録の状態を作り直す（記録は MockProvider の中で初期値として持つため）
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <App key={loadKey} data={data} embedded headerPadRight={headerPadRight} onOpenPersonalOkr={onOpenPersonalOkr} />
    </div>
  );
}
