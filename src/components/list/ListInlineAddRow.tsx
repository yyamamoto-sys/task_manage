// src/components/list/ListInlineAddRow.tsx
//
// 【設計意図】
// リスト（PC表）の各グループ末尾の「＋ タスクを追加」行。押すとその行が入力欄になり、
// タスク名・担当者・開始日・期日をその場で入れられる。担当者・日付は既存のセル編集部品
// （InlineEditAssignee／InlineEditDate）を流用し、リストの行と同じ見た目に揃える。
// 状態（下書き・保存中・フォーカス要求）は useListInlineAdd が持ち、この部品は描画と
// キー操作（Enter登録・Escでやめる・Tabで 名前→担当者→開始日→期日）だけを担う。
// モバイル（カード表示）では描画しない（FABのポップアップのまま）。

import { useEffect, useRef } from "react";
import type { Member } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { InlineEditAssignee } from "../common/InlineEditAssignee";
import { InlineEditDate } from "../common/InlineEditDate";
import { nextTabTarget, type AddSlot, type GroupAddSpec, type InlineDraft } from "../../lib/list/inlineAdd";

const CELL_PADDING = "3px 10px";
const FIRST_CELL_PADDING = "3px 6px 3px 12px";
const SLOT_ORDER: AddSlot[] = ["name", "assignee", "start", "due", "detail"];

interface Props {
  groupLabel: string;
  spec: GroupAddSpec;
  /** テーブルの列キー（ListView の cols と同じ順）。列数と各セルの割り当てに使う */
  colKeys: string[];
  draft: InlineDraft | undefined;
  saving: boolean;
  /** 0 でなければ、変わったときに名前欄へフォーカスして見える位置へスクロールする */
  focusNonce: number;
  /** 担当者別グループのときの担当者（その人に固定する＝グループに表示されるため） */
  lockedAssignee?: Member;
  onOpen: () => void;
  onChange: (patch: Partial<InlineDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onOpenDetail: () => void;
}

function focusSlot(row: HTMLElement, slot: AddSlot): boolean {
  const el = row.querySelector<HTMLElement>(
    `[data-add-slot="${slot}"] input, [data-add-slot="${slot}"] [role="button"], [data-add-slot="${slot}"] button`,
  );
  if (!el) return false;
  el.focus();
  return true;
}

export function ListInlineAddRow({
  groupLabel, spec, colKeys, draft, saving, focusNonce, lockedAssignee,
  onOpen, onChange, onSubmit, onCancel, onOpenDetail,
}: Props) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const expanded = draft !== undefined;

  useEffect(() => {
    if (!focusNonce || !expanded) return;
    nameRef.current?.focus();
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusNonce, expanded]);

