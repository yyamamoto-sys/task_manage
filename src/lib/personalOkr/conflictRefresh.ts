// src/lib/personalOkr/conflictRefresh.ts
//
// 【設計意図・M66】
// 個人OKRの保存で ConflictError（他の人・別タブが先に更新）が起きたとき、画面は古い updated_at の
// ままで、再保存しても同じ競合になり再読み込みするまで抜けられなかった。競合した行だけを取り直して
// ストアを最新にし、利用者には「最新を読み込んだ・入力は残してある」と伝える。
// 書きかけの欄はコンポーネント側の同期（syncEditedValue・M60）が守る＝未編集の欄だけが新しい値になり、
// 編集中の欄は残る。上書きを選ぶUIは作らない（再保存は最新の updated_at が基準になるので通る）。

import { ConflictError } from "../supabase/store";

export const CONFLICT_REFRESHED_MESSAGE =
  "他の人がこの内容を更新しました。最新の内容を読み込みました（あなたの入力は残しています）。";
export const CONFLICT_REFRESH_FAILED_MESSAGE =
  "他の人がこの内容を更新しました。最新の内容を読み込めなかったため、画面を再読み込みしてください（あなたの入力は残しています）。";

/** ConflictError の派生。instanceof ConflictError は従来どおり成り立つ */
export class PersonalOkrConflictError extends ConflictError {
  refreshed: boolean;
  constructor(table: string, id: string, refreshed: boolean) {
    super(table, id);
    this.refreshed = refreshed;
    this.message = refreshed ? CONFLICT_REFRESHED_MESSAGE : CONFLICT_REFRESH_FAILED_MESSAGE;
  }
}

/**
 * 保存で起きたエラーを受け取り、ConflictError なら最新の行を取り直して apply で反映し、
 * 利用者向けの PersonalOkrConflictError を返す。ConflictError でなければ元のエラーをそのまま返す。
 * 呼び出し側は `throw await resolveSaveConflict(...)` の形で使う。取り直しの失敗は握りつぶさず、
 * 「読み込めなかった」案内に切り替える（競合の通知自体は必ず出す）。
 */
export async function resolveSaveConflict<T extends { is_deleted?: boolean | null }>(
  e: unknown,
  fetchLatest: () => Promise<T | null>,
  apply: (row: T) => void,
): Promise<unknown> {
  if (!(e instanceof ConflictError)) return e;
  let refreshed = false;
  try {
    const latest = await fetchLatest();
    if (latest && !latest.is_deleted) {
      apply(latest);
      refreshed = true;
    }
  } catch {
    refreshed = false;
  }
  return new PersonalOkrConflictError(e.table, e.id, refreshed);
}
