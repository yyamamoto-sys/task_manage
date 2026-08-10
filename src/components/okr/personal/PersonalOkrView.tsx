// src/components/okr/personal/PersonalOkrView.tsx
//
// 【設計意図】
// OKRモード「自分」タブの本体。個人四半期KRのタブ一覧（ウェイト付き）→ 選択中KRの
// PersonalKrPanel（月切替・今月の計画・週の目標状態・メモ）を描画する。
// docs/dev/okr-redesign-plan.md §7・CLAUDE.md Section 24 が正本。
//
// 状態はappStore（全アプリの単一真実）ではなく専用のusePersonalOkrUiStore（zustand。
// このコンポーネントがReact.lazyで分割されているため、import自体が「自分」タブを
// 開いた瞬間まで遅延する＝OKRモードを使わない人にこのテーブル群のクエリを発生させない。
// CLAUDE.md Section 19）を使う。

import { useEffect, useMemo, useState } from "react";
import { useAppStore, selectScopedTasks, selectScopedTaskDependencies } from "../../../stores/appStore";
import { usePersonalOkrUiStore } from "../../../stores/personalOkrUiStore";
import type { Member, PersonalKr, Quarter } from "../../../lib/localData/types";
import { currentQuarter } from "../../../lib/date";
import { sumWeightPct, isWeightTotalWarning } from "../../../lib/personalOkr/weightCheck";
import { CustomSelect } from "../../common/CustomSelect";
import { PersonalKrFormModal } from "./PersonalKrFormModal";
import { PersonalKrPanel } from "./PersonalKrPanel";
import { PersonalOkrImportModal } from "./PersonalOkrImportModal";

const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: "1Q", label: "1Q（1〜3月）" },
  { value: "2Q", label: "2Q（4〜6月）" },
  { value: "3Q", label: "3Q（7〜9月）" },
  { value: "4Q", label: "4Q（10〜12月）" },
];

interface Props {
  currentUser: Member;
}

