// src/components/okr/KrMeetingNotePanel.tsx
//
// 【設計意図】
// OKR循環ワークフローの ① 会議ノート。OneNote の運用に合わせ、ノートは KR×週で1件。
// その中で TF ごとにセクション（TF説明・必達定義・評価観点・①先週動かした仮説／②起きたこと／
// ③次の一手／④現在の状態(%)＋理由・TODO）を順に入力し、最後まで入れたら「ノートを作成」する。
// 前週の同じKRのノートから「下書き」として引き継いで次週分を作成できる。
// 詳細設計：docs/okr-cycle-design.md（Phase A）

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Quarter } from "../../lib/localData/types";
import { formatMD } from "../../lib/date";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  fetchKrMeetingNote, fetchKrMeetingNotesList, fetchKrMeetingNoteById,
  saveKrMeetingNote, carriedEntriesFrom, emptyEntryFields,
  type KrMeetingNote, type KrNoteEntryFields, type KrNoteStatus,
} from "../../lib/supabase/krMeetingNoteStore";

function thisMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

const QUARTERS: Quarter[] = ["1Q", "2Q", "3Q", "4Q"];
function currentQuarter(): Quarter {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return "1Q";
  if (m <= 6) return "2Q";
  if (m <= 9) return "3Q";
  return "4Q";
}

interface Props {
  inline?: boolean;
  onClose: () => void;
  currentUser: Member;
  initialKrId?: string;
}

