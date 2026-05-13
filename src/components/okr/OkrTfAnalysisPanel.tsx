// src/components/okr/OkrTfAnalysisPanel.tsx
//
// 【設計意図】
// OKR循環ワークフローの ③ 分析結果。会議ノート（kr_note_tf_entries の履歴）＋KRセッション・宣言＋
// TFのタスクを束ねて AI が TF の状態を分析する。結果は okr_tf_analyses に履歴保存（過去分も残す）、
// 人が手修正もできる。詳細設計：docs/okr-cycle-design.md（Phase B）

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Quarter } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { MarkdownLite } from "../common/MarkdownLite";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { fetchKrSessions, fetchKrDeclarations } from "../../lib/supabase/krSessionStore";
import { fetchTfEntryHistory } from "../../lib/supabase/krMeetingNoteStore";
import { fetchOkrTfAnalyses, insertOkrTfAnalysis, updateOkrTfAnalysis, type OkrTfAnalysis } from "../../lib/supabase/okrTfAnalysisStore";
import { analyzeTf, type TfAnalysisInput } from "../../lib/ai/okrTfAnalysisClient";

const QUARTERS: Quarter[] = ["1Q", "2Q", "3Q", "4Q"];
function currentQuarter(): Quarter {
  const m = new Date().getMonth() + 1;
  return m <= 3 ? "1Q" : m <= 6 ? "2Q" : m <= 9 ? "3Q" : "4Q";
}
const ANALYSIS_PHASES = [
  "会議ノートの履歴を読み込んでいます",
  "セッションと宣言を確認しています",
  "進捗と仮説の検証状況を評価しています",
  "リスク・ボトルネックを洗い出しています",
  "次の一手をまとめています",
];

interface Props {
  inline?: boolean;
  onClose: () => void;
  currentUser: Member;
  initialKrId?: string;
}

