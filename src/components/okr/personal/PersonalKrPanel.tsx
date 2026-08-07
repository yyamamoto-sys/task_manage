// src/components/okr/personal/PersonalKrPanel.tsx
//
// 【設計意図】
// 個人OKRビュー・選択中の個人KR1本の中身。上から
// 「月の切替バー → このKRの内容（折りたたみ） → 今月の計画 → ★週の目標状態 → メモ」の順
// （docs/dev/okr-redesign-plan.md §7）。Phase 3の「これから」「AIパネル」・Phase 4の
// 「月末にやること（下書き生成ボタン）」はここでは作らない（未実装の空ボタンを出さない）。
//
// 週は computeMonthWeekSegments が返すセグメント数をそのまま使う（5列固定にしない。
// CLAUDE.md Section 24）。空の週レコードは事前に一括作成せず、goal_state/self_ratingを
// 書いた時点で初めて行を作る（ensureWeek）。

import { useEffect, useMemo, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  KeyResult, Member, Objective, PersonalKr, PersonalKrBand, PersonalKrMemo, PersonalKrMonth,
  PersonalKrWeek, PersonalKrWeekTask, Task, TaskDependency, TaskForce, ToDo, WeekSelfRating,
} from "../../../lib/localData/types";
import { quarterMonthSlots, monthToDateStr, classifyMonth } from "../../../lib/personalOkr/quarterMonths";
import { computeMonthWeekSegments } from "../../../lib/date/monthWeeks";
import { buildWeekCards } from "../../../lib/personalOkr/weekLayout";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { WeekCard } from "./WeekCard";
import { WeekTaskLinkModal } from "./WeekTaskLinkModal";

const KR_KIND_LABEL: Record<string, string> = {
  group_kr: "グループKR紐づけ", general: "全般", company_common: "全社共通",
  om_common: "OM共通", agm_common: "AGM共通", leader_common: "リーダー共通",
};

const sectionHeadStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "9px", margin: "20px 0 9px",
  fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
};
const ruleStyle: React.CSSProperties = { flex: 1, height: "1px", background: "var(--color-border-primary)" };
const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", padding: "14px 16px",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical",
  minHeight: "48px", boxSizing: "border-box",
};

interface LinkerTarget { weekIndex: number; weekStartStr: string; weekEndStr: string; week: PersonalKrWeek | null; label: string }

interface Props {
  kr: PersonalKr;
  currentUser: Member;
  months: PersonalKrMonth[];
  weeks: PersonalKrWeek[];
  memos: PersonalKrMemo[];
  loadingDetail: boolean;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  objectives: Objective[];
  tasks: Task[];
  todos: ToDo[];
  taskDependencies: TaskDependency[];
  weekTasksByWeek: Record<string, PersonalKrWeekTask[]>;
  ensureWeekTasksLoaded: (weekId: string) => Promise<void>;
  onSaveMonth: (month: PersonalKrMonth, expectedUpdatedAt?: string) => Promise<void>;
  onSaveWeek: (week: PersonalKrWeek, expectedUpdatedAt?: string) => Promise<void>;
  onSaveMemo: (memo: PersonalKrMemo, expectedUpdatedAt?: string) => Promise<void>;
  onLinkWeekTask: (weekId: string, taskId: string) => Promise<void>;
  onUnlinkWeekTask: (weekId: string, taskId: string) => Promise<void>;
  onEditKr: () => void;
}

