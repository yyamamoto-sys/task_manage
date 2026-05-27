// src/components/milestone/MilestoneAddForm.tsx
//
// 【設計意図】
// マイルストーンの追加フォームの共有部品。管理画面（AdminView）とプロジェクトカルテ
// （ProjectKarte）の両方から同じUI・同じ挙動で使えるように切り出した。
// 重複実装を避けるため、追加フォームはこのファイルに一本化する。
//
// Props は呼び出し側が pjId / currentUserId / onAdd を渡すだけ。
// onAdd には appStore の saveMilestone をそのまま渡せる（Milestone を1件受け取る）。
// PJごとに独立したフォーム状態を持つことでPJ間の入力混在を防ぐ。

import { useState } from "react";
import type { Milestone } from "../../lib/localData/types";

// 週文字列（"2026-W13"）をその週の月曜日の日付に変換する
export function weekToDate(weekStr: string): string {
  const [yearStr, weekPart] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekPart, 10);
  // 1月4日は常にW1に含まれる
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

// 日付文字列から週の月曜〜日曜の範囲ラベルを生成する（例: "3/23〜3/29"）
export function weekRangeLabel(dateStr: string): string {
  const mon = new Date(dateStr);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.getMonth() + 1}/${mon.getDate()}〜${sun.getMonth() + 1}/${sun.getDate()}`;
}

// このフォーム専用のスタイル定義（AdminView の inputStyle / primaryBtnStyle を踏襲）。
// 共有部品として自己完結させるため、ここに持たせる。var(--color-*) トークンを使用。
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
  outline: "none",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", fontSize: "11px", fontWeight: "500",
  background: "var(--color-bg-info)", color: "var(--color-text-info)",
  border: "1px solid var(--color-border-info)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
};

interface MilestoneAddFormProps {
  pjId: string;
  currentUserId: string;
  onAdd: (ms: Milestone) => Promise<void> | void;
}

export function MilestoneAddForm({ pjId, currentUserId, onAdd }: MilestoneAddFormProps) {
  const [dateMode, setDateMode] = useState<"date" | "week">("date");
  const [dateVal, setDateVal]     = useState("");
  const [weekVal, setWeekVal]     = useState("");
  const [name, setName]           = useState("");
  const [description, setDescription] = useState("");

  const resolvedDate = dateMode === "date" ? dateVal : (weekVal ? weekToDate(weekVal) : "");
  const canSubmit = name.trim() !== "" && resolvedDate !== "";

  const handleAdd = async () => {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    await onAdd({
      id: crypto.randomUUID(),
      project_id: pjId,
      name: name.trim(),
      date: resolvedDate,
      description: description.trim() || undefined,
      is_deleted: false,
      created_at: now, updated_at: now, updated_by: currentUserId,
    });
    setDateVal(""); setWeekVal(""); setName(""); setDescription("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {/* 日付モード切り替え */}
      <div style={{ display: "flex", gap: "4px" }}>
        {(["date", "week"] as const).map(mode => (
          <button key={mode} onClick={() => setDateMode(mode)} style={{
            padding: "2px 10px", fontSize: "10px",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-primary)",
            cursor: "pointer",
            background: dateMode === mode ? "var(--color-bg-info)" : "transparent",
            color: dateMode === mode ? "var(--color-text-info)" : "var(--color-text-tertiary)",
            fontWeight: dateMode === mode ? "500" : "400",
          }}>
            {mode === "date" ? "日付" : "週"}
          </button>
        ))}
      </div>

      {/* 日付 or 週 入力 */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {dateMode === "date" ? (
          <input type="date" value={dateVal}
            onChange={e => setDateVal(e.target.value)}
            style={{ ...inputStyle, width: "140px", flexShrink: 0 }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <input type="week" value={weekVal}
              onChange={e => setWeekVal(e.target.value)}
              style={{ ...inputStyle, width: "160px", flexShrink: 0 }}
            />
            {weekVal && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                {weekRangeLabel(weekToDate(weekVal))}
              </span>
            )}
          </div>
        )}
        <input
          value={name} placeholder="マイルストーン名 *"
          maxLength={60}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          style={{ ...inputStyle, flex: 1, minWidth: "120px" }}
        />
      </div>

      {/* 説明（任意） */}
      <textarea
        value={description} placeholder="説明（任意）"
        maxLength={200} rows={2}
        onChange={e => setDescription(e.target.value)}
        style={{ ...inputStyle, resize: "vertical" }}
      />

      <div>
        <button onClick={handleAdd} disabled={!canSubmit} style={primaryBtnStyle}>
          追加
        </button>
      </div>
    </div>
  );
}
