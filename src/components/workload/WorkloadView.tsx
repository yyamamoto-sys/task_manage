// src/components/workload/WorkloadView.tsx
//
// 【設計意図】
// メンバー別の負荷（誰がタスクを抱えすぎているか）を一目で把握するビュー。
// 集計ロジックは src/lib/workload/computeWorkload.ts（AI相談の member_workload と共通の
// 単一の真実源）を使う。主軸はタスク件数（工数は入力が疎なため補助表示にとどめる）。
//
// データは必ず selectScopedTasks / selectScopedMembers を使う（素の s.tasks / s.members は
// 使わない＝過去にAI機能でメンバー氏名が他部署へ越境漏洩した事故があり、部署スコープは厳守）。

import { useMemo, useState } from "react";
import { useAppStore, selectScopedTasks, selectScopedMembers, selectScopedTaskDependencies } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { computeMemberWorkloadRows, type MemberWorkloadRow } from "../../lib/workload/computeWorkload";
import { getAssigneeIds, isActiveTaskStatus } from "../../lib/taskMeta";
import { Avatar } from "../auth/UserSelectScreen";
import { CustomSelect } from "../common/CustomSelect";
import { EmptyState } from "../common/EmptyState";
import { MemberDetailPanel } from "./MemberDetailPanel";
import { useIsMobile } from "../../hooks/useIsMobile";

interface Props {
  projects: Project[];
  /** メンバー詳細パネルからタスク行をクリックした時にタスク編集モーダルを開く（MainLayoutのaiEditTaskIdを流用） */
  onOpenTask: (taskId: string) => void;
}

export function WorkloadView({ projects, onOpenTask }: Props) {
  const scopedTasks = useAppStore(selectScopedTasks);
  const scopedMembers = useAppStore(selectScopedMembers);
  const scopedTaskDependencies = useAppStore(selectScopedTaskDependencies);
  const isMobile = useIsMobile();
  const [pjFilter, setPjFilter] = useState<string>("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const filteredTasks = useMemo(
    () => pjFilter === "all" ? scopedTasks : scopedTasks.filter(t => t.project_id === pjFilter),
    [scopedTasks, pjFilter],
  );

  const rows = useMemo(
    () => computeMemberWorkloadRows(scopedMembers, filteredTasks)
      .slice()
      .sort((a, b) => b.active_count - a.active_count),
    [scopedMembers, filteredTasks],
  );

  const memberById = useMemo(() => new Map(scopedMembers.map(m => [m.id, m])), [scopedMembers]);
  const maxActive = Math.max(1, ...rows.map(r => r.active_count));

  // 「突出して多い」の目安：アクティブ件数を持つメンバーの平均の1.5倍以上、かつ最低3件以上
  // （0〜1件のメンバー同士の僅差を強調表示で目立たせないための下限）
  const withLoad = rows.filter(r => r.active_count > 0);
  const avgActive = withLoad.length > 0
    ? withLoad.reduce((sum, r) => sum + r.active_count, 0) / withLoad.length
    : 0;
  const overloadThreshold = Math.max(3, avgActive * 1.5);

  // 「アクティブ」の定義は computeMemberWorkloadRows と同じ（done・cancelled・on_hold は対象外。
  // 中止・保留の未割当タスクを「未割当」として騒がせない＝2026-07-21ステータス拡張時に本行が
  // 追従漏れしていたのを修正）
  const unassignedCount = filteredTasks.filter(t => !t.is_deleted && isActiveTaskStatus(t.status) && getAssigneeIds(t).length === 0).length;

  const selectedMember = selectedMemberId ? memberById.get(selectedMemberId) : undefined;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ===== 固定ヘッダー帯 ===== */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-primary)", flexShrink: 0,
          flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flexShrink: 0 }}>
            ワークロード
          </div>
          <CustomSelect
            value={pjFilter}
            onChange={setPjFilter}
            options={[
              { value: "all", label: "全プロジェクト" },
              ...projects.map(p => ({ value: p.id, label: p.name, color: p.color_tag })),
            ]}
            style={{ width: "200px" }}
          />
          {unassignedCount > 0 && (
            <span style={{
              fontSize: "11px", padding: "2px 9px", borderRadius: "var(--radius-full)",
              background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)",
            }}>
              未割当タスク {unassignedCount}件
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ padding: "16px 20px", maxWidth: "900px" }}>
            {rows.length === 0 ? (
              <EmptyState icon="🧑‍🤝‍🧑" title="メンバーが登録されていません" hint="管理画面からメンバーを追加すると、ここに負荷が表示されます。" />
            ) : (
              <div style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
              }}>
                {rows.map((row, i) => (
                  <WorkloadRow
                    key={row.member_id}
                    row={row}
                    member={memberById.get(row.member_id)}
                    maxActive={maxActive}
                    isOverloaded={row.active_count >= overloadThreshold}
                    isLast={i === rows.length - 1}
                    isSelected={row.member_id === selectedMemberId}
                    onSelect={() => setSelectedMemberId(row.member_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedMember && (
        <MemberDetailPanel
          member={selectedMember}
          tasks={filteredTasks}
          allTasks={scopedTasks}
          projects={projects}
          taskDependencies={scopedTaskDependencies}
          onOpenTask={onOpenTask}
          onClose={() => setSelectedMemberId(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

function WorkloadRow({
  row, member, maxActive, isOverloaded, isLast, isSelected, onSelect,
}: {
  row: MemberWorkloadRow;
  member: Member | undefined;
  maxActive: number;
  isOverloaded: boolean;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const barPct = Math.round((row.active_count / maxActive) * 100);
  const barColor = isOverloaded ? "var(--color-text-danger)" : "var(--color-brand)";

  return (
    <div
      onClick={onSelect}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      title={`${member?.display_name ?? row.short_name}の状況詳細を見る`}
      style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "12px 16px", cursor: "pointer",
        background: isSelected ? "var(--color-brand-light)" : "transparent",
        borderBottom: isLast ? "none" : "1px solid var(--color-border-primary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "150px", flexShrink: 0 }}>
        {member ? <Avatar member={member} size={26} /> : (
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--color-bg-tertiary)", flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {member?.display_name ?? row.short_name}
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            未着手 <strong style={{ color: "var(--color-text-primary)" }}>{row.todo_count}</strong>
            {"　"}進行中 <strong style={{ color: "var(--color-text-primary)" }}>{row.in_progress_count}</strong>
          </span>
          {row.overdue_count > 0 && (
            <span style={{
              fontSize: "10px", padding: "1px 7px", borderRadius: "var(--radius-full)",
              background: "var(--color-bg-danger)", color: "var(--color-text-danger)",
              border: "1px solid var(--color-border-danger)", fontWeight: 500,
            }}>
              期限超過 {row.overdue_count}件
            </span>
          )}
          {row.tasks_with_estimate > 0 && (
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
              工数計 {row.total_estimated_hours}h（{row.tasks_with_estimate}件入力）
            </span>
          )}
        </div>
        <div style={{ height: 7, background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${barPct}%`, background: barColor,
            borderRadius: "var(--radius-full)", transition: "width 0.3s ease",
          }} />
        </div>
      </div>

      <div style={{ width: "44px", textAlign: "right", flexShrink: 0 }}>
        <span style={{
          fontSize: "15px", fontWeight: 700,
          color: isOverloaded ? "var(--color-text-danger)" : "var(--color-text-primary)",
        }}>
          {row.active_count}
        </span>
      </div>
    </div>
  );
}
