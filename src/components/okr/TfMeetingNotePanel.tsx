// src/components/okr/TfMeetingNotePanel.tsx
//
// 【設計意図】
// OKR循環ワークフローの ① TF会議ノート。チェックイン前のTF会議で更新している OneNote の内容
// （必達定義・評価観点・先週動かした仮説／起きたこと／次の一手／現在のプロセス状態(%)／ToDo・タスク状況）を
// アプリのフォームとして編集・保存する。TF × 週（月曜起点）で1レコード。
// 前週のノートから内容を「下書き」として引き継いで今週分を作成できる。
// 詳細設計：docs/okr-cycle-design.md（Phase A）

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatMD } from "../../lib/date";
import { formatErrorForUser } from "../../lib/errorMessage";
import {
  fetchTfMeetingNotes, insertTfMeetingNote, updateTfMeetingNote,
  carriedFieldsFrom, emptyTfNoteFields,
  type TfMeetingNote, type TfNoteFields,
} from "../../lib/supabase/tfMeetingNoteStore";

function thisMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

interface Props {
  inline?: boolean;
  onClose: () => void;
  currentUser: Member;
  /** OKRモードで選択中のKR。そのKRに紐づくTFを初期選択する */
  initialKrId?: string;
}

export function TfMeetingNotePanel({ onClose, currentUser, initialKrId }: Props) {
  const rawTfs   = useAppStore(s => s.taskForces);
  const rawKrs   = useAppStore(s => s.keyResults);
  const rawTasks = useAppStore(s => s.tasks);
  const rawTodos = useAppStore(s => s.todos);

  const tfs = useMemo(
    () => rawTfs.filter(tf => !tf.is_deleted)
      .sort((a, b) => (Number(a.tf_number) || 999) - (Number(b.tf_number) || 999)),
    [rawTfs],
  );
  const krById = useMemo(() => new Map(rawKrs.map(k => [k.id, k])), [rawKrs]);

  // 初期TF：選択中KRに紐づくTFの先頭、なければ全TFの先頭
  const initialTfId = useMemo(() => {
    if (initialKrId) {
      const t = tfs.find(tf => tf.kr_id === initialKrId);
      if (t) return t.id;
    }
    return tfs[0]?.id ?? "";
  }, [tfs, initialKrId]);

  const [tfId, setTfId] = useState<string>(initialTfId);
  useEffect(() => { if (!tfId && initialTfId) setTfId(initialTfId); }, [initialTfId, tfId]);

  const [weekStart, setWeekStart] = useState<string>(thisMondayStr());
  const [notesForTf, setNotesForTf] = useState<TfMeetingNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [note, setNote] = useState<TfMeetingNote | null>(null);
  const [form, setForm] = useState<TfNoteFields>(emptyTfNoteFields());
  const [carriedFromId, setCarriedFromId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const selectedTf = tfs.find(t => t.id === tfId) ?? null;

  // TF変更：ノート一覧を取り直す
  const loadNotes = useCallback((id: string) => {
    if (!id) { setNotesForTf([]); return; }
    setLoading(true);
    setLoadError(null);
    fetchTfMeetingNotes(id)
      .then(rows => setNotesForTf(rows))
      .catch((e: unknown) => { setLoadError(formatErrorForUser("TF会議ノートの取得に失敗しました", e)); setNotesForTf([]); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadNotes(tfId); }, [tfId, loadNotes]);

  // 週リスト：今週 + ノートのある週
  const weekOptions = useMemo(() => {
    const set = new Set<string>([thisMondayStr(), ...notesForTf.map(n => n.week_start)]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [notesForTf]);

  // 前週ノート（引き継ぎ元候補）
  const prevNote = useMemo(
    () => notesForTf.find(n => n.week_start < weekStart) ?? null,
    [notesForTf, weekStart],
  );

  // (tf, week, notes) からフォームを初期化
  useEffect(() => {
    const existing = notesForTf.find(n => n.week_start === weekStart) ?? null;
    setNote(existing);
    if (existing) {
      setForm({
        target_definition: existing.target_definition,
        eval_criteria: existing.eval_criteria,
        hypotheses: existing.hypotheses,
        facts: existing.facts,
        next_actions: existing.next_actions,
        progress_pct: existing.progress_pct,
        progress_reason: existing.progress_reason,
        todo_status: existing.todo_status,
        status: existing.status,
      });
      setCarriedFromId(existing.carried_from_note_id);
    } else {
      setForm(emptyTfNoteFields());
      setCarriedFromId(null);
    }
    setDirty(false);
    setSaveError(null);
    setSavedFlash(false);
  }, [notesForTf, weekStart]);

  const patch = useCallback((p: Partial<TfNoteFields>) => {
    setForm(f => ({ ...f, ...p }));
    setDirty(true);
    setSavedFlash(false);
  }, []);

  const applyCarryOver = useCallback(() => {
    if (!prevNote) return;
    setForm(carriedFieldsFrom(prevNote));
    setCarriedFromId(prevNote.id);
    setDirty(true);
    setSavedFlash(false);
  }, [prevNote]);

  const handleSave = useCallback(async () => {
    if (!tfId) return;
    setSaving(true);
    setSaveError(null);
    try {
      let saved: TfMeetingNote;
      if (note) {
        saved = await updateTfMeetingNote(note.id, form, currentUser.id);
      } else {
        saved = await insertTfMeetingNote(tfId, weekStart, form, currentUser.id, carriedFromId);
      }
      // ローカル一覧を更新
      setNotesForTf(prev => {
        const others = prev.filter(n => n.id !== saved.id && n.week_start !== saved.week_start);
        return [saved, ...others].sort((a, b) => b.week_start.localeCompare(a.week_start));
      });
      setNote(saved);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [tfId, note, form, weekStart, carriedFromId, currentUser.id]);

  // TF配下のToDo/タスクの簡易サマリ（記入の参考用）
  const tfWork = useMemo(() => {
    if (!tfId) return null;
    const tfTodos = rawTodos.filter(td => !td.is_deleted && td.tf_id === tfId);
    const todoIds = new Set(tfTodos.map(td => td.id));
    const tfTasks = rawTasks.filter(t => !t.is_deleted && (t.todo_ids ?? []).some(id => todoIds.has(id)));
    const done = tfTasks.filter(t => t.status === "done").length;
    return { todoCount: tfTodos.length, taskCount: tfTasks.length, taskDone: done };
  }, [tfId, rawTodos, rawTasks]);

  const isThisWeek = weekStart === thisMondayStr();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>

      {/* セレクタ行 */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 280px" }}>
          <Label>タスクフォース</Label>
          <select value={tfId} onChange={e => setTfId(e.target.value)} style={selStyle}>
            {tfs.length === 0 && <option value="">（TFがありません）</option>}
            {tfs.map(tf => {
              const kr = krById.get(tf.kr_id);
              return <option key={tf.id} value={tf.id}>TF{tf.tf_number} {tf.name}{kr ? `（${kr.title.slice(0, 14)}）` : ""}</option>;
            })}
          </select>
        </div>
        <div style={{ flex: "0 1 180px" }}>
          <Label>対象週（月曜起点）</Label>
          <select value={weekStart} onChange={e => setWeekStart(e.target.value)} style={selStyle}>
            {weekOptions.map(w => (
              <option key={w} value={w}>{formatMD(w)} 週{w === thisMondayStr() ? "（今週）" : ""}{notesForTf.some(n => n.week_start === w) ? "" : "（新規）"}</option>
            ))}
          </select>
        </div>
        <button onClick={onClose} style={{ ...ghostBtn, marginLeft: "auto" }}>閉じる</button>
      </div>

      {loadError && <ErrBox>{loadError}</ErrBox>}
      {loading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>}

      {!tfId && !loading && (
        <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>
          タスクフォースが登録されていません。管理画面から登録してください。
        </div>
      )}

      {tfId && !loading && (
        <>
          {/* ステータス / 引き継ぎ */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "4px" }}>
              {(["draft", "ready"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => patch({ status: s })}
                  style={{
                    fontSize: "11px", padding: "4px 12px", borderRadius: "var(--radius-full)",
                    border: form.status === s ? "1px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                    background: form.status === s ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                    color: form.status === s ? "var(--color-brand)" : "var(--color-text-secondary)",
                    cursor: "pointer", fontWeight: form.status === s ? 600 : 400,
                  }}
                >
                  {s === "draft" ? "下書き" : "チェックインに出せる（ready）"}
                </button>
              ))}
            </div>
            {!note && prevNote && (
              <button onClick={applyCarryOver} style={{ ...primaryBtn, fontSize: "11px", padding: "5px 12px" }}>
                ↩ 前週（{formatMD(prevNote.week_start)} 週）から引き継いで作成
              </button>
            )}
            {carriedFromId && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                {formatMD(notesForTf.find(n => n.id === carriedFromId)?.week_start ?? "")} 週のノートから引き継ぎ
              </span>
            )}
            {note && (
              <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                最終更新 {new Date(note.updated_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {selectedTf && (
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              {krById.get(selectedTf.kr_id)?.title ?? "（KR未紐づけ）"}
              {tfWork && <> ／ このTF配下：ToDo {tfWork.todoCount}件・タスク {tfWork.taskDone}/{tfWork.taskCount}件完了</>}
            </div>
          )}

          {/* フォーム */}
          <Field label="必達の定義（この月に到達したい状態）">
            <TextArea value={form.target_definition} onChange={v => patch({ target_definition: v })} rows={5} placeholder="例：更新前提の運用が「月次で回る」状態になった …" />
          </Field>
          <Field label="評価観点（何をもって達成と見るか）">
            <TextArea value={form.eval_criteria} onChange={v => patch({ eval_criteria: v })} rows={3} />
          </Field>

          <div style={{ borderTop: "1px solid var(--color-border-primary)", paddingTop: "10px", fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)" }}>
            チェックイン向け（毎週更新）
          </div>
          <Field label="① 先週動かした前提・仮説">
            <TextArea value={form.hypotheses} onChange={v => patch({ hypotheses: v })} rows={5} />
          </Field>
          <Field label="② 実際に起きたこと（事実・反応）　※評価・解釈は書かない">
            <TextArea value={form.facts} onChange={v => patch({ facts: v })} rows={6} />
          </Field>
          <Field label="③ 次にやる一手（判断）">
            <TextArea value={form.next_actions} onChange={v => patch({ next_actions: v })} rows={5} />
          </Field>
          <Field label="④ 現在のプロセス状態">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <input
                type="number" min={0} max={100}
                value={form.progress_pct ?? ""}
                onChange={e => patch({ progress_pct: e.target.value === "" ? null : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                placeholder="—"
                style={{ width: "70px", padding: "6px 8px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
              />
              <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>%</span>
            </div>
            <TextArea value={form.progress_reason} onChange={v => patch({ progress_reason: v })} rows={4} placeholder="その%と判断した理由（達成できている点／まだの点）" />
          </Field>
          <Field label="ToDo / タスクの状況">
            <TextArea value={form.todo_status} onChange={v => patch({ todo_status: v })} rows={6} placeholder="このTFのToDo・タスクの現況、TODOリストなど" />
          </Field>

          {saveError && <ErrBox>{saveError}</ErrBox>}

          {/* 保存バー */}
          <div style={{ position: "sticky", bottom: 0, background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border-primary)", padding: "10px 0", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: savedFlash ? "var(--color-text-success)" : "var(--color-text-tertiary)", flex: 1 }}>
              {savedFlash ? "✓ 保存しました" : dirty ? "未保存の変更があります" : note ? "保存済み" : isThisWeek ? "今週のノートはまだありません" : "このノートはまだ保存されていません"}
            </span>
            <button onClick={handleSave} disabled={saving || (!dirty && !!note)} style={{ ...primaryBtn, opacity: (saving || (!dirty && !!note)) ? 0.5 : 1, cursor: (saving || (!dirty && !!note)) ? "default" : "pointer" }}>
              {saving ? "保存中…" : note ? "保存" : "このノートを作成"}
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
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "8px 10px", fontSize: "12px",
        border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
        background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
        resize: "vertical", lineHeight: 1.6, boxSizing: "border-box", fontFamily: "inherit",
      }}
    />
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
