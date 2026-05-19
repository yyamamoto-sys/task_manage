// src/components/okr/OkrKrAnalysisPanel.tsx
//
// 【設計意図】
// OKR循環ワークフローの ③ 分析。対象を「Objective 全体」または「KR 単位」から選んで AI 分析する。
// - KR単位：そのKRに紐づく全TFの会議ノート履歴＋KRのセッション・宣言＋各TFのタスクを束ねて分析
// - Objective全体：配下の各KRの最新KR分析＋直近セッション＋タスクサマリを束ねて横断分析
// 結果は okr_analyses に scope='kr'/'objective' で履歴保存（過去分も残す）、人が手修正もできる。
// ④レポート作成の素材にもなる（最新のKR分析をレポート画面から参照）。
// 詳細設計：docs/okr-cycle-design.md（Phase B 仕上げ）

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member, Quarter } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { MarkdownLite } from "../common/MarkdownLite";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { fetchKrSessions, fetchKrDeclarations } from "../../lib/supabase/krSessionStore";
import { fetchTfEntryHistory } from "../../lib/supabase/krMeetingNoteStore";
import {
  fetchOkrAnalyses, insertOkrAnalysis, updateOkrAnalysis,
  fetchObjectiveAnalyses, insertObjectiveAnalysis, fetchLatestOkrAnalysis,
  type OkrAnalysis,
} from "../../lib/supabase/okrAnalysisStore";
import { analyzeKr, type KrAnalysisInput, type KrAnalysisTf } from "../../lib/ai/okrKrAnalysisClient";
import { analyzeObjective, type ObjectiveAnalysisKrInput } from "../../lib/ai/okrObjectiveAnalysisClient";
import { getAssigneeIds } from "../../lib/taskMeta";

const QUARTERS: Quarter[] = ["1Q", "2Q", "3Q", "4Q"];
function currentQuarter(): Quarter {
  const m = new Date().getMonth() + 1;
  return m <= 3 ? "1Q" : m <= 6 ? "2Q" : m <= 9 ? "3Q" : "4Q";
}
const KR_PHASES = [
  "各TFの会議ノートを読み込んでいます",
  "セッションと宣言を確認しています",
  "TF横断で進捗と仮説の検証状況を評価しています",
  "リスク・ボトルネックを洗い出しています",
  "レポート用の要点をまとめています",
];
const OBJ_PHASES = [
  "配下のKRの分析結果を集約しています",
  "各KRの直近セッション・タスク状況を確認しています",
  "Objective横断の進捗バランス・リスクを評価しています",
  "全体としての次の一手をまとめています",
];

// ===== 対象（Objective か KR）の表現 =====
type Target = { kind: "objective"; objectiveId: string } | { kind: "kr"; krId: string };
const encodeTarget = (t: Target): string => t.kind === "objective" ? `obj:${t.objectiveId}` : `kr:${t.krId}`;
const decodeTarget = (s: string): Target | null => {
  if (s.startsWith("obj:")) return { kind: "objective", objectiveId: s.slice(4) };
  if (s.startsWith("kr:"))  return { kind: "kr", krId: s.slice(3) };
  return null;
};

interface Props {
  inline?: boolean;
  onClose: () => void;
  currentUser: Member;
  initialKrId?: string;
}

