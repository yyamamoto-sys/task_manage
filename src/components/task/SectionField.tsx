// src/components/task/SectionField.tsx
//
// タスクの編集画面（TaskEditModal・TaskSidePanel）・登録（QuickAddTaskModal）に共通の
// 「グループ」選択欄と「成果物」欄。3画面で同じ部品を使い、文言・挙動をそろえる。
//
// 「グループ」は PJ の中の区分（コード・DB は section）。社内で「グループ」が部署の意味でも使われるため、
// 欄の説明に「プロジェクトの中の区分」と明記する。

import { useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import { CustomSelect, type SelectOption } from "../common/CustomSelect";
import { sectionsOfProject } from "../../lib/section/sections";
import { extractDeliverableUrls } from "../../lib/task/deliverable";

const labelStyle: React.CSSProperties = {
  fontSize: "10px", fontWeight: "500", color: "var(--color-text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px",
};
const noteStyle: React.CSSProperties = { marginTop: "4px", fontSize: "10px", color: "var(--color-text-tertiary)" };

interface SectionSelectProps {
  projectId: string | null;
  value: string | null;
  onChange: (sectionId: string | null) => void;
  /** 親タスクがあるとき：子は親と同じグループなので選べない。親のグループ id を渡す */
  parentLocked?: { sectionId: string | null } | null;
  disabled?: boolean;
}

/** 「グループ」の選択欄（そのPJのグループ＋未分類） */
export function SectionSelect({ projectId, value, onChange, parentLocked, disabled }: SectionSelectProps) {
  const allSections = useAppStore(s => s.projectSections);
  const sections = useMemo(() => sectionsOfProject(allSections, projectId), [allSections, projectId]);

  const options: SelectOption[] = useMemo(
    () => [{ value: "", label: "（未分類）" }, ...sections.map(s => ({ value: s.id, label: s.name }))],
    [sections],
  );

  const shownValue = parentLocked ? (parentLocked.sectionId ?? "") : (value ?? "");
  const noProject = !projectId;
  const locked = !!parentLocked;

  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={labelStyle}>グループ</div>
      <CustomSelect
        value={shownValue}
        onChange={v => onChange(v || null)}
        options={options}
        disabled={disabled || noProject || locked || sections.length === 0}
        searchable={sections.length >= 9}
        searchPlaceholder="グループで検索..."
      />
      <div style={noteStyle}>
        {noProject
          ? "プロジェクトを選ぶと、そのプロジェクトのグループを選べます"
          : locked
            ? "子タスクは親タスクと同じグループです"
            : sections.length === 0
              ? "このプロジェクトにはまだグループがありません（リストの「＋ グループを追加」から作れます）"
              : "プロジェクトの中の区分です（部署のグループではありません）"}
      </div>
    </div>
  );
}

interface DeliverableFieldProps {
  value: string;
  onChange: (v: string) => void;
  inputStyle: React.CSSProperties;
  rows?: number;
}

/** 「成果物」欄（複数行の自由記述）。下に検出した URL をリンクとして並べる */
export function DeliverableField({ value, onChange, inputStyle, rows = 3 }: DeliverableFieldProps) {
  const urls = useMemo(() => extractDeliverableUrls(value), [value]);
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={labelStyle}>成果物</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        maxLength={2000}
        aria-label="成果物"
        placeholder={"このタスクで何ができたら完了か（成果物）を書きます\n例：第2回の配布資料（PDF）https://… を書くと📎から開けます"}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, minHeight: "56px" }}
      />
      {urls.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "3px" }}>
          {urls.map(u => (
            <li key={u} style={{ fontSize: "11px", minWidth: 0 }}>
              <a
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                title={u}
                style={{
                  color: "var(--color-text-link, var(--color-brand))", textDecoration: "underline",
                  display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  verticalAlign: "bottom",
                }}
              >
                📎 {u}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
