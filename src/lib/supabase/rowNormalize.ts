// src/lib/supabase/rowNormalize.ts
//
// 取得した行の形をそろえる純粋関数（store.ts の supabase 依存から切り離し、appStore の realtime 差分からも使えるようにした。v3.146）。

import type { Project, Task } from "../localData/types";

/**
 * 取得した行を画面が期待する形（配列列の既定値・旧単数列からの移行）にそろえる。
 * 起動時の取得（fetchCriticalData）と realtime の差分（appStore.applyRemoteChange）の両方がこれを通す。
 * 差分側が生の行をそのまま入れると、旧データ（配列列が null）で load() 経由の行と形が食い違う（v3.146）。
 */
export function normalizeProjectRow(p: Record<string, unknown>): Project {
  return {
    ...p,
    owner_member_ids: (p.owner_member_ids as string[] | undefined)?.length
      ? p.owner_member_ids as string[]
      : p.owner_member_id ? [p.owner_member_id as string] : [],
    member_ids: Array.isArray(p.member_ids) ? p.member_ids as string[] : [],
  } as unknown as Project;
}

export function normalizeTaskRow(t: Record<string, unknown>): Task {
  return {
    ...t,
    todo_ids: Array.isArray(t.todo_ids) ? t.todo_ids as string[]
      : t.todo_id ? [t.todo_id as string] : [],
    assignee_member_ids: Array.isArray(t.assignee_member_ids) ? t.assignee_member_ids as string[]
      : t.assignee_member_id ? [t.assignee_member_id as string] : [],
    tags: Array.isArray(t.tags) ? t.tags as string[] : [],
  } as unknown as Task;
}
