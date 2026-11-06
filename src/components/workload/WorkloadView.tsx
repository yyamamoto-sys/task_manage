// src/components/workload/WorkloadView.tsx
//
// 【設計意図】
// メンバー別の負荷（誰がタスクを抱えすぎているか）を一目で把握するビュー。
// 集計ロジックは src/lib/workload/computeWorkload.ts（AI相談の member_workload と共通の
// 単一の真実源）を使う。主軸はタスク件数（工数は入力が疎なため補助表示にとどめる）。
//
// データは必ず selectScopedTasks / selectScopedMembers を使う（素の s.tasks / s.members は
// 使わない＝過去にAI機能でメンバー氏名が他部署へ越境漏洩した事故があり、部署スコープは厳守）。

import { useCallback, useMemo, useState } from "react";
import { useAppStore, selectScopedTasks, selectScopedMembers, selectScopedTaskDependencies } from "../../stores/appStore";
import type { Member, Project } from "../../lib/localData/types";
import { KEYS, active } from "../../lib/localData/localStore";
import {
  formatHours, overloadThreshold as computeOverloadThreshold, parseStoredWorkloadUnit, sortWorkloadRows, workloadValue, type WorkloadUnit,
} from "../../lib/workload/workloadMetric";
import { computeMemberWorkloadRows, type MemberWorkloadRow } from "../../lib/workload/computeWorkload";
import { getAssigneeIds, isActiveTaskStatus } from "../../lib/taskMeta";
import { Avatar } from "../auth/UserSelectScreen";
import { CustomSelect } from "../common/CustomSelect";
import { EmptyState } from "../common/EmptyState";
import { MemberDetailPanel } from "./MemberDetailPanel";
import { WorkloadWeekGrid } from "./WorkloadWeekGrid";
import {
  WEEK_COUNT_OPTIONS, parseStoredWeekCount, parseStoredWorkloadViewMode, type WeekCount, type WorkloadViewMode,
} from "../../lib/workload/weekGrid";
import { useIsMobile } from "../../hooks/useIsMobile";
import { withBellReserve } from "../../lib/layout/topRightBell";

interface Props {
  projects: Project[];
  /** メンバー詳細パネルからタスク行をクリックした時にタスク編集モーダルを開く（MainLayoutのaiEditTaskIdを流用） */
  onOpenTask: (taskId: string) => void;
  /** 週グリッドでタスクを動かしたときの updated_by */
  currentUserId: string;
}