export function PersonalKrPanel({
  kr, currentUser, months, weeks, memos, loadingDetail,
  keyResults, taskForces, objectives, tasks, todos, taskDependencies,
  weekTasksByWeek, ensureWeekTasksLoaded,
  onSaveMonth, onSaveWeek, onSaveMemo, onLinkWeekTask, onUnlinkWeekTask, onEditKr,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const slots = useMemo(() => quarterMonthSlots(kr.fiscal_year, kr.quarter), [kr.fiscal_year, kr.quarter]);
  const defaultMonthIndex = useMemo(() => {
    const cur = slots.find(s => classifyMonth(s.monthStart, today) === "current");
    return cur?.monthIndex ?? slots[0].monthIndex;
  }, [slots, today]);
  const [monthIndex, setMonthIndex] = useState<1 | 2 | 3>(defaultMonthIndex);
  useEffect(() => setMonthIndex(defaultMonthIndex), [kr.id, defaultMonthIndex]);

  const slot = slots.find(s => s.monthIndex === monthIndex) ?? slots[0];
  const monthStr = monthToDateStr(slot.monthStart);
  const monthStatus = classifyMonth(slot.monthStart, today);
  const monthEditable = monthStatus === "current";
  const monthRecord = months.find(m => m.month === monthStr && !m.is_deleted) ?? null;

  const groupKrTitle = useMemo(() => {
    if (kr.kr_kind !== "group_kr") return KR_KIND_LABEL[kr.kr_kind] ?? kr.kr_kind;
    const groupKr = keyResults.find(k => k.id === kr.key_result_id);
    const tf = taskForces.find(t => t.id === kr.task_force_id);
    if (!groupKr) return "グループKR紐づけ";
    return tf ? `${groupKr.title} / TF${tf.tf_number}` : groupKr.title;
  }, [kr.kr_kind, kr.key_result_id, kr.task_force_id, keyResults, taskForces]);
  // objectivesは将来（グループKRの所属Objective表示）に使う可能性があるが現状未使用
  void objectives;

  // ===== 今月の計画：ドラフト =====
  const [positioning, setPositioning] = useState("");
  const [activities, setActivities] = useState("");
  const [targetAndEvidence, setTargetAndEvidence] = useState("");
  const [risks, setRisks] = useState("");
  const [bandTarget, setBandTarget] = useState<PersonalKrBand | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  useEffect(() => {
    setPositioning(monthRecord?.positioning ?? "");
    setActivities(monthRecord?.activities ?? "");
    setTargetAndEvidence(monthRecord?.target_and_evidence ?? "");
    setRisks(monthRecord?.risks ?? "");
    setBandTarget(monthRecord?.band_target ?? null);
    setMonthError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthRecord?.id, monthStr]);

  const handleSaveMonthPlan = async () => {
    setSavingMonth(true);
    setMonthError(null);
    const now = new Date().toISOString();
    const month: PersonalKrMonth = {
      id: monthRecord?.id ?? uuidv4(),
      personal_kr_id: kr.id,
      month: monthStr,
      month_index: monthIndex,
      positioning: positioning || null,
      activities: activities || null,
      target_and_evidence: targetAndEvidence || null,
      risks: risks || null,
      band_target: bandTarget,
      is_deleted: false,
      created_at: monthRecord?.created_at ?? now,
      updated_by: currentUser.id,
    };
    try {
      await onSaveMonth(month, monthRecord?.updated_at);
    } catch (e) {
      setMonthError(formatErrorForUser("今月の計画の保存に失敗しました", e));
    } finally {
      setSavingMonth(false);
    }
  };

  // ===== 週の目標状態 =====
  const segments = useMemo(() => computeMonthWeekSegments(slot.monthStart), [slot.monthStart]);
  const weekCards = useMemo(() => buildWeekCards(segments, weeks.filter(w => w.month === monthStr && !w.is_deleted)), [segments, weeks, monthStr]);
  const currentWeekIndex = useMemo(() => {
    if (monthStatus !== "current") return null;
    const found = segments.find(s => today >= s.weekStart && today <= new Date(s.weekEnd.getFullYear(), s.weekEnd.getMonth(), s.weekEnd.getDate(), 23, 59, 59));
    return found?.weekIndex ?? null;
  }, [segments, monthStatus, today]);

  const ensureWeek = useCallback(async (weekIndex: number, weekStartStr: string, weekEndStr: string): Promise<PersonalKrWeek> => {
    const found = weeks.find(w => w.week_index === weekIndex && w.month === monthStr && !w.is_deleted);
    if (found) return found;
    const now = new Date().toISOString();
    const week: PersonalKrWeek = {
      id: uuidv4(), personal_kr_id: kr.id, month: monthStr, week_index: weekIndex,
      week_start: weekStartStr, week_end: weekEndStr, goal_state: null, self_rating: null,
      rated_at: null, note: null, is_deleted: false, created_at: now, updated_by: currentUser.id,
    };
    await onSaveWeek(week);
    return week;
  }, [weeks, monthStr, kr.id, currentUser.id, onSaveWeek]);

  const [linker, setLinker] = useState<LinkerTarget | null>(null);
  const [weekActionError, setWeekActionError] = useState<string | null>(null);

  const handleOpenLinker = async (card: { weekIndex: number; weekStartStr: string; weekEndStr: string; existing: PersonalKrWeek | null }, label: string) => {
    setWeekActionError(null);
    try {
      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
      await ensureWeekTasksLoaded(week.id);
      setLinker({ weekIndex: card.weekIndex, weekStartStr: card.weekStartStr, weekEndStr: card.weekEndStr, week, label });
    } catch (e) {
      setWeekActionError(formatErrorForUser("週の準備に失敗しました", e));
    }
  };

  return (
    <div style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderTop: "none", borderRadius: "0 0 var(--radius-md) var(--radius-md)", padding: "16px 20px 22px" }}>
      {/* 月の切替バー */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingBottom: "14px", borderBottom: "1px dotted var(--color-border-primary)" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>{kr.fiscal_year}年 {kr.quarter}</span>
        <div style={{ display: "flex", gap: "2px" }}>
          {slots.map(s => {
            const status = classifyMonth(s.monthStart, today);
            const active = s.monthIndex === monthIndex;
            return (
              <button
                key={s.monthIndex}
                onClick={() => setMonthIndex(s.monthIndex)}
                style={{
                  fontFamily: "inherit", fontSize: "11.5px", cursor: "pointer", padding: "5px 13px",
                  borderRadius: "var(--radius-full)",
                  border: `1px solid ${active ? "transparent" : status === "past" ? "var(--color-border-primary)" : "transparent"}`,
                  background: active ? "var(--color-brand)" : "transparent",
                  color: active ? "#fff" : status === "past" ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                  fontWeight: active ? 700 : 400,
                }}
              >{s.monthStart.getMonth() + 1}月</button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={onEditKr} style={{ fontFamily: "inherit", fontSize: "11px", cursor: "pointer", padding: "4px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)" }}>
          ✏️ このKRを編集
        </button>
      </div>

      {loadingDetail ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>
      ) : monthStatus === "future" ? (
        <div style={{ ...cardStyle, marginTop: "16px", color: "var(--color-text-tertiary)", fontSize: "12.5px" }}>
          {slot.monthStart.getMonth() + 1}月の計画がまだありません。Kintone側で月初に立てる計画（Phase 2以降で取込予定）を、現時点では手入力できません。月が来たらこのタブが編集可能になります。
        </div>
      ) : (
        <>
          {/* このKRの内容（折りたたみ・既定は閉じる） */}
          <details style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", marginTop: "16px" }}>
            <summary style={{ cursor: "pointer", listStyle: "none", padding: "10px 14px", fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              このKRの内容（{groupKrTitle}）
            </summary>
            <div style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "150px 1fr", gap: "9px 12px", fontSize: "12.5px" }}>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●対象業務カテゴリ</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.category || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●実施内容</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.activity || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●得意領域の強化：（役割）</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.strength_role || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●苦手領域の克服：（役割）</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.weakness_role || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●達成基準</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.criteria || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●補足</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.supplement || "（未記入）"}</div>
            </div>
          </details>

          {/* 今月の計画 */}
          <div style={{ marginTop: "20px" }}>
            <div style={sectionHeadStyle}><span>今月の計画</span><span style={ruleStyle} /><span>{monthStatus === "past" ? "確定済み・読み取り専用" : "手入力（Phase 2でKintone取込に置き換え予定）"}</span></div>
            {monthError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{monthError}</div>}
            <div style={cardStyle}>
              {(["positioning", "activities", "targetAndEvidence", "risks"] as const).map(field => {
                const label = field === "positioning" ? "位置づけ" : field === "activities" ? "当月に取り組む内容" : field === "targetAndEvidence" ? "当月末の達成目標と、その証拠" : "リスクと依存関係";
                const value = field === "positioning" ? positioning : field === "activities" ? activities : field === "targetAndEvidence" ? targetAndEvidence : risks;
                const setter = field === "positioning" ? setPositioning : field === "activities" ? setActivities : field === "targetAndEvidence" ? setTargetAndEvidence : setRisks;
                return (
                  <div key={field} style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{label}</div>
                    {monthEditable ? (
                      <textarea value={value} onChange={e => setter(e.target.value)} style={textareaStyle} />
                    ) : (
                      <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{value || "（記録なし）"}</div>
                    )}
                  </div>
                );
              })}
              <div>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>当月末 達成度バンド</div>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {BAND_VALUES.map(b => {
                    const disabled = isBandDisabled(b) || !monthEditable;
                    const on = bandTarget === b;
                    return (
                      <button
                        key={b}
                        onClick={() => monthEditable && !isBandDisabled(b) && setBandTarget(on ? null : b)}
                        disabled={disabled}
                        title={BAND_LABELS[b]}
                        style={{
                          fontFamily: "inherit", fontSize: "10.5px", padding: "3px 9px", borderRadius: "var(--radius-sm)",
                          border: `1px solid ${on ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                          background: on ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                          color: on ? "var(--color-brand)" : "var(--color-text-tertiary)",
                          fontWeight: on ? 700 : 400,
                          textDecoration: isBandDisabled(b) ? "line-through" : "none",
                          opacity: isBandDisabled(b) ? 0.45 : 1,
                          cursor: disabled ? "default" : "pointer",
                        }}
                      >{b} {BAND_LABELS[b]}</button>
                    );
                  })}
                </div>
              </div>
              {monthEditable && (
                <button onClick={handleSaveMonthPlan} disabled={savingMonth} style={{ marginTop: "12px", fontSize: "12px", fontWeight: 700, padding: "7px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
                  {savingMonth ? "保存中…" : "今月の計画を保存"}
                </button>
              )}
            </div>
          </div>

          {/* 週の目標状態 */}
          <div style={{ marginTop: "20px" }}>
            <div style={sectionHeadStyle}><span>週の目標状態</span><span style={ruleStyle} /><span>★アプリで設定（Kintoneに無い層）</span></div>
            {weekActionError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{weekActionError}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
              {weekCards.map(card => {
                const linkedIds = (weekTasksByWeek[card.existing?.id ?? ""] ?? []).map(l => l.task_id);
                const linkedTasks = linkedIds.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
                return (
                  <WeekCard
                    key={card.weekIndex}
                    label={`W${card.weekIndex}`}
                    weekStartStr={card.weekStartStr}
                    weekEndStr={card.weekEndStr}
                    goalState={card.existing?.goal_state ?? null}
                    selfRating={card.existing?.self_rating ?? null}
                    editable={monthEditable}
                    isCurrentWeek={currentWeekIndex === card.weekIndex}
                    linkedTasks={linkedTasks}
                    allTasks={tasks}
                    taskDependencies={taskDependencies}
                    onSaveGoal={async text => {
                      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
                      await onSaveWeek({ ...week, goal_state: text || null }, week.updated_at);
                    }}
                    onSetRating={async (rating: WeekSelfRating) => {
                      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
                      const now = new Date().toISOString();
                      await onSaveWeek({ ...week, self_rating: rating, rated_at: rating ? now : null }, week.updated_at);
                    }}
                    onOpenLinker={() => handleOpenLinker(card, `W${card.weekIndex}`)}
                  />
                );
              })}
            </div>
            <p style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              ◯達成／△一部／✕未達を自分で付けます。評価すると週の色が変わります。もう一度押すと未評価に戻せます。
            </p>
          </div>
        </>
      )}

      {/* メモ（KR単位・追記型。月に関係なく常時表示） */}
      <MemoSection kr={kr} currentUser={currentUser} memos={memos} onSaveMemo={onSaveMemo} />

      {linker && (
        <WeekTaskLinkModal
          weekLabel={linker.label}
          weekStart={linker.weekStartStr}
          weekEnd={linker.weekEndStr}
          tasks={tasks}
          todos={todos}
          currentMemberId={currentUser.id}
          taskForceId={kr.task_force_id}
          linkedTaskIds={(weekTasksByWeek[linker.week?.id ?? ""] ?? []).map(l => l.task_id)}
          onLink={async taskId => { if (linker.week) await onLinkWeekTask(linker.week.id, taskId); }}
          onUnlink={async taskId => { if (linker.week) await onUnlinkWeekTask(linker.week.id, taskId); }}
          onClose={() => setLinker(null)}
        />
      )}
    </div>
  );
}

function MemoSection({ kr, currentUser, memos, onSaveMemo }: {
  kr: PersonalKr; currentUser: Member; memos: PersonalKrMemo[];
  onSaveMemo: (memo: PersonalKrMemo, expectedUpdatedAt?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      await onSaveMemo({
        id: uuidv4(), personal_kr_id: kr.id, member_id: currentUser.id, body: draft.trim(),
        is_deleted: false, created_at: now, updated_by: currentUser.id,
      });
      setDraft("");
    } catch (e) {
      setError(formatErrorForUser("メモの保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={sectionHeadStyle}><span>メモ</span><span style={ruleStyle} /><span>このKR専用・自分だけが見えます</span></div>
      {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{error}</div>}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="気づいたこと、迷っていること、次に確かめたいこと。Kintoneに書く前の下書きにも使えます。"
        style={{ ...textareaStyle, minHeight: "72px" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "7px" }}>
        <button onClick={handleAdd} disabled={saving || !draft.trim()} style={{ fontSize: "12px", fontWeight: 700, padding: "6px 14px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
          {saving ? "保存中…" : "追加"}
        </button>
      </div>
      {memos.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "1px" }}>
          {memos.map(m => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: "12px", padding: "9px 12px", background: "var(--color-bg-primary)", borderRadius: "var(--radius-sm)", fontSize: "12px" }}>
              <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>{(m.created_at ?? "").slice(0, 10)}</span>
              <span style={{ color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>{m.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