export function OkrKrAnalysisPanel({ onClose, currentUser, initialKrId }: Props) {
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

  // 既定の対象：initialKrId があればそのKR、無ければ Objective全体（あれば）、それも無ければ先頭のKR
  const initialTarget = useMemo<Target | null>(() => {
    if (initialKrId && krs.some(k => k.id === initialKrId)) return { kind: "kr", krId: initialKrId };
    if (objective) return { kind: "objective", objectiveId: objective.id };
    if (krs[0]) return { kind: "kr", krId: krs[0].id };
    return null;
  }, [initialKrId, krs, objective]);

  const [target, setTarget] = useState<Target | null>(initialTarget);
  useEffect(() => { if (!target && initialTarget) setTarget(initialTarget); }, [initialTarget, target]);

  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());

  // クォーターのKR×TF割り当て（KR分析で使う）
  const qObj = useMemo(
    () => objective ? (rawQObjs.find(q => !q.is_deleted && q.objective_id === objective.id && q.quarter === quarter) ?? null) : null,
    [rawQObjs, objective, quarter],
  );
  const usingQuarterAssignment = !!qObj;

  /** クォーター割り当てがあれば q-kr-tf、無ければ kr_id でTFを引く共通ヘルパ */
  const tfsForKr = useCallback((krId: string) => {
    const allActive = rawTfs.filter(tf => !tf.is_deleted);
    const pool = qObj
      ? allActive.filter(tf => new Set(rawQktf.filter(q => q.quarterly_objective_id === qObj.id && q.kr_id === krId).map(q => q.tf_id)).has(tf.id))
      : allActive.filter(tf => tf.kr_id === krId);
    const byId = new Map(pool.map(tf => [tf.id, tf]));
    return [...byId.values()].sort((a, b) => (Number(a.tf_number) || 999) - (Number(b.tf_number) || 999));
  }, [rawTfs, rawQktf, qObj]);

  const krTfs = useMemo(() => target?.kind === "kr" ? tfsForKr(target.krId) : [], [target, tfsForKr]);

  // 分析履歴（対象に応じて取り直す）
  const [analyses, setAnalyses] = useState<OkrAnalysis[]>([]);
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
    if (!target) { setAnalyses([]); return; }
    let cancelled = false;
    setLoading(true); setLoadError(null); setEditing(false); setSelIndex(0);
    const p = target.kind === "objective"
      ? fetchObjectiveAnalyses(target.objectiveId)
      : fetchOkrAnalyses(target.krId);
    p.then(rows => { if (!cancelled) setAnalyses(rows); })
     .catch((e: unknown) => { if (!cancelled) { setLoadError(formatErrorForUser("分析履歴の取得に失敗しました", e)); setAnalyses([]); } })
     .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target]);

  const current = analyses[selIndex] ?? analyses[0] ?? null;

  // TFごとのタスク（task_task_forces 経由 + todos 経由 を統合）
  const tasksForTf = useCallback((tfId: string) => {
    const direct = new Set(rawTtfs.filter(j => j.tf_id === tfId).map(j => j.task_id));
    const todoIds = new Set(rawTodos.filter(td => !td.is_deleted && td.tf_id === tfId).map(td => td.id));
    return rawTasks.filter(t => !t.is_deleted && (direct.has(t.id) || (t.todo_ids ?? []).some(id => todoIds.has(id))));
  }, [rawTtfs, rawTodos, rawTasks]);

  // ===== KR分析 =====
  const runKrAnalysis = useCallback(async (krId: string) => {
    const tfs = tfsForKr(krId);
    if (tfs.length === 0) throw new Error("対象TFがありません");
    const krTitle = krs.find(k => k.id === krId)?.title ?? "";
    const tfData: KrAnalysisTf[] = await Promise.all(tfs.map(async tf => {
      const noteHist = await fetchTfEntryHistory(krId, tf.id, 8);
      const themeFromNotes = noteHist.find(n => n.tf_theme)?.tf_theme ?? (tf.description ?? "");
      return {
        number: tf.tf_number, name: tf.name, theme: themeFromNotes,
        noteHistory: noteHist.map(n => ({
          week_start: n.week_start, target_definition: n.target_definition, eval_criteria: n.eval_criteria,
          hypotheses: n.hypotheses, facts: n.facts, next_actions: n.next_actions,
          progress_pct: n.progress_pct, progress_reason: n.progress_reason, todo: n.todo,
        })),
        tasks: tasksForTf(tf.id).map(t => ({
          name: t.name, status: t.status, priority: t.priority,
          assignee: getAssigneeIds(t).map(shortName).filter(Boolean).join("・"),
          due_date: t.due_date, updated_at: t.updated_at,
        })),
      };
    }));
    const sessions = await fetchKrSessions(krId);
    const recentSessions = sessions.slice(0, 10);
    const checkinSessions = recentSessions.filter(s => s.session_type === "checkin").slice(0, 4);
    const declLists = await Promise.all(checkinSessions.map(s => fetchKrDeclarations(s.id).then(ds => ({ week: s.week_start, ds })).catch(() => ({ week: s.week_start, ds: [] }))));
    const declarations = declLists.flatMap(({ week, ds }) => ds.map(d => ({
      week_start: week, member: shortName(d.member_id), content: d.content,
      due_date: d.due_date, result: d.result_status, result_note: d.result_note,
    })));
    const input: KrAnalysisInput = {
      kr: { title: krTitle },
      tfs: tfData,
      sessions: recentSessions.map(s => ({
        week_start: s.week_start, type: s.session_type, signal: s.signal, signal_comment: s.signal_comment,
        learnings: s.learnings, external_changes: s.external_changes, summary: s.summary, decisions: s.decisions, kr_mentions: s.kr_mentions,
      })),
      declarations,
      today: new Date().toISOString().slice(0, 10),
    };
    const text = await analyzeKr(input);
    await insertOkrAnalysis(krId, text, currentUser.id, false);
  }, [tfsForKr, krs, tasksForTf, shortName, currentUser.id]);

  // ===== Objective 分析 =====
  const runObjectiveAnalysis = useCallback(async (objId: string) => {
    if (!objective || objective.id !== objId) throw new Error("対象Objectiveが見つかりません");
    const objKrs = krs.filter(k => k.objective_id === objId);
    if (objKrs.length === 0) throw new Error("配下のKRがありません");

    // 各KRぶんを並列で組み立てる
    const krInputs: ObjectiveAnalysisKrInput[] = await Promise.all(objKrs.map(async kr => {
      const [latest, sessions] = await Promise.all([
        fetchLatestOkrAnalysis(kr.id).catch(() => null),
        fetchKrSessions(kr.id).catch(() => []),
      ]);
      const tfs = tfsForKr(kr.id);
      // タスクサマリ（このKR配下のTFタスクを集計）
      const allTasks = new Map<string, ReturnType<typeof tasksForTf>[number]>();
      for (const tf of tfs) for (const t of tasksForTf(tf.id)) allTasks.set(t.id, t);
      const today = new Date().toISOString().slice(0, 10);
      let done = 0, inProg = 0, todo = 0, overdue = 0;
      for (const t of allTasks.values()) {
        if (t.status === "done") done++;
        else if (t.status === "in_progress") inProg++;
        else todo++;
        if (t.status !== "done" && t.due_date && t.due_date <= today) overdue++;
      }
      const recentSessions = sessions.slice(0, 6).map(s => ({
        week_start: s.week_start, type: s.session_type, signal: s.signal,
        signal_comment: s.signal_comment, learnings: s.learnings,
        // freeform 用フィールドも引き渡す（Objective分析 prompt が type で切替して表示）
        summary: s.summary ?? "", decisions: s.decisions ?? "", kr_mentions: s.kr_mentions ?? "",
      }));
      return {
        id: kr.id, title: kr.title,
        tfs: tfs.map(tf => ({ number: tf.tf_number, name: tf.name, theme: tf.description ?? "" })),
        latestKrAnalysis: latest ? { content: latest.content, created_at: latest.created_at } : null,
        sessions: recentSessions,
        taskSummary: { total: allTasks.size, done, in_progress: inProg, todo, overdue },
      };
    }));

    const text = await analyzeObjective({
      objective: { title: objective.title, purpose: objective.purpose, period: objective.period },
      krs: krInputs,
      today: new Date().toISOString().slice(0, 10),
    });
    await insertObjectiveAnalysis(objId, text, currentUser.id, false);
  }, [objective, krs, tfsForKr, tasksForTf, currentUser.id]);

  const runAnalysis = useCallback(async () => {
    if (!target) return;
    setAnalyzing(true); setActionError(null);
    try {
      if (target.kind === "objective") await runObjectiveAnalysis(target.objectiveId);
      else await runKrAnalysis(target.krId);
      // refresh
      const rows = target.kind === "objective"
        ? await fetchObjectiveAnalyses(target.objectiveId)
        : await fetchOkrAnalyses(target.krId);
      setAnalyses(rows); setSelIndex(0); setEditing(false);
    } catch (e) {
      setActionError(formatErrorForUser("AI分析に失敗しました", e));
    } finally {
      setAnalyzing(false);
    }
  }, [target, runObjectiveAnalysis, runKrAnalysis]);

  const startEdit = useCallback(() => { setEditText(current?.content ?? ""); setEditing(true); setActionError(null); }, [current]);
  const saveEdit = useCallback(async () => {
    if (!target) return;
    setSaving(true); setActionError(null);
    try {
      if (current) {
        await updateOkrAnalysis(current.id, editText, currentUser.id);
      } else {
        if (target.kind === "objective") await insertObjectiveAnalysis(target.objectiveId, editText, currentUser.id, true);
        else await insertOkrAnalysis(target.krId, editText, currentUser.id, true);
      }
      const rows = target.kind === "objective"
        ? await fetchObjectiveAnalyses(target.objectiveId)
        : await fetchOkrAnalyses(target.krId);
      setAnalyses(rows); setSelIndex(0); setEditing(false);
    } catch (e) {
      setActionError(formatErrorForUser("保存に失敗しました", e));
    } finally { setSaving(false); }
  }, [target, current, editText, currentUser.id]);
  const copy = useCallback(() => {
    if (!current) return;
    navigator.clipboard?.writeText(current.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }, [current]);
  const fmtAt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  // 描画用の派生情報
  const isKr = target?.kind === "kr";
  const isObj = target?.kind === "objective";
  const krsUnderObj = useMemo(() => objective ? krs.filter(k => k.objective_id === objective.id) : krs, [objective, krs]);
  const totalTasksKr = useMemo(() => krTfs.reduce((n, tf) => n + tasksForTf(tf.id).length, 0), [krTfs, tasksForTf]);
  const phases = isObj ? OBJ_PHASES : KR_PHASES;
  const targetTitle = isObj && objective ? `Objective：${objective.title}` : isKr ? (krs.find(k => k.id === (target as { krId: string }).krId)?.title ?? "") : "";

  // ボタンの活性条件
  const canAnalyze = (() => {
    if (!target) return false;
    if (isObj) return krsUnderObj.length > 0;
    if (isKr)  return krTfs.length > 0;
    return false;
  })();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 360px" }}>
          <Label>分析対象</Label>
          <select value={target ? encodeTarget(target) : ""} onChange={e => setTarget(decodeTarget(e.target.value))} style={selStyle}>
            {objective && <option value={`obj:${objective.id}`}>Objective全体（{objective.title}）</option>}
            {krsUnderObj.length === 0 && !objective && <option value="">（対象がありません）</option>}
            {krsUnderObj.map(k => <option key={k.id} value={`kr:${k.id}`}>KR：{k.title}</option>)}
          </select>
        </div>
        {isKr && (
          <div style={{ flex: "0 1 130px" }}>
            <Label>クォーター（対象TF）</Label>
            <select value={quarter} onChange={e => setQuarter(e.target.value as Quarter)} style={selStyle}>
              {QUARTERS.map(q => <option key={q} value={q}>{q}{q === currentQuarter() ? "（今）" : ""}</option>)}
            </select>
          </div>
        )}
        <button onClick={onClose} style={{ ...ghostBtn, marginLeft: "auto" }}>閉じる</button>
      </div>

      {isKr && target && !usingQuarterAssignment && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "7px 10px" }}>
          ※ {quarter} のTF割り当てが未設定のため、このKRに紐づく全TFを対象にしています。
        </div>
      )}

      {!target && <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "32px" }}>分析対象が見つかりません。</div>}

      {target && (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "10px" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>{targetTitle}</div>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                {isObj
                  ? `配下のKR ${krsUnderObj.length}件の最新KR分析＋直近セッション＋タスク状況を束ねて、Objective全体を横断分析します。`
                  : `対象TF ${krTfs.length}件・タスク ${totalTasksKr}件＋このKRのセッション・宣言を AI が分析します。結果は履歴に残り、手修正でき、レポート作成の素材になります。`}
              </div>
              {isKr && krTfs.length > 0 && <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>対象TF：{krTfs.map(t => `TF${t.tf_number} ${t.name}`).join(" / ")}</div>}
              {isObj && krsUnderObj.length > 0 && <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>配下KR：{krsUnderObj.map(k => k.title).join(" / ")}</div>}
            </div>
            <button onClick={analyzing ? undefined : runAnalysis} disabled={analyzing || !canAnalyze} style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", fontSize: "12px", fontWeight: 600,
              border: "none", borderRadius: "var(--radius-full)",
              background: (analyzing || !canAnalyze) ? "var(--color-bg-tertiary)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: (analyzing || !canAnalyze) ? "var(--color-text-tertiary)" : "#fff", cursor: (analyzing || !canAnalyze) ? "default" : "pointer",
              boxShadow: (analyzing || !canAnalyze) ? "none" : "0 2px 8px rgba(99,102,241,0.3)",
            }}>
              <span>✨</span> {analyzing ? "分析中…" : analyses.length > 0 ? "AI分析を再実行" : (isObj ? "Objective全体をAI分析" : "このKRをAI分析")}
            </button>
          </div>

          {loadError && <ErrBox>{loadError}</ErrBox>}
          {actionError && <ErrBox>{actionError}</ErrBox>}
          {loading && <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>読み込み中…</div>}
          {analyzing && <AIProgressLoader phases={phases} intervalMs={4500} />}

          {!analyzing && !loading && (
            <>
              {!current && !editing && (
                <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "28px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-lg)" }}>
                  まだ分析がありません。「AI分析」で作成するか、<button onClick={startEdit} style={linkBtn}>手書きで作成</button>できます。
                  {isObj && <div style={{ marginTop: "6px", fontSize: "11px" }}>※ 先に各KRの「AI分析」を済ませておくと、Objective分析の素材が濃くなります。</div>}
                </div>
              )}

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

              {(current || editing) && (
                <div style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-lg)", padding: "14px 16px" }}>
                  {!editing && current && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                        {fmtAt(current.created_at)}・{shortName(current.created_by) || "メンバー"}{current.edited ? " が作成（手修正済み）" : " がAIで生成"}{selIndex > 0 ? "（過去の分析）" : ""}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button onClick={copy} style={ghostBtn}>{copied ? "コピーしました" : "コピー"}</button>
                      <button onClick={startEdit} style={ghostBtn}>編集</button>
                    </div>
                  )}
                  {editing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={20}
                        style={{ width: "100%", padding: "10px 12px", fontSize: "12px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.7, boxSizing: "border-box", fontFamily: "inherit" }} />
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={saveEdit} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }}>{saving ? "保存中…" : current ? "上書き保存" : "保存"}</button>
                        <button onClick={() => setEditing(false)} style={ghostBtn}>キャンセル</button>
                      </div>
                    </div>
                  ) : current && <MarkdownLite text={current.content} />}
                </div>
              )}
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                AIの分析は参考情報です。事実は会議ノート・セッション記録で確認してください。
                {isKr ? "④レポート作成では、この最新の分析を素材として参照できます。" : "Objective分析は配下KRの最新KR分析を素材にしているので、各KR分析を先に実行しておくと精度が上がります。"}
              </div>
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
