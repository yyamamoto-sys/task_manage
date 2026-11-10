// AI相談の識別記号（task_001 / pj_001）を、画面に出す名前へ引くための関数を返すフック。
// 名前を引けない記号（kr_/tf_/o_ は位置番号で実体に紐づかない・一覧から消えたタスク等）は undefined を返し、
// displayText.ts 側が「該当タスク」などの語にする。
import { useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import type { AliasNameResolver } from "../lib/ai/displayText";

export function useAliasNameResolver(shortIdMap: Map<string, string>): AliasNameResolver {
  const tasks = useAppStore(s => s.tasks);
  const projects = useAppStore(s => s.projects);
  return useMemo(() => {
    const taskName = new Map(tasks.map(t => [t.id, t.name]));
    const pjName = new Map(projects.map(p => [p.id, p.name]));
    return (alias: string) => {
      const uuid = shortIdMap.get(alias);
      if (!uuid) return undefined;
      if (alias.startsWith("task_")) return taskName.get(uuid);
      if (alias.startsWith("pj_")) return pjName.get(uuid);
      return undefined;
    };
  }, [tasks, projects, shortIdMap]);
}
