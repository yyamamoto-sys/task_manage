// src/components/list/ListToolbar.tsx
//
// 【設計意図】
// リストビュー上部のツールバー。**2段（約75px）を1段（約38px）に畳む**ための切り出し。
// 画面を拡大して使う利用者（視力・小画面）にとって、ビューポートはCSS px換算で縮むため
// 「縦の固定占有」の比率だけが上がり、一覧の表示行数が激減する。削るのは文字サイズではなく
// 「内容でない部分」＝枠・区切り線・重複ボタン・段数であり、既存の fontSize は変更しない。
//
// ボタン11個＋フィルター群を4つのポップオーバー（まとめ方／フィルター／並べ替え／その他）に
// 集約し、検索は同じ行にインライン展開する。ListView.tsx は既に1596行あるため、
// ここに切り出して state / setter / ハンドラは props で受け渡す。
//
// 【守っている契約】
// - CLAUDE.md Section 51：トリガー追従のポップオーバーは `useFloatingPanel` に集約する
//   （座標計算・スクロール追従・スクロール連鎖の遮断を自前で書かない）。
//   Portal 要素には pointer-events を auto に明示する（globals.css の
//   `body { pointer-events: none }` は継承プロパティのため）。
//   🔴 この説明文に検査対象の文字列そのもの（プロパティ名＋"auto"）を書かないこと。
//   floatingPanelContract.test.ts はソース走査で判定するため、コメントに書くと
//   実コードから消えてもコメント側が一致してしまい、検査が素通りする（実際に一度そうなった）。
// - CLAUDE.md Section 31：ヘッダーは `flexWrap:"wrap"`。各トリガーは
//   `whiteSpace:"nowrap"` + `flexShrink:0`（幅が足りないとき縦に潰さず折り返す）。
// - CLAUDE.md Section 49・50：固定 `height` を使わず `minHeight` にする
//   （拡大率・最小フォントサイズ設定で中身が育つと固定heightでは文字が切れる）。
//
// 🔴 フィルターのポップオーバー内で `CustomSelect` を使わないこと。
//    `CustomSelect` は `createPortal(document.body)` する別のポップオーバーであり、
//    親ポップオーバーの「外側クリックで閉じる」判定が CustomSelect の Portal を
//    「外側」と見なすため、セレクトを開いた瞬間に親が閉じる。担当者は素の input + リストで持つ。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingPanel } from "../../hooks/useFloatingPanel";
import type { Member, Task } from "../../lib/localData/types";

export type GroupBy = "project" | "assignee" | "status" | "tag";
export type SortKey = "name" | "due_date" | "priority" | "estimated_hours" | "status" | "assignee" | "manual";
export type SortDir = "asc" | "desc";
export type Density = "simple" | "detailed";

type MenuId = "group" | "filter" | "sort" | "more";

const GROUP_OPTIONS: { value: GroupBy; label: string; desc: string }[] = [
  { value: "project",  label: "PJ別",     desc: "プロジェクト別にまとめる" },
  { value: "assignee", label: "担当者別", desc: "担当者別にまとめる" },
  { value: "status",   label: "状態別",   desc: "ステータス別にまとめる" },
  { value: "tag",      label: "タグ別",   desc: "タグ別にまとめる" },
];

const STATUS_OPTIONS: { value: Task["status"] | "all"; label: string }[] = [
  { value: "all",         label: "すべて" },
  { value: "todo",        label: "ToDo" },
  { value: "in_progress", label: "進行中" },
  { value: "on_hold",     label: "保留" },
  { value: "done",        label: "完了" },
  { value: "cancelled",   label: "中止" },
];

const PRIORITY_OPTIONS: { value: "all" | "high" | "mid" | "low"; label: string }[] = [
  { value: "all",  label: "すべて" },
  { value: "high", label: "高" },
  { value: "mid",  label: "中" },
  { value: "low",  label: "低" },
];

/** 並べ替えトリガーのラベル。表の列見出しクリックでも sortKey は変わるため全値を持つ。 */
const SORT_LABEL: Record<SortKey, string> = {
  due_date: "期日順",
  name: "名前順",
  manual: "手動",
  priority: "優先度順",
  estimated_hours: "工数順",
  status: "状態順",
  assignee: "担当者順",
};

const SEARCH_WIDTH_PX = 200;

// ===== 共通スタイル =====

function triggerStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: "4px",
    padding: "3px 9px", fontSize: "11px", lineHeight: 1.5,
    borderRadius: "var(--radius-md)", cursor: "pointer",
    border: `1px solid ${active ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
    background: active ? "var(--color-brand-light)" : "transparent",
    color: active ? "var(--color-text-purple)" : "var(--color-text-secondary)",
    // Section 31：幅が足りないとき縦に潰さず折り返させる
    whiteSpace: "nowrap", flexShrink: 0,
  };
}

const MENU_ITEM_STYLE: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center", gap: "8px",
  padding: "7px 10px", fontSize: "12px", textAlign: "left",
  border: "none", borderRadius: "var(--radius-sm)",
  background: "transparent", color: "var(--color-text-primary)", cursor: "pointer",
};

const MENU_HEADING_STYLE: React.CSSProperties = {
  padding: "6px 4px 3px", fontSize: "10px", fontWeight: 700,
  letterSpacing: "0.04em", color: "var(--color-text-tertiary)",
};

const MENU_DIVIDER_STYLE: React.CSSProperties = {
  height: 1, background: "var(--color-border-primary)", margin: "4px 0",
};

const CHIP_ROW_STYLE: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: "4px", padding: "0 4px 4px",
};

// ===== ToolbarMenu（4つのポップオーバーで使い回す共通の器） =====
//
// 【設計意図】4つとも「トリガー＋Portalパネル＋外側クリック/Escで閉じる」で構造が同じ。
// 同じコードを4箇所にコピペすると、1箇所だけ直って他が取り残される事故が起きる
// （CLAUDE.md Section 51 の教訓＝担当者ドロップダウンの pointerEvents 付け忘れ）。
// 開いているメニューは呼び出し側の単一 state（openMenu）で持つため、同時に2つ開かない。

interface ToolbarMenuProps {
  id: MenuId;
  openMenu: MenuId | null;
  setOpenMenu: React.Dispatch<React.SetStateAction<MenuId | null>>;
  /** トリガーに出す文字（現在値を含むラベル） */
  label: string;
  ariaLabel: string;
  title?: string;
  /** 右肩に出す件数バッジ（0/未指定なら出さない） */
  badge?: number;
  /** トリガーを強調表示するか */
  active?: boolean;
  panelWidth: number;
  align?: "left" | "right";
  /** パネルの中身。close() を呼ぶと閉じる */
  children: (close: () => void) => React.ReactNode;
}

function ToolbarMenu({
  id, openMenu, setOpenMenu, label, ariaLabel, title, badge, active,
  panelWidth, align = "left", children,
}: ToolbarMenuProps) {
  const open = openMenu === id;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenMenu(null), [setOpenMenu]);

  // 位置決め・スクロール追従・スクロール連鎖の遮断は共通フックに集約（Section 51）
  const { panelStyle, scrollAreaStyle } = useFloatingPanel({
    open,
    onRequestClose: close,
    triggerRef,
    panelRef,
    align,
    width: panelWidth,
    preferredMaxHeight: 420,
    minMaxHeight: 160,
  });

  // 外側クリックで閉じる（トリガー・パネルの両方は除外）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Escapeで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenMenu(prev => (prev === id ? null : id))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        style={triggerStyle(!!active || open)}
      >
        <span>{label}</span>
        {badge != null && badge > 0 && (
          <span style={{
            fontSize: "9px", padding: "0 5px", lineHeight: 1.6, borderRadius: "99px",
            background: "var(--color-brand)", color: "#fff", flexShrink: 0,
          }}>{badge}</span>
        )}
        <span aria-hidden style={{ fontSize: "9px", opacity: 0.6 }}>▾</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="animate-dropdown"
          style={{
            ...panelStyle,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "4px",
            display: "flex", flexDirection: "column", overflow: "hidden",
            // body { pointer-events:none }（globals.css・継承プロパティ）を Portal 要素で打ち消す
            pointerEvents: "auto",
          }}
        >
          <div style={{ ...scrollAreaStyle, flex: 1 }}>
            {children(close)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ===== FilterChip（フィルターパネル内の小さな選択チップ） =====

function FilterChip({ active, onClick, label, title }: {
  active: boolean; onClick: () => void; label: string; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        padding: "3px 9px", fontSize: "11px", lineHeight: 1.5,
        borderRadius: "var(--radius-full)", cursor: "pointer",
        fontWeight: active ? 600 : 400,
        background: active ? "var(--color-brand-light)" : "transparent",
        color: active ? "var(--color-text-purple)" : "var(--color-text-secondary)",
        border: `1px solid ${active ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
        whiteSpace: "nowrap", flexShrink: 0,
      }}
    >{label}</button>
  );
}

// ===== ListToolbar 本体 =====

