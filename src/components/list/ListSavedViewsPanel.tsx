// src/components/list/ListSavedViewsPanel.tsx
//
// 【設計意図・v3.203】
// ツールバー「ビュー」ポップオーバーの中身。保存済みビューの一覧（クリックで適用）・名前変更・削除・
// 「現在の表示を保存…」・「上書き保存」・「既定に戻す」。状態（名前の入力中など）はこの部品が持ち、
// ポップオーバーを閉じると部品ごと消えて初期化される。永続化・適用は呼び出し側（ListView）が行う。
// 🔴 入力欄の Escape は stopPropagation する（ToolbarMenu が document の Escape でメニュー全体を閉じるため。
//    入力中の Escape は「入力をやめる」だけにしたい）。IME 変換中の Enter は確定扱いにしない。

import { useState } from "react";
import { MAX_SAVED_VIEWS, MAX_VIEW_NAME_LENGTH, type SavedView } from "../../lib/list/savedViews";

export interface SavedViewsMenuProps {
  items: SavedView[];
  activeId: string | null;
  /** 適用後に条件を変えたか */
  dirty: boolean;
  canAdd: boolean;
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOverwrite: () => void;
  onReset: () => void;
}

const ITEM: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "8px", width: "100%",
  padding: "7px 10px", fontSize: "12px", textAlign: "left",
  border: "none", borderRadius: "var(--radius-sm)",
  background: "transparent", color: "var(--color-text-primary)", cursor: "pointer",
};
const HEADING: React.CSSProperties = {
  padding: "6px 4px 3px", fontSize: "10px", fontWeight: 700,
  letterSpacing: "0.04em", color: "var(--color-text-tertiary)",
};
const DIVIDER: React.CSSProperties = { height: 1, background: "var(--color-border-primary)", margin: "4px 0" };
const ICON_BTN: React.CSSProperties = {
  flexShrink: 0, padding: "2px 5px", fontSize: "11px", border: "none",
  background: "transparent", color: "var(--color-text-tertiary)", cursor: "pointer",
};
const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: "border-box", padding: "5px 8px", fontSize: "12px",
  border: "1px solid var(--color-brand)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
};

function NameInput({ initial, placeholder, label, onSubmit, onCancel, submitLabel }: {
  initial: string; placeholder: string; label: string; submitLabel: string;
  onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = () => { if (text.trim() !== "") onSubmit(text); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 6px" }}>
      <input
        // 開いた直後に打ち始められるようにする（ポップオーバー内で押した操作への直接の応答）
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={text}
        maxLength={MAX_VIEW_NAME_LENGTH}
        placeholder={placeholder}
        aria-label={label}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        style={INPUT}
      />
      <button
        type="button" onClick={submit} disabled={text.trim() === ""}
        style={{ ...ICON_BTN, color: "var(--color-brand)", opacity: text.trim() === "" ? 0.4 : 1, fontWeight: 600 }}
      >{submitLabel}</button>
      <button type="button" onClick={onCancel} aria-label="入力をやめる" style={ICON_BTN}>✕</button>
    </div>
  );
}

export function ListSavedViewsPanel({
  items, activeId, dirty, canAdd, onApply, onSave, onRename, onDelete, onOverwrite, onReset,
}: SavedViewsMenuProps) {
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const active = items.find(v => v.id === activeId);

  return (
    <>
      <div style={HEADING}>保存したビュー</div>
      {items.length === 0 && (
        <div style={{ padding: "6px 10px 8px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          まだありません。今の「まとめ方・フィルター・並べ替え・列」を保存できます
        </div>
      )}
      {items.map(v => {
        if (renamingId === v.id) {
          return (
            <NameInput
              key={v.id} initial={v.name} placeholder="ビューの名前" label="ビューの新しい名前" submitLabel="変更"
              onSubmit={name => { onRename(v.id, name); setRenamingId(null); }}
              onCancel={() => setRenamingId(null)}
            />
          );
        }
        const selected = v.id === activeId;
        return (
          <div key={v.id} style={{ display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)", background: selected ? "var(--color-brand-light)" : "transparent" }}>
            <button
              type="button" role="menuitem" onClick={() => onApply(v.id)}
              title={`「${v.name}」を適用`}
              style={{ ...ITEM, flex: 1, minWidth: 0, color: selected ? "var(--color-brand)" : "var(--color-text-primary)", fontWeight: selected ? 600 : 400 }}
            >
              <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{selected ? "✓" : ""}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
            </button>
            <button type="button" onClick={() => setRenamingId(v.id)} aria-label={`${v.name}の名前を変更`} title="名前を変更" style={ICON_BTN}>✎</button>
            <button type="button" onClick={() => onDelete(v.id)} aria-label={`${v.name}を削除`} title="削除" style={ICON_BTN}>🗑</button>
          </div>
        );
      })}

      <div style={DIVIDER} />

      {active && dirty && (
        <button type="button" role="menuitem" onClick={onOverwrite} style={ITEM}>
          <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>「{active.name}」に上書き保存</span>
        </button>
      )}

      {saving ? (
        <NameInput
          initial="" placeholder="ビューの名前（例：今週の自分）" label="保存するビューの名前" submitLabel="保存"
          onSubmit={name => { onSave(name); setSaving(false); }}
          onCancel={() => setSaving(false)}
        />
      ) : (
        <button
          type="button" role="menuitem" onClick={() => setSaving(true)} disabled={!canAdd}
          title={canAdd ? undefined : `保存できるのは${MAX_SAVED_VIEWS}件までです。不要なビューを削除してください`}
          style={{ ...ITEM, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? "pointer" : "not-allowed" }}
        >
          <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
          <span>現在の表示を保存…</span>
        </button>
      )}
      {!canAdd && (
        <div style={{ padding: "0 10px 4px 30px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
          上限（{MAX_SAVED_VIEWS}件）です。不要なビューを削除してください
        </div>
      )}

      <button type="button" role="menuitem" onClick={onReset} style={{ ...ITEM, color: "var(--color-text-tertiary)" }}>
        <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
        <span>既定に戻す</span>
      </button>
    </>
  );
}
