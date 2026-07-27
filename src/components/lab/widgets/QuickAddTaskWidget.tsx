// src/components/lab/widgets/QuickAddTaskWidget.tsx
//
// 【設計意図】
// タスク名を入力してEnterで作成できるウィジェット（書き込みアクションの最初の実例）。
// 【最重要】ウィジェットから saveTask を直接呼ばない。必ず actions.createTask（=ホスト側で
// appStore.saveTask を呼ぶ実装）経由で作成する。これにより B1依存ゲート・B4ベースライン・
// v2.75親自動完了などの choke point を必ず通す（docs/dev/mypage-widgets-design.md
// 「actions の拡張ポリシー」参照）。
//
// configSchema の projectId（追加先プロジェクト。既定は未選択＝PJなし）・defaultDueInDays
// （既定の期日。0なら期日なしで作成、1以上なら「今日+N日」を期日にする）は
// WidgetConfigModal の⚙から設定する。

import { useRef, useState } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig } from "../../../lib/widgets/config";
import { isGuestMember } from "../../../lib/guestMode";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { showToast } from "../../common/Toast";
import { addDaysFromToday } from "../../../lib/date";

/** レジストリ（registry.ts）が WidgetDefinition.configSchema としてそのまま使う */
export const QUICK_ADD_TASK_CONFIG_SCHEMA: WidgetConfigField[] = [
  { key: "projectId", label: "追加先プロジェクト", type: "select", description: "未選択の場合はプロジェクトに紐づけずに作成します" },
  { key: "defaultDueInDays", label: "既定の期日（今日から何日後）", type: "number", defaultValue: 0, min: 0, max: 365, description: "0なら期日なしで作成します" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-secondary)", color: "var(--color-text-primary)",
  fontFamily: "inherit", outline: "none",
};

export function QuickAddTaskWidget({ currentUser, config, actions }: WidgetContext) {
  const isGuest = isGuestMember(currentUser);
  const resolved = resolveConfig(QUICK_ADD_TASK_CONFIG_SCHEMA, config);
  const projectId = resolved.projectId as string;
  const defaultDueInDays = resolved.defaultDueInDays as number;

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (isGuest) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0" }}>
        ゲストは閲覧のみです
      </div>
    );
  }

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await actions.createTask({
        name: trimmed,
        projectId: projectId || null,
        dueDate: defaultDueInDays > 0 ? addDaysFromToday(defaultDueInDays) : null,
      });
      showToast(`「${trimmed}」を作成しました`, "success");
      setName("");
      inputRef.current?.focus();
    } catch (e) {
      showToast(formatErrorForUser("タスクの作成に失敗しました", e), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={name}
      disabled={submitting}
      onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") void handleSubmit(); }}
      placeholder="＋ タスク名を入力してEnter..."
      style={inputStyle}
    />
  );
}