export function PersonalOkrView({ currentUser }: Props) {
  const keyResults = useAppStore(s => s.keyResults);
  const taskForces = useAppStore(s => s.taskForces);
  const objectives = useAppStore(s => s.objectives);
  const todos = useAppStore(s => s.todos);
  const currentGroupId = useAppStore(s => s.currentGroupId);
  const tasks = useAppStore(selectScopedTasks);
  const taskDependencies = useAppStore(selectScopedTaskDependencies);

  const krs = usePersonalOkrUiStore(s => s.krs);
  const krsLoaded = usePersonalOkrUiStore(s => s.krsLoaded);
  const krsLoading = usePersonalOkrUiStore(s => s.krsLoading);
  const krsError = usePersonalOkrUiStore(s => s.krsError);
  const loadKrs = usePersonalOkrUiStore(s => s.loadKrs);
  const ensureKrDetailLoaded = usePersonalOkrUiStore(s => s.ensureKrDetailLoaded);
  const detailLoadingKrId = usePersonalOkrUiStore(s => s.detailLoadingKrId);
  const monthsByKr = usePersonalOkrUiStore(s => s.monthsByKr);
  const weeksByKr = usePersonalOkrUiStore(s => s.weeksByKr);
  const memosByKr = usePersonalOkrUiStore(s => s.memosByKr);
  const weekTasksByWeek = usePersonalOkrUiStore(s => s.weekTasksByWeek);
  const ensureWeekTasksLoaded = usePersonalOkrUiStore(s => s.ensureWeekTasksLoaded);
  const saveKr = usePersonalOkrUiStore(s => s.saveKr);
  const deleteKr = usePersonalOkrUiStore(s => s.deleteKr);
  const saveMonth = usePersonalOkrUiStore(s => s.saveMonth);
  const saveWeek = usePersonalOkrUiStore(s => s.saveWeek);
  const saveMemo = usePersonalOkrUiStore(s => s.saveMemo);
  const linkWeekTask = usePersonalOkrUiStore(s => s.linkWeekTask);
  const unlinkWeekTask = usePersonalOkrUiStore(s => s.unlinkWeekTask);

  useEffect(() => { if (!krsLoaded) loadKrs(); }, [krsLoaded, loadKrs]);

  const [fiscalYear, setFiscalYear] = useState(() => new Date().getFullYear());
  const [quarter, setQuarter] = useState<Quarter>(() => currentQuarter());

  const activeKrs = useMemo(
    () => krs
      .filter(k => !k.is_deleted && k.fiscal_year === fiscalYear && k.quarter === quarter)
      .sort((a, b) => a.display_order - b.display_order),
    [krs, fiscalYear, quarter],
  );

  const [selectedKrId, setSelectedKrId] = useState<string | null>(null);
  useEffect(() => {
    if (activeKrs.length === 0) { setSelectedKrId(null); return; }
    if (!activeKrs.some(k => k.id === selectedKrId)) setSelectedKrId(activeKrs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKrs]);

  useEffect(() => { if (selectedKrId) ensureKrDetailLoaded(selectedKrId); }, [selectedKrId, ensureKrDetailLoaded]);

  const [formModal, setFormModal] = useState<{ mode: "create" | "edit"; initial: PersonalKr | null } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const weightTotal = useMemo(() => sumWeightPct(activeKrs), [activeKrs]);
  const selectedKr = activeKrs.find(k => k.id === selectedKrId) ?? null;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", textAlign: "left",
    border: "1px solid transparent", borderBottom: "none",
    background: active ? "var(--color-bg-secondary)" : "transparent",
    borderColor: active ? "var(--color-border-primary)" : "transparent",
    padding: "10px 15px 9px", borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
    color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
    marginBottom: "-1px",
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "14px 20px 26px" }}>
      {/* 期の選択 */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>対象期</span>
        <input
          type="number"
          value={fiscalYear}
          onChange={e => setFiscalYear(Number(e.target.value) || fiscalYear)}
          style={{ width: "84px", fontSize: "12px", padding: "5px 8px", border: "1px solid var(--color-border-secondary)", borderRadius: "var(--radius-sm)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
        />
        <CustomSelect value={quarter} onChange={v => setQuarter(v as Quarter)} options={QUARTER_OPTIONS} style={{ width: "150px" }} />
        <span style={{ flex: 1 }} />
        {activeKrs.length > 0 && isWeightTotalWarning(weightTotal) && (
          <span style={{ fontSize: "11px", color: "var(--color-text-warning)" }}>
            ⚠ ウェイト合計 {weightTotal}%（100%ではありません。Kintoneが正本のため警告のみです）
          </span>
        )}
      </div>

      {/* KRタブ */}
      <div style={{ display: "flex", gap: "2px", overflowX: "auto", borderBottom: "1px solid var(--color-border-primary)" }}>
        {activeKrs.map(kr => (
          <button key={kr.id} onClick={() => setSelectedKrId(kr.id)} style={tabStyle(kr.id === selectedKrId)}>
            <span style={{ display: "block", fontSize: "12.5px", fontWeight: 700 }}>{kr.label}</span>
            <span style={{ display: "block", fontSize: "10px", marginTop: "1px" }}>{kr.weight_pct}%</span>
          </button>
        ))}
        <button
          onClick={() => setFormModal({ mode: "create", initial: null })}
          style={{ fontFamily: "inherit", cursor: "pointer", fontSize: "12px", padding: "10px 14px", background: "transparent", border: "none", color: "var(--color-brand)", alignSelf: "center" }}
        >＋ KRを追加</button>
        <button
          onClick={() => setImportModalOpen(true)}
          style={{ fontFamily: "inherit", cursor: "pointer", fontSize: "12px", padding: "10px 14px", background: "transparent", border: "none", color: "var(--color-text-secondary)", alignSelf: "center", whiteSpace: "nowrap" }}
        >📥 Kintoneから取込</button>
      </div>

      {krsLoading && !krsLoaded && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>
      )}

      {selectedKr ? (
        <PersonalKrPanel
          key={selectedKr.id}
          kr={selectedKr}
          currentUser={currentUser}
          months={monthsByKr[selectedKr.id] ?? []}
          weeks={weeksByKr[selectedKr.id] ?? []}
          memos={memosByKr[selectedKr.id] ?? []}
          loadingDetail={detailLoadingKrId === selectedKr.id}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          tasks={tasks}
          todos={todos}
          taskDependencies={taskDependencies}
          weekTasksByWeek={weekTasksByWeek}
          ensureWeekTasksLoaded={ensureWeekTasksLoaded}
          onSaveMonth={saveMonth}
          onSaveWeek={saveWeek}
          onSaveMemo={saveMemo}
          onLinkWeekTask={linkWeekTask}
          onUnlinkWeekTask={unlinkWeekTask}
          onEditKr={() => setFormModal({ mode: "edit", initial: selectedKr })}
        />
      ) : (
        !krsLoading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderTop: "none", borderRadius: "0 0 var(--radius-md) var(--radius-md)" }}>
            {fiscalYear}年{quarter}の個人KRがまだありません。「＋ KRを追加」から登録してください。
          </div>
        )
      )}

      {krsError && <div style={{ color: "var(--color-text-danger)", fontSize: "12px", marginTop: "10px" }}>{krsError}</div>}

      {formModal && (
        <PersonalKrFormModal
          mode={formModal.mode}
          initial={formModal.initial}
          existingKrsInPeriod={activeKrs}
          currentUserId={currentUser.id}
          currentGroupId={currentGroupId}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          defaultFiscalYear={fiscalYear}
          defaultQuarter={quarter}
          onSave={async kr => { await saveKr(kr); setSelectedKrId(kr.id); }}
          onDelete={
            formModal.mode === "edit" && formModal.initial
              ? async () => { await deleteKr(formModal.initial!.id, currentUser.id); setSelectedKrId(null); }
              : undefined
          }
          onClose={() => setFormModal(null)}
        />
      )}

      {importModalOpen && (
        <PersonalOkrImportModal
          currentUser={currentUser}
          currentGroupId={currentGroupId}
          allPersonalKrs={krs}
          monthsByKr={monthsByKr}
          ensureKrDetailLoaded={ensureKrDetailLoaded}
          saveKr={saveKr}
          saveMonth={saveMonth}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          defaultFiscalYear={fiscalYear}
          defaultQuarter={quarter}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </div>
  );
}
