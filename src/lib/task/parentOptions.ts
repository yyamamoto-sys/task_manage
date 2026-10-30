// src/lib/task/parentOptions.ts
//
// 【設計意図】編集面（サイドパネル・編集モーダル・追加モーダル）の「親タスク」欄の選択肢を1か所で作る（v3.196）。
// 候補は同じPJの、自分と自分の子孫以外の任意のタスク（parentTaskCandidates）。ラベルは「A > B > C」のパスで、
// 検索もパスに対して効く。いま設定されている親が候補に居ない場合（他PJの旧データ等）は、
// 選択欄が空に見えないよう末尾に足す。

import type { Task } from "../localData/types";
import type { SelectOption } from "../../components/common/CustomSelect";
import { buildTaskById, parentTaskCandidates, taskPathLabel } from "../taskHierarchy";

interface PjLike { id: string; name: string; color_tag?: string | null }

export function buildParentOptions(
  tasks: Task[],
  projectId: string | null,
  forTaskId: string | undefined,
  currentParentId: string | null | undefined,
  projects: PjLike[],
  noneLabel: string,
): SelectOption[] {
  const live = tasks.filter(t => !t.is_deleted);
  const byId = buildTaskById(live);
  const pjOf = (id: string | null | undefined) => (id ? projects.find(p => p.id === id) : undefined);
  const colorOf = (id: string | null | undefined) => pjOf(id)?.color_tag ?? "var(--color-border-secondary)";
  const cands = parentTaskCandidates(live, projectId, forTaskId);
  const opts: SelectOption[] = [{ value: "", label: noneLabel }];
  for (const t of cands) opts.push({ value: t.id, label: taskPathLabel(t, byId), color: colorOf(t.project_id) });
  if (currentParentId && !cands.some(t => t.id === currentParentId)) {
    const cur = byId.get(currentParentId);
    if (cur) {
      opts.push({
        value: cur.id, label: taskPathLabel(cur, byId), color: colorOf(cur.project_id),
        meta: pjOf(cur.project_id)?.name, dim: true,
      });
    }
  }
  return opts;
}