export function KrMeetingNotePanel({ onClose, currentUser, initialKrId }: Props) {
  const rawKrs   = useAppStore(s => s.keyResults);
  const rawTfs   = useAppStore(s => s.taskForces);
  const rawTasks = useAppStore(s => s.tasks);
  const rawTodos = useAppStore(s => s.todos);
  const objective = useAppStore(s => s.objective);
  const rawQObjs  = useAppStore(s => s.quarterlyObjectives);
  const rawQktf   = useAppStore(s => s.quarterlyKrTaskForces);

  const krs = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);

  const [krId, setKrId] = useState<string>(initialKrId && krs.some(k => k.id === initialKrId) ? initialKrId : (krs[0]?.id ?? ""));
  useEffect(() => { if (!krId && krs[0]) setKrId(krs[0].id); }, [krs, krId]);

  // クォーター（既定＝今のクォーター）。OKRは「KR通期固定・TF割り当てはクォーターごと」なので、
  // 表示するTFは「選択クォーターのQuarterlyObjectiveに紐づくTF割り当て」に絞る。
  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());

  const qObj = useMemo(
    () => objective ? (rawQObjs.find(q => !q.is_deleted && q.objective_id === objective.id && q.quarter === quarter) ?? null) : null,
    [rawQObjs, objective, quarter],
  );

  // 選択KR×クォーターのTF（id重複除去・tf_number昇順）。クォーター割り当てが無い場合は kr_id で絞る（従来動作）。
  const usingQuarterAssignment = !!qObj;
  const tfs = useMemo(() => {
    if (!krId) return [];
    const allActive = rawTfs.filter(tf => !tf.is_deleted);
    let pool;
    if (qObj) {
      const ids = new Set(rawQktf.filter(q => q.quarterly_objective_id === qObj.id && q.kr_id === krId).map(q => q.tf_id));
      pool = allActive.filter(tf => ids.has(tf.id));
    } else {
      pool = allActive.filter(tf => tf.kr_id === krId);
    }
    const byId = new Map(pool.map(tf => [tf.id, tf]));
    return [...byId.values()].sort((a, b) => (Number(a.tf_number) || 999) - (Number(b.tf_number) || 999));
  }, [rawTfs, rawQktf, qObj, krId]);

  const [weekStart, setWeekStart] = useState<string>(thisMondayStr());
  const [notesList, setNotesList] = useState<KrMeetingNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [note, setNote] = useState<KrMeetingNote | null>(null);
  const [entriesByTf, setEntriesByTf] = useState<Record<string, KrNoteEntryFields>>({});
  const [status, setStatus] = useState<KrNoteStatus>("draft");
  const [carriedFromId, setCarriedFromId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [tfIndex, setTfIndex] = useState(0);
  useEffect(() => { setTfIndex(0); }, [krId, weekStart, quarter]);

  // KR/週変更時：ノート一覧 + 当該週ノートを取得
  useEffect(() => {
    if (!krId) { setNotesList([]); setNote(null); setEntriesByTf({}); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchKrMeetingNotesList(krId), fetchKrMeetingNote(krId, weekStart)])
      .then(([list, full]) => {
        if (cancelled) return;
        setNotesList(list);
        if (full) {
          setNote(full);
          const m: Record<string, KrNoteEntryFields> = {};
          for (const e of full.entries) {
            m[e.tf_id] = {
              tf_theme: e.tf_theme, target_definition: e.target_definition, eval_criteria: e.eval_criteria,
              hypotheses: e.hypotheses, facts: e.facts, next_actions: e.next_actions,
              progress_pct: e.progress_pct, progress_reason: e.progress_reason, todo: e.todo,
            };
          }
          setEntriesByTf(m);
          setStatus(full.status);
          setCarriedFromId(full.carried_from_note_id);
        } else {
          setNote(null);
          setEntriesByTf({});
          setStatus("draft");
          setCarriedFromId(null);
        }
        setDirty(false);
        setSaveError(null);
        setSavedFlash(false);
      })
      .catch((e: unknown) => { if (!cancelled) { setLoadError(formatErrorForUser("会議ノートの取得に失敗しました", e)); setNotesList([]); setNote(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [krId, weekStart]);

  const weekOptions = useMemo(() => {
    const set = new Set<string>([thisMondayStr(), ...notesList.map(n => n.week_start)]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [notesList]);

  const prevNoteRow = useMemo(() => notesList.find(n => n.week_start < weekStart) ?? null, [notesList, weekStart]);

  const entryOf = useCallback((tfId: string): KrNoteEntryFields => entriesByTf[tfId] ?? emptyEntryFields(), [entriesByTf]);

  const patchEntry = useCallback((tfId: string, p: Partial<KrNoteEntryFields>) => {
    setEntriesByTf(prev => ({ ...prev, [tfId]: { ...(prev[tfId] ?? emptyEntryFields()), ...p } }));
    setDirty(true);
    setSavedFlash(false);
  }, []);

  const applyCarryOver = useCallback(async () => {
    if (!prevNoteRow) return;
    setLoading(true);
    try {
      const prevFull = await fetchKrMeetingNoteById(prevNoteRow.id);
      if (!prevFull) return;
      const carried = carriedEntriesFrom(prevFull);
      const m: Record<string, KrNoteEntryFields> = {};
      for (const tf of tfs) m[tf.id] = carried.get(tf.id) ?? emptyEntryFields();
      setEntriesByTf(m);
      setCarriedFromId(prevNoteRow.id);
      setDirty(true);
      setSavedFlash(false);
    } catch (e) {
      setSaveError(formatErrorForUser("前週ノートの引き継ぎに失敗しました", e));
    } finally {
      setLoading(false);
    }
  }, [prevNoteRow, tfs]);

  const handleSave = useCallback(async () => {
    if (!krId || tfs.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveKrMeetingNote({
        krId, weekStart, status,
        carriedFromNoteId: carriedFromId,
        entries: tfs.map(tf => ({ tf_id: tf.id, ...entryOf(tf.id) })),
      }, currentUser.id);
      setNote(saved);
      const m: Record<string, KrNoteEntryFields> = {};
      for (const e of saved.entries) {
        m[e.tf_id] = {
          tf_theme: e.tf_theme, target_definition: e.target_definition, eval_criteria: e.eval_criteria,
          hypotheses: e.hypotheses, facts: e.facts, next_actions: e.next_actions,
          progress_pct: e.progress_pct, progress_reason: e.progress_reason, todo: e.todo,
        };
      }
      setEntriesByTf(m);
      setNotesList(prev => {
        const others = prev.filter(n => n.id !== saved.id && n.week_start !== saved.week_start);
        return [{ ...saved }, ...others].sort((a, b) => b.week_start.localeCompare(a.week_start));
      });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [krId, weekStart, status, carriedFromId, tfs, entryOf, currentUser.id]);

  const hasContent = useCallback((tfId: string): boolean => {
    const e = entriesByTf[tfId];
    if (!e) return false;
    return !!(e.tf_theme || e.target_definition || e.eval_criteria || e.hypotheses || e.facts || e.next_actions || e.progress_reason || e.todo || e.progress_pct != null);
  }, [entriesByTf]);

  const currentTf = tfs[tfIndex] ?? null;
  const isLastTf = tfIndex === tfs.length - 1;
  const krTitle = krs.find(k => k.id === krId)?.title ?? "";

  // 現在TF配下のToDo/タスク件数（記入の参考）
  const tfWork = useMemo(() => {
    if (!currentTf) return null;
    const tfTodos = rawTodos.filter(td => !td.is_deleted && td.tf_id === currentTf.id);
    const todoIds = new Set(tfTodos.map(td => td.id));
    const tfTasks = rawTasks.filter(t => !t.is_deleted && (t.todo_ids ?? []).some(id => todoIds.has(id)));
    return { todoCount: tfTodos.length, taskCount: tfTasks.length, taskDone: tfTasks.filter(t => t.status === "done").length };
  }, [currentTf, rawTodos, rawTasks]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>

      {/* セレクタ行：KR → クォーター → 週 */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 280px" }}>
          <Label>Key Result（まず選択）</Label>
          <select value={krId} onChange={e => setKrId(e.target.value)} style={selStyle}>
            {krs.length === 0 && <option value="">（KRがありません）</option>}
            {krs.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
          </select>
        </div>
        <div style={{ flex: "0 1 110px" }}>
          <Label>クォーター</Label>
          <select value={quarter} onChange={e => setQuarter(e.target.value as Quarter)} style={selStyle}>
            {QUARTERS.map(q => <option key={q} value={q}>{q}{q === currentQuarter() ? "（今）" : ""}</option>)}
          </select>
        </div>
        <div style={{ flex: "0 1 180px" }}>
          <Label>対象週（月曜起点）</Label>
          <select value={weekStart} onChange={e => setWeekStart(e.target.value)} style={selStyle}>
            {weekOptions.map(w => (
              <option key={w} value={w}>{formatMD(w)} 週{w === thisMondayStr() ? "（今週）" : ""}{notesList.some(n => n.week_start === w) ? "" : "（新規）"}</option>
            ))}
          </select>
        </div>
        <button onClick={onClose} style={{ ...ghostBtn, marginLeft: "auto" }}>閉じる</button>
      </div>

      {loadError && <ErrBox>{loadError}</ErrBox>}
      {loading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>}

      {krId && !loading && !usingQuarterAssignment && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "7px 10px" }}>
          ※ {quarter} の TF 割り当て（QuarterlyObjective）が未設定のため、このKRに紐づく全TFを表示しています。管理画面でクォーターのTF割り当てを設定すると、このクォーターのTFだけが表示されます。
        </div>
      )}

      {!krId && !loading && (
        <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>
          Key Result が登録されていません。管理画面から登録してください。
        </div>
      )}

      {krId && !loading && tfs.length === 0 && (
        <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>
          「{krTitle}」に紐づくタスクフォースがありません。管理画面でTFを追加すると、ここで会議ノートを書けます。
        </div>
      )}

      {krId && !loading && tfs.length > 0 && (
        <>
          {/* ステータス / 引き継ぎ */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "4px" }}>
              {(["draft", "ready"] as const).map(s => (
                <button key={s} onClick={() => { setStatus(s); setDirty(true); }} style={{
                  fontSize: "11px", padding: "4px 12px", borderRadius: "var(--radius-full)",
                  border: status === s ? "1px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                  background: status === s ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                  color: status === s ? "var(--color-brand)" : "var(--color-text-secondary)",
                  cursor: "pointer", fontWeight: status === s ? 600 : 400,
                }}>
                  {s === "draft" ? "下書き" : "チェックインに出せる（ready）"}
                </button>
              ))}
            </div>
            {!note && prevNoteRow && (
              <button onClick={applyCarryOver} style={{ ...primaryBtn, fontSize: "11px", padding: "5px 12px" }}>
                ↩ 前週（{formatMD(prevNoteRow.week_start)} 週）から引き継いで作成
              </button>
            )}
            {carriedFromId && notesList.find(n => n.id === carriedFromId) && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                {formatMD(notesList.find(n => n.id === carriedFromId)!.week_start)} 週から引き継ぎ
              </span>
            )}
            {note && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                最終更新 {new Date(note.updated_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {/* TFステップ・ストリップ */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {tfs.map((tf, i) => (
              <button key={tf.id} onClick={() => setTfIndex(i)} style={{
                fontSize: "11px", padding: "5px 11px", borderRadius: "var(--radius-md)",
                border: i === tfIndex ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                background: i === tfIndex ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                color: i === tfIndex ? "var(--color-brand)" : "var(--color-text-secondary)",
                cursor: "pointer", fontWeight: i === tfIndex ? 600 : 400,
              }}>
                {hasContent(tf.id) ? "✓ " : ""}TF{tf.tf_number} {tf.name}
              </button>
            ))}
          </div>

          {/* 現在TFのフォーム */}
          {currentTf && (
            <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>TF{currentTf.tf_number} {currentTf.name}</span>
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                  （{tfIndex + 1} / {tfs.length}）{tfWork && <> ・配下：ToDo {tfWork.todoCount}件・タスク {tfWork.taskDone}/{tfWork.taskCount}件完了</>}
                </span>
              </div>

              <Field label="TFの説明・その期のテーマ（OneNoteの「★1Q＝…」相当）">
                <TextArea value={entryOf(currentTf.id).tf_theme} onChange={v => patchEntry(currentTf.id, { tf_theme: v })} rows={3} placeholder="例：★1Q＝“なぜこの商品をアミタがやるのか”を説明できる状態をつくる四半期" />
              </Field>
              <Field label="必達の定義（この月に到達したい状態）">
                <TextArea value={entryOf(currentTf.id).target_definition} onChange={v => patchEntry(currentTf.id, { target_definition: v })} rows={5} placeholder="例：・4月の商品開発会議で積み残された「…」が整理され…" />
              </Field>
              <Field label="評価観点（何をもって達成と見るか）">
                <TextArea value={entryOf(currentTf.id).eval_criteria} onChange={v => patchEntry(currentTf.id, { eval_criteria: v })} rows={3} />
              </Field>

              <div style={{ borderTop: "1px solid var(--color-border-primary)", paddingTop: "8px", fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)" }}>チェックイン向け（毎週更新）</div>
              <Field label="① 先週動かした前提・仮説">
                <TextArea value={entryOf(currentTf.id).hypotheses} onChange={v => patchEntry(currentTf.id, { hypotheses: v })} rows={5} />
              </Field>
              <Field label="② 実際に起きたこと（事実・反応）　※評価・解釈は書かない">
                <TextArea value={entryOf(currentTf.id).facts} onChange={v => patchEntry(currentTf.id, { facts: v })} rows={6} />
              </Field>
              <Field label="③ 次にやる一手（判断）">
                <TextArea value={entryOf(currentTf.id).next_actions} onChange={v => patchEntry(currentTf.id, { next_actions: v })} rows={5} />
              </Field>
              <Field label="④ 現在のプロセス状態">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <input type="number" min={0} max={100}
                    value={entryOf(currentTf.id).progress_pct ?? ""}
                    onChange={e => patchEntry(currentTf.id, { progress_pct: e.target.value === "" ? null : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                    placeholder="—"
                    style={{ width: "70px", padding: "6px 8px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }} />
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>%</span>
                </div>
                <TextArea value={entryOf(currentTf.id).progress_reason} onChange={v => patchEntry(currentTf.id, { progress_reason: v })} rows={4} placeholder="その%と判断した理由（達成できている点／まだの点）" />
              </Field>
              <Field label="▶ TODO（その時期のToDo）">
                <TextArea value={entryOf(currentTf.id).todo} onChange={v => patchEntry(currentTf.id, { todo: v })} rows={5} />
              </Field>

              {/* TFナビ */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingTop: "4px" }}>
                <button onClick={() => setTfIndex(i => Math.max(0, i - 1))} disabled={tfIndex === 0} style={{ ...ghostBtn, opacity: tfIndex === 0 ? 0.4 : 1, cursor: tfIndex === 0 ? "default" : "pointer" }}>← 前のTF</button>
                <div style={{ flex: 1 }} />
                {!isLastTf ? (
                  <button onClick={() => setTfIndex(i => Math.min(tfs.length - 1, i + 1))} style={primaryBtn}>次のTF（{tfIndex + 2}/{tfs.length}）→</button>
                ) : (
                  <button onClick={handleSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }}>{saving ? "保存中…" : note ? "このKRノートを保存" : "このKRノートを作成"}</button>
                )}
              </div>
            </div>
          )}

          {saveError && <ErrBox>{saveError}</ErrBox>}

          {/* 常時表示の保存バー */}
          <div style={{ position: "sticky", bottom: 0, background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border-primary)", padding: "10px 0", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: savedFlash ? "var(--color-text-success)" : "var(--color-text-tertiary)", flex: 1 }}>
              {savedFlash ? "✓ 保存しました" : dirty ? "未保存の変更があります" : note ? `保存済み（「${krTitle}」${formatMD(weekStart)}週）` : "このノートはまだ保存されていません"}
            </span>
            <button onClick={handleSave} disabled={saving || (!dirty && !!note)} style={{ ...primaryBtn, opacity: (saving || (!dirty && !!note)) ? 0.5 : 1, cursor: (saving || (!dirty && !!note)) ? "default" : "pointer" }}>
              {saving ? "保存中…" : note ? "保存" : "このKRノートを作成"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ===== 部品 =====

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>;
}
function TextArea({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows: number; placeholder?: string }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box", fontFamily: "inherit" }} />
  );
}
function ErrBox({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>{children}</div>;
}

const selStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 18px", fontSize: "12px", fontWeight: 600,
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff",
  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  fontSize: "11px", padding: "5px 12px", background: "transparent",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)", cursor: "pointer",
};