export function WorkloadView({ projects, onOpenTask, currentUserId }: Props) {
  const scopedTasks = useAppStore(selectScopedTasks);
  const scopedMembers = useAppStore(selectScopedMembers);
  const scopedTaskDependencies = useAppStore(selectScopedTaskDependencies);
  const isMobile = useIsMobile();
  const [pjFilter, setPjFilter] = useState<string>("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  // 集計単位（件数／工数）。個人設定として localStorage に保存する
  const [unit, setUnitState] = useState<WorkloadUnit>(() => {
    try { return parseStoredWorkloadUnit(localStorage.getItem(KEYS.WORKLOAD_UNIT)); } catch { return "count"; }
  });
  const setUnit = useCallback((u: WorkloadUnit) => {
    setUnitState(u);
    try { localStorage.setItem(KEYS.WORKLOAD_UNIT, u); } catch { /* 保存できなくても表示は変える */ }
  }, []);

  // 表示（既存の一覧／週グリッド）と週グリッドの週数。個人設定として localStorage に保存する
  const [viewMode, setViewModeState] = useState<WorkloadViewMode>(() => {
    try { return parseStoredWorkloadViewMode(localStorage.getItem(KEYS.WORKLOAD_VIEW)); } catch { return "list"; }
  });
  const setViewMode = useCallback((v: WorkloadViewMode) => {
    setViewModeState(v);
    try { localStorage.setItem(KEYS.WORKLOAD_VIEW, v); } catch { /* 保存できなくても表示は変える */ }
  }, []);
  const [weekCount, setWeekCountState] = useState<WeekCount>(() => {
    try { return parseStoredWeekCount(localStorage.getItem(KEYS.WORKLOAD_WEEKS)); } catch { return parseStoredWeekCount(null); }
  });
  const setWeekCount = useCallback((n: WeekCount) => {
    setWeekCountState(n);
    try { localStorage.setItem(KEYS.WORKLOAD_WEEKS, String(n)); } catch { /* 保存できなくても表示は変える */ }
  }, []);

  // 選んでいたPJが一覧から消えた（削除・表示部署の切替）ときは「全プロジェクト」に戻す。
  // 戻さないと選択肢に無い値のまま全メンバーが0件に見える
  const effectivePjFilter = pjFilter === "all" || projects.some(p => p.id === pjFilter) ? pjFilter : "all";
  const filteredTasks = useMemo(
    () => effectivePjFilter === "all" ? scopedTasks : scopedTasks.filter(t => t.project_id === effectivePjFilter),
    [scopedTasks, effectivePjFilter],
  );

  const rows = useMemo(
    () => sortWorkloadRows(computeMemberWorkloadRows(scopedMembers, filteredTasks), unit),
    [scopedMembers, filteredTasks, unit],
  );

  const memberById = useMemo(() => new Map(scopedMembers.map(m => [m.id, m])), [scopedMembers]);
  const activeMembers = useMemo(() => active(scopedMembers), [scopedMembers]);
  const maxValue = Math.max(1, ...rows.map(r => workloadValue(r, unit)));

  // 「突出して多い」の目安：負荷を持つメンバーの平均の1.5倍以上、かつ下限以上（件数＝3件／工数＝8h。workloadMetric.ts）
  const overloadThreshold = computeOverloadThreshold(rows.map(r => workloadValue(r, unit)), unit);

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
          paddingRight: withBellReserve(16),
          borderBottom: "1px solid var(--color-border-primary)",
          background: "var(--color-bg-primary)", flexShrink: 0,
          flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)", flexShrink: 0 }}>
            ワークロード
          </div>
          <CustomSelect
            value={effectivePjFilter}
            onChange={setPjFilter}
            options={[
              { value: "all", label: "全プロジェクト" },
              ...projects.map(p => ({ value: p.id, label: p.name, color: p.color_tag })),
            ]}
            style={{ width: "200px" }}
          />
          <div role="group" aria-label="集計単位" style={{ display: "flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden", flexShrink: 0 }}>
            {([["count", "件数"], ["hours", "工数"]] as const).map(([u, label]) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                title={u === "count" ? "アクティブなタスクの件数で比べる" : "アクティブなタスクの工数合計で比べる（工数未入力のタスクは合計に入りません）"}
                style={{
                  padding: "4px 12px", fontSize: "11px", border: "none", cursor: "pointer",
                  background: unit === u ? "var(--color-brand-light)" : "transparent",
                  color: unit === u ? "var(--color-brand)" : "var(--color-text-secondary)",
                  fontWeight: unit === u ? 600 : 400,
                }}
              >{label}</button>
            ))}
          </div>
          <div role="group" aria-label="表示" style={{ display: "flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden", flexShrink: 0 }}>
            {([["list", "一覧"], ["week", "週グリッド"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewMode(v)}
                aria-pressed={viewMode === v}
                title={v === "list" ? "メンバーごとの負荷を棒グラフで比べる" : "担当者×週で、期日が入る週ごとの負荷を見る（タスクをドラッグして担当や期日を動かせる）"}
                style={{
                  padding: "4px 12px", fontSize: "11px", border: "none", cursor: "pointer", whiteSpace: "nowrap",
                  background: viewMode === v ? "var(--color-brand-light)" : "transparent",
                  color: viewMode === v ? "var(--color-brand)" : "var(--color-text-secondary)",
                  fontWeight: viewMode === v ? 600 : 400,
                }}
              >{label}</button>
            ))}
          </div>
          {viewMode === "week" && (
            <div style={{ flexShrink: 0, minWidth: 90 }}>
              <CustomSelect
                value={String(weekCount)}
                onChange={v => setWeekCount(parseStoredWeekCount(v))}
                options={WEEK_COUNT_OPTIONS.map(n => ({ value: String(n), label: `${n}週` }))}
              />
            </div>
          )}
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
          {viewMode === "week" ? (
            <WorkloadWeekGrid
              members={activeMembers}
              tasks={filteredTasks}
              unit={unit}
              weekCount={weekCount}
              currentUserId={currentUserId}
              onOpenTask={onOpenTask}
            />
          ) : (
          <div style={{ padding: "16px 20px", maxWidth: "900px" }}>
            {rows.length === 0 ? (
              <EmptyState icon="🧑‍🤝‍🧑" title="メンバーが登録されていません" hint="設定の「メンバー」からメンバーを追加すると、ここに負荷が表示されます。" />
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
                    unit={unit}
                    maxValue={maxValue}
                    isOverloaded={workloadValue(row, unit) > 0 && workloadValue(row, unit) >= overloadThreshold}
                    isLast={i === rows.length - 1}
                    isSelected={row.member_id === selectedMemberId}
                    onSelect={() => setSelectedMemberId(row.member_id)}
                  />
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {viewMode === "list" && selectedMember && (
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
  row, member, unit, maxValue, isOverloaded, isLast, isSelected, onSelect,
}: {
  row: MemberWorkloadRow;
  member: Member | undefined;
  unit: WorkloadUnit;
  maxValue: number;
  isOverloaded: boolean;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const value = workloadValue(row, unit);
  const barPct = Math.round((value / maxValue) * 100);
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
          {unit === "hours" ? (
            row.tasks_without_estimate > 0 && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                未入力 {row.tasks_without_estimate}件
              </span>
            )
          ) : (
            row.tasks_with_estimate > 0 && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                工数計 {row.total_estimated_hours}h（{row.tasks_with_estimate}件入力）
              </span>
            )
          )}
        </div>
        <div style={{ height: 7, background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${barPct}%`, background: barColor,
            borderRadius: "var(--radius-full)", transition: "width 0.3s ease",
          }} />
        </div>
      </div>

      <div style={{ width: unit === "hours" ? "60px" : "44px", textAlign: "right", flexShrink: 0 }}>
        <span style={{
          fontSize: "15px", fontWeight: 700,
          color: isOverloaded ? "var(--color-text-danger)" : "var(--color-text-primary)",
        }}>
          {unit === "hours" ? formatHours(value) : row.active_count}
        </span>
      </div>
    </div>
  );
}
