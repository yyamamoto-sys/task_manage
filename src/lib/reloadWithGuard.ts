// src/lib/reloadWithGuard.ts
//
// 「再読み込み」ボタンの共通処理。未保存の編集があれば確認（CLAUDE.md Section 46）してから reload する。
// 黙って reload しない（v3.146・CLAUDE.md Section 76）。

import { confirmDiscardUnsavedEdits } from "./editing/unsavedEditorRegistry";

export interface ReloadWithGuardDeps {
  confirm: () => Promise<boolean>;
  reload: () => void;
}

export async function reloadWithGuard(deps?: Partial<ReloadWithGuardDeps>): Promise<boolean> {
  const confirm = deps?.confirm ?? confirmDiscardUnsavedEdits;
  const reload = deps?.reload ?? (() => window.location.reload());
  if (!(await confirm())) return false;
  reload();
  return true;
}
