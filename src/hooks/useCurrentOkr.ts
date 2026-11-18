// src/hooks/useCurrentOkr.ts
//
// 【設計意図】表示中の部署の「今の期」の KR・TF（非削除）だけを返す。
// KR・TF を一覧・選択肢にする画面はこのフックか lib/okr/deptScope.ts の current* を通す（v3.218）。
// keepKrIds / keepTfIds は「既に紐づいている行」を前の期でも残すためのもの。
import { useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { currentKeyResultsInGroup } from "../lib/okr/deptScope";

export function useCurrentOkr(keepKrIds: string[] = []) {
  const objectives = useAppStore(s => s.objectives);
  const rawKrs = useAppStore(s => s.keyResults);
  const rawTfs = useAppStore(s => s.taskForces);
  const groupId = useAppStore(s => s.currentGroupId);
  const keepKey = keepKrIds.join("|");
  return useMemo(() => {
    const krsAll = rawKrs.filter(k => !k.is_deleted);
    const tfsAll = rawTfs.filter(t => !t.is_deleted);
    const keepKrs = keepKey ? keepKey.split("|") : [];
    const keyResults = currentKeyResultsInGroup(krsAll, objectives, groupId, keepKrs);
    const krIds = new Set(keyResults.map(k => k.id));
    return { keyResults, taskForces: tfsAll.filter(t => krIds.has(t.kr_id)) };
    // TF は採用した KR（keep の KR を含む）の配下で絞る
  }, [objectives, rawKrs, rawTfs, groupId, keepKey]);
}