export function OkrTfAnalysisPanel({ onClose, currentUser, initialKrId }: Props) {
  const rawKrs   = useAppStore(s => s.keyResults);
  const rawTfs   = useAppStore(s => s.taskForces);
  const rawTasks = useAppStore(s => s.tasks);
  const rawTodos = useAppStore(s => s.todos);
  const rawTtfs  = useAppStore(s => s.taskTaskForces);
  const rawMembers = useAppStore(s => s.members);
  const objective = useAppStore(s => s.objective);
  const rawQObjs  = useAppStore(s => s.quarterlyObjectives);
  const rawQktf   = useAppStore(s => s.quarterlyKrTaskForces);

  const krs = useMemo(() => rawKrs.filter(k => !k.is_deleted), [rawKrs]);
  const memberById = useMemo(() => new Map(rawMembers.filter(m => !m.is_deleted).map(m => [m.id, m])), [rawMembers]);
  const shortName = useCallback((id: string) => memberById.get(id)?.short_name ?? "", [memberById]);

  const [krId, setKrId] = useState<string>(initialKrId && krs.some(k => k.id === initialKrId) ? initialKrId : (krs[0]?.id ?? ""));
  useEffect(() => { if (!krId && krs[0]) setKrId(krs[0].id); }, [krs, krId]);
  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());

  const qObj = useMemo(
    () => objective ? (rawQObjs.find(q => !q.is_deleted && q.objective_id === objective.id && q.quarter === quarter) ?? null) : null,
    [rawQObjs, objective, quarter],
  );
  const usingQuarterAssignment = !!qObj;
  const tfs = useMemo(() => {
    if (!krId) return [];
    const allActive = rawTfs.filter(tf => !tf.is_deleted);
    const pool = qObj
      ? allActive.filter(tf => new Set(rawQktf.filter(q => q.quarterly_objective_id === qObj.id && q.kr_id === krId).map(q => q.tf_id)).has(tf.id))
      : allActive.filter(tf => tf.kr_id === krId);
    const byId = new Map(pool.map(tf => [tf.id, tf]));
    return [...byId.values()].sort((a, b) => (Number(a.tf_number) || 999) - (Number(b.tf_number) || 999));
  }, [rawTfs, rawQktf, qObj, krId]);

  const [tfId, setTfId] = useState<string>("");
  useEffect(() => { setTfId(tfs[0]?.id ?? ""); }, [tfs]);
  const tf = tfs.find(t => t.id === tfId) ?? null;

  // 分析履歴
  const [analyses, setAnalyses] = useState<OkrTfAnalysis[]>([]);
  const [selIndex, setSelIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!tfId) { setAnalyses([]); return; }
    let cancelled = false;
    setLoading(true); setLoadError(null); setEditing(false); setSelIndex(0);
    fetchOkrTfAnalyses(tfId)
      .then(rows => { if (!cancelled) setAnalyses(rows); })
      .catch((e: unknown) => { if (!cancelled) { setLoadError(formatErrorForUser("分析履歴の取得に失敗しました", e)); setAnalyses([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tfId]);

  const current = analyses[selIndex] ?? analyses[0] ?? null;

  // TFのタスク（task_task_forces 経由 + todos 経由 を統合）
  const tfTasks = useMemo(() => {
    if (!tfId) return [];
    const direct = new Set(rawTtfs.filter(j => j.tf_id === tfId).map(j => j.task_id));
    const todoIds = new Set(rawTodos.filter(td => !td.is_deleted && td.tf_id === tfId).map(td => td.id));
    return rawTasks.filter(t => !t.is_deleted && (direct.has(t.id) || (t.todo_ids ?? []).some(id => todoIds.has(id))));
  }, [tfId, rawTtfs, rawTodos, rawTasks]);

  const runAnalysis = useCallback(async () => {
    if (!tfId || !tf || !krId) return;
    setAnalyzing(true); setActionError(null);
    try {
      const krTitle = krs.find(k => k.id === krId)?.title ?? "";
      // 入力収集
      const [noteHist, sessions] = await Promise.all([
        fetchTfEntryHistory(krId, tfId, 8),
        fetchKrSessions(krId),
      ]);
      const recentSessions = sessions.slice(0, 8);
      // 直近のチェックイン4件の宣言を取得
      const checkinSessions = recentSessions.filter(s => s.session_type === "checkin").slice(0, 4);
      const declLists = await Promise.all(checkinSessions.map(s => fetchKrDeclarations(s.id).then(ds => ({ week: s.week_start, ds })).catch(() => ({ week: s.week_start, ds: [] }))));
      const declarations = declLists.flatMap(({ week, ds }) => ds.map(d => ({
        week_start: week, member: shortName(d.member_id), content: d.content,
        due_date: d.due_date, result: d.result_status, result_note: d.result_note,
      })));

      const themeFromNotes = noteHist.find(n => n.tf_theme)?.tf_theme ?? (tf.description ?? "");
      const input: TfAnalysisInput = {
        tf: { number: tf.tf_number, name: tf.name, theme: themeFromNotes },
        kr: { title: krTitle },
        noteHistory: noteHist.map(n => ({
          week_start: n.week_start, target_definition: n.target_definition, eval_criteria: n.eval_criteria,
          hypotheses: n.hypotheses, facts: n.facts, next_actions: n.next_actions,
          progress_pct: n.progress_pct, progress_reason: n.progress_reason, todo: n.todo,
        })),
        sessions: recentSessions.map(s => ({
          week_start: s.week_start, type: s.session_type, signal: s.signal, signal_comment: s.signal_comment,
          learnings: s.learnings, external_changes: s.external_changes, summary: s.summary, decisions: s.decisions, kr_mentions: s.kr_mentions,
        })),
        declarations,
        tasks: tfTasks.map(t => ({
          name: t.name, status: t.status, priority: t.priority,
          assignee: (t.assignee_member_ids?.length ? t.assignee_member_ids : t.assignee_member_id ? [t.assignee_member_id] : []).map(shortName).filter(Boolean).join("・"),
          due_date: t.due_date, updated_at: t.updated_at,
        })),
        today: new Date().toISOString().slice(0, 10),
      };
      const text = await analyzeTf(input);
      await insertOkrTfAnalysis(tfId, text, currentUser.id, false);
      const rows = await fetchOkrTfAnalyses(tfId);
      setAnalyses(rows); setSelIndex(0); setEditing(false);
    } catch (e) {
      setActionError(formatErrorForUser("AI分析に失敗しました", e));
    } finally {
      setAnalyzing(false);
    }
  }, [tfId, tf, krId, krs, tfTasks, shortName, currentUser.id]);

  const startEdit = useCallback(() => {
    setEditText(current?.content ?? "");
    setEditing(true);
    setActionError(null);
  }, [current]);

  const saveEdit = useCallback(async () => {
    if (!tfId) return;
    setSaving(true); setActionError(null);
    try {
      if (current) {
        await updateOkrTfAnalysis(current.id, editText, currentUser.id);
      } else {
        await insertOkrTfAnalysis(tfId, editText, currentUser.id, true);
      }
      const rows = await fetchOkrTfAnalyses(tfId);
      setAnalyses(rows); setSelIndex(0); setEditing(false);
    } catch (e) {
      setActionError(formatErrorForUser("保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  }, [tfId, current, editText, currentUser.id]);

  const copy = useCallback(() => {
    if (!current) return;
    navigator.clipboard?.writeText(current.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }, [current]);

  const fmtAt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* セレクタ行 */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 260px" }}>
          <Label>Key Result</Label>
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
        <div style={{ flex: "0 1 220px" }}>
          <Label>タスクフォース</Label>
          <select value={tfId} onChange={e => setTfId(e.target.value)} style={selStyle}>
            {tfs.length === 0 && <option value="">（TFがありません）</option>}
            {tfs.map(t => <option key={t.id} value={t.id}>TF{t.tf_number} {t.name}</option>)}
          </select>
        </div>
        <button onClick={onClose} style={{ ...ghostBtn, marginLeft: "auto" }}>閉じる</button>
      </div>

      {krId && !usingQuarterAssignment && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "7px 10px" }}>
          ※ {quarter} のTF割り当てが未設定のため、このKRに紐づく全TFを表示しています。
        </div>
      )}

      {!tfId && <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>分析対象のタスクフォースがありません。</div>}

      {tfId && tf && (
        <>
          {/* 見出し + 実行ボタン */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "10px" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>TF{tf.tf_number} {tf.name}</div>
              {tf.description && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>{tf.description}</div>}
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                会議ノート＋KRセッション・宣言＋このTFのタスク（{tfTasks.length}件）を AI が分析します。結果は履歴に残り、手修正できます。
              </div>
            </div>
            <button onClick={analyzing ? undefined : runAnalysis} disabled={analyzing} style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", fontSize: "12px", fontWeight: 600,
              border: "none", borderRadius: "var(--radius-full)",
              background: analyzing ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: analyzing ? "var(--color-text-tertiary)" : "#fff", cursor: analyzing ? "default" : "pointer",
              boxShadow: analyzing ? "none" : "0 2px 8px rgba(99,102,241,0.3)",
            }}>
              <span>✨</span> {analyzing ? "分析中…" : analyses.length > 0 ? "AI分析を再実行" : "このTFをAI分析"}
            </button>
          </div>

          {loadError && <ErrBox>{loadError}</ErrBox>}
          {actionError && <ErrBox>{actionError}</ErrBox>}
          {loading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>}

          {analyzing && <AIProgressLoader phases={ANALYSIS_PHASES} intervalMs={4000} />}

          {!analyzing && !loading && (
            <>
              {!current && !editing && (
                <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "28px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-lg)" }}>
                  まだ分析がありません。「このTFをAI分析」で作成するか、<button onClick={startEdit} style={{ ...linkBtn }}>手書きで作成</button>できます。
                </div>
              )}

              {/* 履歴タブ */}
              {analyses.length > 1 && !editing && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {analyses.map((a, i) => (
                    <button key={a.id} onClick={() => setSelIndex(i)} style={{
                      fontSize: "11px", padding: "4px 11px", borderRadius: "var(--radius-full)",
                      border: i === selIndex ? "1px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                      background: i === selIndex ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                      color: i === selIndex ? "var(--color-brand)" : "var(--color-text-secondary)",
                      cursor: "pointer", fontWeight: i === selIndex ? 600 : 400,
                    }}>{i === 0 ? "最新" : `${i + 1}つ前`}（{fmtAt(a.created_at)}）{a.edited ? " ✎" : ""}</button>
                  ))}
                </div>
              )}

              {/* 本文 or 編集 */}
              {(current || editing) && (
                <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
                  {!editing && current && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                        {fmtAt(current.created_at)}・{shortName(current.created_by) || "メンバー"}{current.edited ? " が作成（手修正済み）" : " がAIで生成"}
                        {selIndex > 0 ? "（過去の分析）" : ""}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button onClick={copy} style={ghostBtn}>{copied ? "コピーしました" : "コピー"}</button>
                      <button onClick={startEdit} style={ghostBtn}>編集</button>
                    </div>
                  )}
                  {editing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={18}
                        style={{ width: "100%", padding: "10px 12px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.7, boxSizing: "border-box", fontFamily: "inherit" }} />
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={saveEdit} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }}>{saving ? "保存中…" : current ? "上書き保存" : "保存"}</button>
                        <button onClick={() => setEditing(false)} style={ghostBtn}>キャンセル</button>
                      </div>
                    </div>
                  ) : current && (
                    <MarkdownLite text={current.content} />
                  )}
                </div>
              )}

              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>AIの分析は参考情報です。事実は会議ノート・セッション記録で確認してください。</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>{children}</div>;
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
const linkBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "var(--color-brand)", cursor: "pointer", padding: 0, fontSize: "13px", textDecoration: "underline",
};
