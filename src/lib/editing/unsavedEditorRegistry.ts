// src/lib/editing/unsavedEditorRegistry.ts
//
// 【設計意図】
// 明示保存の画面（TaskEditModal/TaskSidePanel等。CLAUDE.md Section 44）が「今dirty
// （未保存の変更がある）か」を登録し、画面遷移のトリガー元（MainLayoutのviewMode切替・
// App.tsxのログアウト等）がアンマウント前に同期的に問い合わせられるようにする、
// 独立した小さなレジストリ（v3.89）。
//
// 【zustandではなく独立モジュールにした理由】
// zustandストア（appStore.ts）はSupabaseと同期する「アプリの業務データ」（tasks/projects等）
// を持つ場所であり、ここで扱うのは「今この瞬間、画面上にdirtyな編集フォームが存在するか」
// という一過性のUI信号（Reactの再レンダリングを一切必要としない）。`src/lib/lastUndoStore.ts`
// （Undoの直前アクションを1件だけ保持）・`src/lib/errorReporter.ts`（CustomEventベースの
// エラー通知）と同じ「モジュール変数＋登録／解除関数」の流儀に合わせた。
//
// 【設計】複数の編集画面が理論上同時に存在しうる（MainLayoutはgraphEditTaskId・
// calendarEditTaskId・myPageEditTaskId・aiEditTaskIdの4つのTaskEditModalインスタンスを
// 同時に持ちうる）ため、単一のboolean値ではなくid→dirty判定関数（getter）のMapとして持つ。
// 「変更のたびにregistryへpushする」のではなく、登録時に渡した関数を毎回呼び出して評価する
// pull型にすることで、値の同期漏れ（更新し忘れ）が起きない（呼び出し側はuseRefで常に最新の
// isDirtyを指すgetterを渡すだけでよい。TaskEditModal.tsx/TaskSidePanel.tsx参照）。

import { confirmDialog } from "../dialog";

type DirtyGetter = () => boolean;

const registry = new Map<string, DirtyGetter>();

/**
 * 編集画面がマウント時に呼ぶ。idはコンポーネントインスタンスごとに一意にすること
 * （`useId()`を推奨）。同じidで複数回呼ぶと上書きされる。
 */
export function registerUnsavedEditor(id: string, isDirty: DirtyGetter): void {
  registry.set(id, isDirty);
}

/**
 * 編集画面がアンマウント時に必ず呼ぶ（useEffectのクリーンアップから）。
 * 呼び忘れると「編集していないのに毎回警告が出る」不具合になる
 * （`__tests__/unsavedEditorRegistry.test.ts`で登録/解除の対称性を固定している）。
 */
export function unregisterUnsavedEditor(id: string): void {
  registry.delete(id);
}

/** 現在、未保存の変更を持つ編集画面が1つでもあるか。 */
export function hasUnsavedEditors(): boolean {
  for (const isDirty of registry.values()) {
    if (isDirty()) return true;
  }
  return false;
}

/**
 * 未保存の編集があるか確認し、あれば確認ダイアログを出す。無ければ何もせず true を返す
 * （＝そのまま進んでよい）。ダイアログで「切り替える」を選んだら true、「編集に戻る」を
 * 選んだら false を返す。呼び出し側は true の場合のみ実際の画面遷移（state変更）を行うこと。
 *
 * 【安全側のデフォルト】ConfirmModalは背景クリックで必ずcancel（false）扱いになるため
 * （CLAUDE.md Section 45参照）、tone="danger"・confirmLabel=「切り替える」・
 * cancelLabel=「編集に戻る」とし、背景クリックが常に安全側（切り替えない）に
 * 倒れるようにしている（v3.88のタスク切替確認と同じ考え方）。
 *
 * 【v3.90：文言は「必ず起きること」だけを述べる】
 * この関数はviewMode/appMode/部署/PJ/KR切替・ラボ系ビューの開閉・管理画面/ガイドの
 * 開閉など、性質の異なる多数の画面遷移から共通で呼ばれる。遷移の種類によっては
 * （例：super-admin以外の部署切替）実際には編集画面が閉じず、下書きが消えない場合もある。
 * 「破棄されます」「消えます」のように断定すると、消えないケースでは嘘の警告になる。
 * そのため文言は「今のままでは保存されていない」という常に真である事実と、
 * 「切り替えるか・編集に戻るか」という選択だけを述べ、その先に何が起きるかは断定しない。
 */
export async function confirmDiscardUnsavedEdits(): Promise<boolean> {
  if (!hasUnsavedEditors()) return true;
  return confirmDialog(
    "保存していない変更があります。今のままでは保存されません。このまま切り替えますか？",
    { tone: "danger", confirmLabel: "切り替える", cancelLabel: "編集に戻る" },
  );
}

/** テスト用：レジストリを空にする（テスト間の汚染防止） */
export function _resetUnsavedEditorRegistryForTest(): void {
  registry.clear();
}

/** テスト用：現在登録されている件数（登録/解除の対称性をテストで確認するため） */
export function _unsavedEditorRegistrySizeForTest(): number {
  return registry.size;
}