  if (!draft) {
    return (
      <tr>
        <td colSpan={colKeys.length} style={{ padding: 0, borderBottom: "1px solid var(--color-bg-tertiary)" }}>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${groupLabel}にタスクを追加`}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "3px 12px", border: "none", background: "transparent",
              fontSize: "11px", color: "var(--color-text-tertiary)", cursor: "pointer", font: "inherit",
            }}
          >＋ タスクを追加</button>
        </td>
      </tr>
    );
  }

  // Tab は 名前→担当者→開始日→期日→「詳細を入れて追加」。DOM上の並び（担当者列が先）と
  // 違うため自前で移す。固定の担当者のように欄が無いときは次へ飛ばす。Portal（担当者の候補）
  // 由来のイベントは React ツリー上は子として届くため、行の DOM に含まれるものだけ扱う
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key !== "Tab") return;
    const row = e.currentTarget;
    const target = e.target as HTMLElement;
    if (!row.contains(target)) return;
    const holder = target.closest<HTMLElement>("[data-add-slot]");
    let slot = holder?.dataset.addSlot as AddSlot | undefined;
    if (!slot || !SLOT_ORDER.includes(slot)) return;
    let next = nextTabTarget(slot, e.shiftKey);
    while (next) {
      if (row.querySelector(`[data-add-slot="${next}"]`) && focusSlot(row, next)) {
        e.preventDefault();
        return;
      }
      slot = next;
      next = nextTabTarget(slot, e.shiftKey);
    }
  };

  const fieldBorder = "1px solid var(--color-brand)";
  const cell = (key: string, index: number) => {
    const padding = index === 0 ? FIRST_CELL_PADDING : CELL_PADDING;
    switch (key) {
      case "select":
        return <td key={key} style={{ padding, color: "var(--color-text-tertiary)" }} aria-hidden>＋</td>;
      case "assignee":
        return (
          <td key={key} style={{ padding, whiteSpace: "nowrap" }}>
            <div data-add-slot="assignee" style={{ display: "flex", alignItems: "center" }}>
              {lockedAssignee ? (
                <span title="このグループの担当者になります" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <Avatar member={lockedAssignee} size={16} />
                </span>
              ) : (
                <InlineEditAssignee
                  assigneeIds={draft.assigneeIds}
                  projectId={spec.projectId}
                  onSave={ids => onChange({ assigneeIds: ids })}
                />
              )}
            </div>
          </td>
        );
      case "name":
        return (
          <td key={key} style={{ padding }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div data-add-slot="name" style={{ flex: 1, minWidth: 0 }}>
                <input
                  ref={nameRef}
                  value={draft.name}
                  readOnly={saving}
                  maxLength={200}
                  onChange={e => onChange({ name: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      e.preventDefault();
                      onSubmit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCancel();
                    }
                  }}
                  placeholder="タスク名（Enterで追加・Escでやめる）"
                  aria-label={`${groupLabel}に追加するタスク名`}
                  style={{
                    width: "100%", font: "inherit", fontSize: "inherit",
                    color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
                    border: fieldBorder, borderRadius: "var(--radius-sm)",
                    padding: "1px 4px", outline: "none",
                  }}
                />
              </div>
              {saving && <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>追加中…</span>}
              <span data-add-slot="detail" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={onOpenDetail}
                  title="PJ・ToDo・KR・親タスクなども決めて追加します（ポップアップが開きます）"
                  style={{
                    padding: "0 4px", fontSize: "9px", color: "var(--color-text-tertiary)",
                    border: "none", background: "transparent", cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >詳細を入れて追加</button>
              </span>
            </div>
          </td>
        );
      case "status":
        return (
          <td key={key} style={{ padding, whiteSpace: "nowrap" }}>
            <button
              type="button"
              onClick={onCancel}
              aria-label="入力をやめる"
              title="入力をやめる（Esc）"
              style={{
                padding: "0 4px", fontSize: "10px", color: "var(--color-text-tertiary)",
                border: "none", background: "transparent", cursor: "pointer",
              }}
            >✕</button>
          </td>
        );
      case "due_date":
        return (
          <td key={key} style={{ padding, whiteSpace: "nowrap" }}>
            <span data-add-slot="start">
              <InlineEditDate
                value={draft.startDate || null}
                placeholder="開始日"
                onSave={v => onChange({ startDate: v ?? "" })}
              />
            </span>
            <span style={{ margin: "0 3px", color: "var(--color-text-tertiary)" }}>〜</span>
            <span data-add-slot="due">
              <InlineEditDate
                value={draft.dueDate || null}
                placeholder="期日"
                onSave={v => onChange({ dueDate: v ?? "" })}
              />
            </span>
          </td>
        );
      default:
        return <td key={key} style={{ padding }} />;
    }
  };

  return (
    <tr
      ref={rowRef}
      onKeyDown={handleRowKeyDown}
      style={{ borderBottom: "1px solid var(--color-bg-tertiary)", background: "var(--color-brand-light)" }}
    >
      {colKeys.map(cell)}
    </tr>
  );
}