export interface ListToolbarProps {
  // まとめ方
  groupBy: GroupBy;
  onChangeGroupBy: (v: GroupBy) => void;
  // フィルター
  filterStatus: Task["status"] | "all";
  onChangeFilterStatus: (v: Task["status"] | "all") => void;
  filterPriority: "all" | "high" | "mid" | "low";
  onChangeFilterPriority: (v: "all" | "high" | "mid" | "low") => void;
  filterMember: string;
  onChangeFilterMember: (v: string) => void;
  filterMyOnly: boolean;
  onToggleMyOnly: () => void;
  filterThisWeek: boolean;
  onToggleThisWeek: () => void;
  filterHideDone: boolean;
  onToggleHideDone: () => void;
  activeFilterCount: number;
  onClearFilters: () => void;
  // 並べ替え
  sortKey: SortKey;
  sortDir: SortDir;
  onChangeSortKey: (k: SortKey) => void;
  onToggleManualSort: () => void;
  onSortByNameNumber: () => void;
  // 検索
  searchText: string;
  onChangeSearchText: (v: string) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  // その他
  density: Density;
  onChangeDensity: (v: Density) => void;
  onExportCSV: () => void;
  // 表示用
  taskCount: number;
  members: Member[];
  currentUserId: string;
}

export function ListToolbar({
  groupBy, onChangeGroupBy,
  filterStatus, onChangeFilterStatus,
  filterPriority, onChangeFilterPriority,
  filterMember, onChangeFilterMember,
  filterMyOnly, onToggleMyOnly,
  filterThisWeek, onToggleThisWeek,
  filterHideDone, onToggleHideDone,
  activeFilterCount, onClearFilters,
  sortKey, sortDir, onChangeSortKey, onToggleManualSort, onSortByNameNumber,
  searchText, onChangeSearchText, searchOpen, setSearchOpen, searchInputRef,
  density, onChangeDensity, onExportCSV,
  taskCount, members, currentUserId,
}: ListToolbarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [memberQuery, setMemberQuery] = useState("");

  // フィルターを閉じたら担当者の検索語を捨てる（次に開いたとき前回の絞り込みが残らない）
  useEffect(() => { if (openMenu !== "filter") setMemberQuery(""); }, [openMenu]);

  // 既存の CustomSelect と同じ並び順＝自分を先頭に
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => (a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)),
    [members, currentUserId],
  );
  const shownMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return sortedMembers;
    return sortedMembers.filter(m => m.display_name.toLowerCase().includes(q));
  }, [sortedMembers, memberQuery]);

  // 🔴 絞り込みが効いているのに入力欄が隠れていると「なぜ件数が減っているか」が分からなくなる。
  //    searchText が空でないときは常に展開したままにする。
  const searchExpanded = searchOpen || searchText !== "";

  const openSearch = () => {
    setSearchOpen(true);
    // 展開の transition と同じフレームで focus しても当たらないことがあるため次フレームで当てる
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const closeSearch = () => {
    onChangeSearchText("");
    setSearchOpen(false);
  };

  const groupLabel = GROUP_OPTIONS.find(g => g.value === groupBy)?.label ?? "PJ別";

  return (
    <div style={{
      padding: "6px 12px",
      // Section 49・50：固定 height を使わない（拡大率・最小フォントサイズで中身が育つと文字が切れる）
      minHeight: "38px",
      boxSizing: "border-box",
      borderBottom: "1px solid var(--color-border-primary)",
      background: "var(--color-bg-primary)", flexShrink: 0,
      display: "flex", alignItems: "center", gap: "6px",
      // Section 31：幅が足りないときは縦に潰さず折り返す
      flexWrap: "wrap",
    }}>
      {/* ① まとめ方 */}
      <ToolbarMenu
        id="group" openMenu={openMenu} setOpenMenu={setOpenMenu}
        label={`▦ ${groupLabel}`} ariaLabel="まとめ方" title="タスクのまとめ方"
        panelWidth={200}
      >
        {close => (
          <>
            {GROUP_OPTIONS.map(opt => {
              const selected = groupBy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  title={opt.desc}
                  onClick={() => { onChangeGroupBy(opt.value); close(); }}
                  style={{
                    ...MENU_ITEM_STYLE,
                    background: selected ? "var(--color-brand-light)" : "transparent",
                    color: selected ? "var(--color-brand)" : "var(--color-text-primary)",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{selected ? "✓" : ""}</span>
                  <span>▦ {opt.label}</span>
                </button>
              );
            })}
          </>
        )}
      </ToolbarMenu>

      {/* ② フィルター */}
      <ToolbarMenu
        id="filter" openMenu={openMenu} setOpenMenu={setOpenMenu}
        label="⚙ フィルター" ariaLabel="フィルター" title="絞り込み条件"
        badge={activeFilterCount} active={activeFilterCount > 0}
        panelWidth={280}
      >
        {() => (
          <>
            <div style={MENU_HEADING_STYLE}>状態</div>
            <div style={CHIP_ROW_STYLE}>
              {STATUS_OPTIONS.map(o => (
                <FilterChip
                  key={o.value}
                  active={filterStatus === o.value}
                  label={o.label}
                  onClick={() => onChangeFilterStatus(o.value)}
                />
              ))}
            </div>

            <div style={MENU_HEADING_STYLE}>優先度</div>
            <div style={CHIP_ROW_STYLE}>
              {PRIORITY_OPTIONS.map(o => (
                <FilterChip
                  key={o.value}
                  active={filterPriority === o.value}
                  label={o.label}
                  onClick={() => onChangeFilterPriority(o.value)}
                />
              ))}
            </div>

            {/* 担当者別グループ中は担当者フィルターを出さない（冗長のため・既存の条件を維持） */}
            {groupBy !== "assignee" && (
              <>
                <div style={MENU_HEADING_STYLE}>担当者</div>
                {/* 🔴 ここで CustomSelect を使わない（親ポップオーバーが即閉じるため。ファイル冒頭参照） */}
                <input
                  value={memberQuery}
                  onChange={e => setMemberQuery(e.target.value)}
                  placeholder="メンバーで検索..."
                  aria-label="メンバーで検索"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "6px 9px", margin: "0 0 4px", fontSize: "12px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-bg-secondary)",
                    color: "var(--color-text-primary)", outline: "none",
                  }}
                />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onChangeFilterMember("all")}
                  style={{
                    ...MENU_ITEM_STYLE,
                    background: filterMember === "all" ? "var(--color-brand-light)" : "transparent",
                    color: filterMember === "all" ? "var(--color-brand)" : "var(--color-text-primary)",
                    fontWeight: filterMember === "all" ? 600 : 400,
                  }}
                >
                  <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{filterMember === "all" ? "✓" : ""}</span>
                  <span>全員</span>
                </button>
                {shownMembers.map(m => {
                  const selected = filterMember === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitem"
                      onClick={() => onChangeFilterMember(m.id)}
                      style={{
                        ...MENU_ITEM_STYLE,
                        background: selected ? "var(--color-brand-light)" : "transparent",
                        color: selected ? "var(--color-brand)" : "var(--color-text-primary)",
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{selected ? "✓" : ""}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.display_name}</span>
                    </button>
                  );
                })}
                {shownMembers.length === 0 && (
                  <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    該当するメンバーがいません
                  </div>
                )}
              </>
            )}

            <div style={MENU_HEADING_STYLE}>追加条件</div>
            <div style={CHIP_ROW_STYLE}>
              <FilterChip active={filterMyOnly}   onClick={onToggleMyOnly}   label="👤 自分担当のみ" />
              <FilterChip active={filterThisWeek} onClick={onToggleThisWeek} label="📅 今週期限のみ" />
              <FilterChip active={filterHideDone} onClick={onToggleHideDone} label="🙈 完了を隠す" />
            </div>

            {activeFilterCount > 0 && (
              <>
                <div style={MENU_DIVIDER_STYLE} />
                <button
                  type="button"
                  role="menuitem"
                  onClick={onClearFilters}
                  aria-label="フィルターをすべて解除"
                  style={{ ...MENU_ITEM_STYLE, color: "var(--color-text-tertiary)" }}
                >
                  <span aria-hidden style={{ width: 12, flexShrink: 0 }}>✕</span>
                  <span>すべて解除</span>
                </button>
              </>
            )}
          </>
        )}
      </ToolbarMenu>

      {/* ③ 並べ替え */}
      <ToolbarMenu
        id="sort" openMenu={openMenu} setOpenMenu={setOpenMenu}
        label={`↕ ${SORT_LABEL[sortKey]}`} ariaLabel="並べ替え" title="並べ替え"
        active={sortKey === "manual"}
        panelWidth={260}
      >
        {close => (
          <>
            {([["due_date", "📅 期日順"], ["name", "🔠 名前順"]] as const).map(([k, lbl]) => {
              const selected = sortKey === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="menuitem"
                  onClick={() => onChangeSortKey(k)}
                  style={{
                    ...MENU_ITEM_STYLE,
                    background: selected ? "var(--color-brand-light)" : "transparent",
                    color: selected ? "var(--color-brand)" : "var(--color-text-primary)",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <span style={{ flex: 1 }}>{lbl}</span>
                  {selected && <span aria-hidden style={{ fontSize: "11px" }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
                </button>
              );
            })}

            <div style={MENU_DIVIDER_STYLE} />

            <button
              type="button"
              role="menuitemcheckbox"
              onClick={onToggleManualSort}
              aria-checked={sortKey === "manual"}
              style={{
                ...MENU_ITEM_STYLE,
                background: sortKey === "manual" ? "var(--color-brand-light)" : "transparent",
                color: sortKey === "manual" ? "var(--color-brand)" : "var(--color-text-primary)",
                fontWeight: sortKey === "manual" ? 600 : 400,
              }}
            >
              <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{sortKey === "manual" ? "✓" : ""}</span>
              <span>⠿ 手動で並べ替える</span>
            </button>
            <div style={{ padding: "0 10px 6px 30px", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
              親タスクをドラッグで並べ替え（全員に共有）
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => { close(); onSortByNameNumber(); }}
              title="タスク名の先頭の番号（自然順）で並べ替えます。全員の画面に反映されます。"
              style={MENU_ITEM_STYLE}
            >
              <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
              <span>🔢 タスク名の番号順に並べ直す</span>
            </button>
          </>
        )}
      </ToolbarMenu>

      {/* ④ spacer */}
      <span style={{ flex: 1 }} />

      {/* ⑤ 件数（フィルター数のバッジは②のトリガーへ移したのでここには出さない） */}
      <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {taskCount}件
      </span>

      {/* ⑥ 検索（同じ行にインライン展開） */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => { if (searchExpanded) setSearchOpen(false); else openSearch(); }}
          aria-label="検索"
          aria-expanded={searchExpanded}
          title="検索（/ キー）"
          style={triggerStyle(searchText !== "")}
        >🔍</button>
        <div style={{
          display: "flex", alignItems: "center", gap: "2px",
          width: searchExpanded ? `${SEARCH_WIDTH_PX}px` : "0px",
          overflow: "hidden",
          transition: "width 0.15s ease",
        }}>
          <input
            ref={searchInputRef}
            value={searchText}
            onChange={e => onChangeSearchText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
                closeSearch();
              }
            }}
            placeholder="タスク名・メモで検索"
            aria-label="タスク名・メモで検索"
            aria-hidden={!searchExpanded}
            tabIndex={searchExpanded ? 0 : -1}
            style={{
              flex: 1, minWidth: 0, padding: "3px 8px", fontSize: "11px", lineHeight: 1.5,
              border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
              background: "var(--color-bg-primary)", color: "var(--color-text-primary)", outline: "none",
            }}
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="検索を閉じる"
            title="検索を閉じる"
            aria-hidden={!searchExpanded}
            tabIndex={searchExpanded ? 0 : -1}
            style={{
              flexShrink: 0, padding: "2px 5px", fontSize: "11px",
              color: "var(--color-text-tertiary)", border: "none",
              background: "transparent", cursor: "pointer",
            }}
          >✕</button>
        </div>
      </div>

      {/* ⑦ その他 */}
      <ToolbarMenu
        id="more" openMenu={openMenu} setOpenMenu={setOpenMenu}
        label="⋯" ariaLabel="その他の操作" title="表示・出力"
        panelWidth={240} align="right"
      >
        {close => (
          <>
            <div style={MENU_HEADING_STYLE}>表示</div>
            {([["simple", "▤ シンプル（主要4列）"], ["detailed", "▦ 詳細（優先度・工数を含む）"]] as const).map(([d, lbl]) => {
              const selected = density === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="menuitem"
                  onClick={() => { onChangeDensity(d); close(); }}
                  style={{
                    ...MENU_ITEM_STYLE,
                    background: selected ? "var(--color-brand-light)" : "transparent",
                    color: selected ? "var(--color-brand)" : "var(--color-text-primary)",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{selected ? "✓" : ""}</span>
                  <span>{lbl}</span>
                </button>
              );
            })}

            <div style={MENU_DIVIDER_STYLE} />

            <button
              type="button"
              role="menuitem"
              onClick={() => { close(); onExportCSV(); }}
              aria-label="CSV出力"
              style={MENU_ITEM_STYLE}
            >
              <span aria-hidden style={{ width: 12, flexShrink: 0 }} />
              <span>⭳ CSV出力</span>
            </button>
          </>
        )}
      </ToolbarMenu>
    </div>
  );
}
