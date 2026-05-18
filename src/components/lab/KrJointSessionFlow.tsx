// src/components/lab/KrJointSessionFlow.tsx
//
// 【設計意図】
// 合同チェックイン／ウィンセッションの「記録&分析」を1画面で行う（②セッション記録&分析）。
// 議事メモ（テキスト or .vtt/.txt/.srt or PDF/Word）を1回投入し、AI に「先に詳細分析→その結果として
// 宣言・シグナル・学び・リスク・次の一手」をKRごとに整理させる。
// 保存時は KR ごとに kr_sessions（signal/learnings 等）＋ kr_declarations（宣言）に加え、
// okr_analyses（scope='kr', KRごとの詳細分析マークダウン）と okr_analyses（scope='objective', 会議全体）を
// 同時に作る。これでステップ②の中で「記録」「分析」が完結し、③レポート作成の素材になる。

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { formatErrorForUser } from "../../lib/errorMessage";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { SaveProgressLoader } from "../common/SaveProgressLoader";
import { FileAttachButton, FileDropZone, type FileAttachment } from "../common/FileAttachButton";
import {
  insertKrSession, insertKrDeclaration, updateKrDeclarationResult,
  fetchLatestCheckinSession, fetchKrDeclarations, type KrDeclaration,
} from "../../lib/supabase/krSessionStore";
import { insertOkrAnalysis, insertObjectiveAnalysis } from "../../lib/supabase/okrAnalysisStore";
import {
  extractJointCheckinData, extractJointWinSessionData,
  extractFreeformSession, type ExtractedKrMention,
} from "../../lib/ai/krSessionExtractor";
import { HelpButton } from "../guide/HelpButton";

type JointMode = "checkin" | "win_session" | "freeform";
type Step = "input" | "extracting" | "review" | "saving" | "done";

const PHASES_CHECKIN = [
  "文字起こしを読み込んでいます…",
  "議論の流れ・対立・気づきを把握しています…",
  "KRごとの宣言・シグナルを拾っています…",
  "学び・リスク・次の一手を整理しています…",
  "結果をまとめています…",
];
const PHASES_WIN = [
  "文字起こしを読み込んでいます…",
  "議論の流れ・前回宣言との照合を行っています…",
  "KRごとの学び・外部環境変化を拾っています…",
  "リスク・次の一手を整理しています…",
  "結果をまとめています…",
];
const PHASES_FREEFORM = [
  "文字起こしを読み込んでいます…",
  "議論サマリを整理しています…",
  "決定事項を拾っています…",
  "言及されたKR/TFとフォローアップを抽出しています…",
  "結果をまとめています…",
];

interface FreeformFollowUpRow {
  tempId: string;
  member_short_name: string;
  content: string;
  due_date: string;
}

function getThisMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

// 確認用のドラフト型（KRごと）
interface CheckinDraft {
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  discussion_summary: string;
  learnings: string;
  risks: string;       // textarea で編集（改行区切り）
  next_actions: string;
  declarations: { member_short_name: string; content: string; due_date: string | null }[];
}
interface WinDraft {
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  discussion_summary: string;
  learnings: string;
  external_changes: string;
  risks: string;
  next_actions: string;
  declaration_results: { declaration_index: number; result_status: "achieved" | "partial" | "not_achieved" | null; result_note: string }[];
}
interface KrPanelState {
  krId: string;
  krTitle: string;
  selected: boolean;
  checkin?: CheckinDraft;
  win?: WinDraft;
  previousDeclarations?: KrDeclaration[];
}
interface OverallDraft {
  summary: string;
  cross_kr_insights: string;
}

const empCheckin = (): CheckinDraft => ({ signal: null, signal_comment: "", discussion_summary: "", learnings: "", risks: "", next_actions: "", declarations: [] });
const empWin = (): WinDraft => ({ signal: null, signal_comment: "", discussion_summary: "", learnings: "", external_changes: "", risks: "", next_actions: "", declaration_results: [] });
const joinLines = (arr: string[]) => arr.filter(s => s.trim()).join("\n");
const splitLines = (s: string) => s.split(/\r?\n/).map(t => t.trim()).filter(Boolean);

interface Props {
  currentUser: Member;
  initialKrId?: string;
  onSaved?: () => void;
  // MainLayout のオーバーレイから開いたとき用。OkrDashboardView の
  // インライン表示では渡さない（その場合は閉じるボタンを表示しない）。
  onClose?: () => void;
}

export function KrJointSessionFlow({ currentUser, initialKrId, onSaved, onClose }: Props) {
  const rawKrs = useAppStore(s => s.keyResults);
  const rawMembers = useAppStore(s => s.members);
  const objective = useAppStore(s => s.objective);
  const activeKrs = useMemo(() => (rawKrs ?? []).filter(k => !k.is_deleted), [rawKrs]);
  const memberById = useMemo(() => new Map((rawMembers ?? []).filter(m => !m.is_deleted).map(m => [m.id, m])), [rawMembers]);
  const memberShortNames = useMemo(() => [...memberById.values()].map(m => m.short_name), [memberById]);

  const [mode, setMode] = useState<JointMode>("checkin");
  const [selectedKrIds, setSelectedKrIds] = useState<Set<string>>(() => new Set(activeKrs.map(k => k.id)));
  useEffect(() => {
    const s = new Set(activeKrs.map(k => k.id));
    if (initialKrId) s.add(initialKrId);
    setSelectedKrIds(s);
  }, [activeKrs, initialKrId]);

  const [transcript, setTranscript] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string }>({ current: 0, total: 1, label: "" });

  // 確認ステップのデータ
  const [panels, setPanels] = useState<KrPanelState[]>([]);
  const [overall, setOverall] = useState<OverallDraft>({ summary: "", cross_kr_insights: "" });
  // タブ：'overall' or kr_id
  const [activeTab, setActiveTab] = useState<string>("overall");

  // freeform 用ステート（メインKR1つに紐づける）
  const [freeformPrimaryKrId, setFreeformPrimaryKrId] = useState<string>("");
  const [freeformSummary, setFreeformSummary] = useState("");
  const [freeformDecisions, setFreeformDecisions] = useState<string[]>([]);
  const [freeformKrMentions, setFreeformKrMentions] = useState<ExtractedKrMention[]>([]);
  const [freeformFollowUps, setFreeformFollowUps] = useState<FreeformFollowUpRow[]>([]);

  // freeform 用：メインKR を initialKrId or 先頭で初期化
  useEffect(() => {
    if (freeformPrimaryKrId) return;
    setFreeformPrimaryKrId(initialKrId ?? activeKrs[0]?.id ?? "");
  }, [initialKrId, activeKrs, freeformPrimaryKrId]);

  const dropAreaRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const handleDropToTextarea = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const nm = file.name.toLowerCase();
    if (nm.endsWith(".vtt") || nm.endsWith(".srt") || nm.endsWith(".txt") || nm.endsWith(".text") || file.type.startsWith("text/")) {
      const reader = new FileReader();
      reader.onload = ev => setTranscript((ev.target?.result as string) ?? "");
      reader.readAsText(file, "utf-8");
    } else {
      alert("ここに直接ドロップできるのはテキスト系（.vtt / .srt / .txt 等）です。PDF・Word は📎ボタンで添付してください。");
    }
  }, []);

  // 📄 ファイル選択（.vtt 等）→ textarea に展開
  const vttInputRef = useRef<HTMLInputElement>(null);
  const handlePickTextFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setTranscript((ev.target?.result as string) ?? "");
    reader.onerror = () => alert("ファイルの読み込みに失敗しました。");
    reader.readAsText(f, "utf-8");
  };

  const toggleKr = (id: string) => {
    setSelectedKrIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  // ===== 抽出 =====

  const handleExtract = useCallback(async () => {
    setError(null);
    const text = transcript.trim();
    if (!text && !attachment) { setError("文字起こしを貼り付けるか、ファイルを添付してください。"); return; }

    // freeform はメインKR 1つだけが対象
    if (mode === "freeform") {
      const primary = activeKrs.find(k => k.id === freeformPrimaryKrId);
      if (!primary) { setError("メインKRを選択してください。"); return; }
      setStep("extracting");
      try {
        const result = await extractFreeformSession({
          krTitle: primary.title,
          allKrTitles: activeKrs.map(k => k.title),
          memberShortNames,
          transcript: text,
          attachment: attachment ?? undefined,
        });
        setFreeformSummary(result.summary ?? "");
        setFreeformDecisions(result.decisions ?? []);
        setFreeformKrMentions(result.kr_mentions ?? []);
        setFreeformFollowUps((result.follow_up_tasks ?? []).map((t, i) => ({
          tempId: `tmp-fu-${i}`,
          member_short_name: t.member_short_name ?? "",
          content: t.content ?? "",
          due_date: t.due_date ?? "",
        })));
        setStep("review");
      } catch (e) {
        setError(formatErrorForUser("AI抽出に失敗しました", e));
        setStep("input");
      }
      return;
    }

    const targetKrs = activeKrs.filter(k => selectedKrIds.has(k.id));
    if (targetKrs.length === 0) { setError("対象KRを1つ以上選択してください。"); return; }

    setStep("extracting");
    try {
      if (mode === "checkin") {
        const result = await extractJointCheckinData({
          krs: targetKrs.map(k => ({ id: k.id, title: k.title })),
          memberShortNames,
          transcript: text,
          attachment: attachment ?? undefined,
        });
        const byKr = new Map(result.by_kr.map(r => [r.kr_id, r] as const));
        const next: KrPanelState[] = targetKrs.map(k => {
          const r = byKr.get(k.id);
          return {
            krId: k.id, krTitle: k.title, selected: true,
            checkin: r ? {
              signal: r.signal, signal_comment: r.signal_comment,
              discussion_summary: r.discussion_summary, learnings: r.learnings,
              risks: joinLines(r.risks), next_actions: joinLines(r.next_actions),
              declarations: r.declarations.map(d => ({ member_short_name: d.member_short_name, content: d.content, due_date: d.due_date })),
            } : empCheckin(),
          };
        });
        setPanels(next);
        setOverall({ summary: result.overall_analysis.summary, cross_kr_insights: result.overall_analysis.cross_kr_insights });
        setActiveTab("overall");
        setStep("review");
      } else {
        const prevByKr: Record<string, KrDeclaration[]> = {};
        for (const k of targetKrs) {
          const last = await fetchLatestCheckinSession(k.id).catch(() => null);
          prevByKr[k.id] = last ? await fetchKrDeclarations(last.id).catch(() => []) : [];
        }
        const result = await extractJointWinSessionData({
          krs: targetKrs.map(k => ({
            id: k.id, title: k.title,
            previousDeclarations: (prevByKr[k.id] ?? []).map((d, i) => ({
              index: i,
              member: memberById.get(d.member_id)?.short_name ?? "",
              content: d.content,
              due_date: d.due_date,
            })),
          })),
          memberShortNames,
          transcript: text,
          attachment: attachment ?? undefined,
        });
        const byKr = new Map(result.by_kr.map(r => [r.kr_id, r] as const));
        const next: KrPanelState[] = targetKrs.map(k => {
          const r = byKr.get(k.id);
          return {
            krId: k.id, krTitle: k.title, selected: true,
            win: r ? {
              signal: r.signal, signal_comment: r.signal_comment,
              discussion_summary: r.discussion_summary, learnings: r.learnings, external_changes: r.external_changes,
              risks: joinLines(r.risks), next_actions: joinLines(r.next_actions),
              declaration_results: r.declaration_results.map(x => ({ declaration_index: x.declaration_index, result_status: x.result_status, result_note: x.result_note })),
            } : empWin(),
            previousDeclarations: prevByKr[k.id] ?? [],
          };
        });
        setPanels(next);
        setOverall({ summary: result.overall_analysis.summary, cross_kr_insights: result.overall_analysis.cross_kr_insights });
        setActiveTab("overall");
        setStep("review");
      }
    } catch (e) {
      setError(formatErrorForUser("AI抽出に失敗しました", e));
      setStep("input");
    }
  }, [transcript, attachment, activeKrs, selectedKrIds, memberShortNames, memberById, mode, freeformPrimaryKrId]);

  // ===== KRごとのマークダウン生成（okr_analyses 保存用） =====

  const buildKrAnalysisMd = useCallback((p: KrPanelState): string => {
    const L: string[] = [];
    L.push(`# ${p.krTitle}（${mode === "checkin" ? "チェックイン" : "ウィンセッション"}）`);
    if (mode === "checkin" && p.checkin) {
      const c = p.checkin;
      if (c.signal) L.push(`**シグナル**：${c.signal === "green" ? "🟢順調" : c.signal === "yellow" ? "🟡注意" : "🔴要対応"}${c.signal_comment ? `（${c.signal_comment}）` : ""}`);
      if (c.discussion_summary) { L.push("\n## 議論サマリ"); L.push(c.discussion_summary); }
      if (c.learnings) { L.push("\n## 学び・気づき"); L.push(c.learnings); }
      const risks = splitLines(c.risks);
      if (risks.length) { L.push("\n## 気になる点・リスク"); for (const r of risks) L.push(`- ${r}`); }
      const next = splitLines(c.next_actions);
      if (next.length) { L.push("\n## 次の一手"); for (const r of next) L.push(`- ${r}`); }
      if (c.declarations.length) {
        L.push("\n## 宣言（誰が・何を・いつまでに）");
        for (const d of c.declarations) if (d.content.trim()) L.push(`- ${d.member_short_name || "（未特定）"}：${d.content}${d.due_date ? `（期日 ${d.due_date}）` : ""}`);
      }
    }
    if (mode === "win_session" && p.win) {
      const w = p.win;
      if (w.signal) L.push(`**シグナル**：${w.signal === "green" ? "🟢順調" : w.signal === "yellow" ? "🟡注意" : "🔴要対応"}${w.signal_comment ? `（${w.signal_comment}）` : ""}`);
      if (w.discussion_summary) { L.push("\n## 議論サマリ"); L.push(w.discussion_summary); }
      if (w.learnings) { L.push("\n## 学び・気づき"); L.push(w.learnings); }
      if (w.external_changes) { L.push("\n## 外部環境の変化"); L.push(w.external_changes); }
      const risks = splitLines(w.risks);
      if (risks.length) { L.push("\n## 気になる点・リスク"); for (const r of risks) L.push(`- ${r}`); }
      const next = splitLines(w.next_actions);
      if (next.length) { L.push("\n## 次の一手"); for (const r of next) L.push(`- ${r}`); }
      if (w.declaration_results.length && p.previousDeclarations?.length) {
        L.push("\n## 前回宣言の結果");
        for (const r of w.declaration_results) {
          const prev = p.previousDeclarations[r.declaration_index];
          if (!prev) continue;
          const who = memberById.get(prev.member_id)?.short_name ?? "（不明）";
          const st = r.result_status ? (r.result_status === "achieved" ? "達成" : r.result_status === "partial" ? "一部達成" : "未達") : "—";
          L.push(`- ${who}：${prev.content} → ${st}${r.result_note ? `（${r.result_note}）` : ""}`);
        }
      }
    }
    return L.join("\n").trim();
  }, [mode, memberById]);

  const buildObjectiveMd = useCallback((): string => {
    const L: string[] = [];
    L.push(`# ${mode === "checkin" ? "チェックイン" : "ウィンセッション"}（合同）の全体分析`);
    if (overall.summary) { L.push("\n## 会議全体のサマリ"); L.push(overall.summary); }
    if (overall.cross_kr_insights) { L.push("\n## KR間で見えること"); L.push(overall.cross_kr_insights); }
    return L.join("\n").trim();
  }, [mode, overall]);

  // ===== 保存 =====

  const handleSave = useCallback(async () => {
    setStep("saving");
    setError(null);
    try {
      const weekStart = getThisMonday();

      // freeform 分岐：メインKR 1つに紐づけて 1 セッション + フォローアップを保存
      if (mode === "freeform") {
        const primary = activeKrs.find(k => k.id === freeformPrimaryKrId);
        if (!primary) throw new Error("メインKRが選択されていません");
        const validFollowUps = freeformFollowUps.filter(r => r.content.trim());
        const total = 1 + validFollowUps.length;
        setProgress({ current: 0, total, label: "サマリ・決定事項を保存中…" });

        const session = await insertKrSession({
          kr_id: primary.id,
          week_start: weekStart,
          session_type: "freeform",
          signal: null,
          signal_comment: "",
          learnings: "",
          external_changes: "",
          transcript: transcript.slice(0, 200000),
          summary: freeformSummary,
          decisions: freeformDecisions.filter(d => d.trim()).join("\n"),
          kr_mentions: freeformKrMentions
            .map(m => `${m.kr_title_hint} — ${m.note}`.trim())
            .filter(s => s)
            .join("\n"),
          created_by: currentUser.id,
          updated_by: currentUser.id,
        } as Parameters<typeof insertKrSession>[0]);
        let cur = 1;
        setProgress({ current: cur, total, label: validFollowUps.length === 0 ? "完了処理…" : `フォローアップを記録中… (1/${validFollowUps.length})` });

        for (let i = 0; i < validFollowUps.length; i++) {
          const row = validFollowUps[i];
          const memberId = [...memberById.values()].find(m => m.short_name === row.member_short_name)?.id ?? currentUser.id;
          await insertKrDeclaration({
            session_id: session.id,
            member_id: memberId,
            content: row.content,
            due_date: row.due_date || null,
            result_status: null,
            result_note: "",
            updated_by: currentUser.id,
          } as Parameters<typeof insertKrDeclaration>[0]);
          cur += 1;
          setProgress({
            current: cur, total,
            label: i + 1 < validFollowUps.length
              ? `フォローアップを記録中… (${i + 2}/${validFollowUps.length})`
              : "完了処理…",
          });
        }
        setProgress({ current: total, total, label: "完了" });
        setStep("done");
        onSaved?.();
        return;
      }

      const selected = panels.filter(p => p.selected);
      // ステップ：[Objective分析] + 各KR（session, 宣言, KR分析）
      const total = (objective ? 1 : 0) + selected.reduce((n, p) => n + 1 + 1 /*kr_analysis*/ + (mode === "checkin" ? (p.checkin?.declarations.length ?? 0) : (p.win?.declaration_results.length ?? 0)), 1);
      let cur = 0;
      setProgress({ current: 0, total, label: "保存を開始しています…" });

      // 1) Objective スコープのAI分析を保存（会議全体）
      if (objective && (overall.summary.trim() || overall.cross_kr_insights.trim())) {
        setProgress(pr => ({ ...pr, current: cur, label: "全体分析を保存中…" }));
        try { await insertObjectiveAnalysis(objective.id, buildObjectiveMd(), currentUser.id, false); } catch (e) { console.warn("Objective分析の保存に失敗:", e); }
        cur++; setProgress(pr => ({ ...pr, current: cur }));
      }

      // 2) KRごとに保存
      for (const p of selected) {
        setProgress(pr => ({ ...pr, current: cur, label: `${p.krTitle} を保存中…` }));
        if (mode === "checkin") {
          const session = await insertKrSession({
            kr_id: p.krId,
            week_start: weekStart,
            session_type: "checkin",
            signal: p.checkin?.signal ?? null,
            signal_comment: p.checkin?.signal_comment ?? "",
            learnings: p.checkin?.learnings ?? "",
            external_changes: "",
            transcript: transcript.slice(0, 200000), // 文字起こしも参照用に保存（過大なら切る）
            summary: "", decisions: "", kr_mentions: "",
            created_by: currentUser.id, updated_by: currentUser.id,
          } as Parameters<typeof insertKrSession>[0]);
          cur++; setProgress(pr => ({ ...pr, current: cur }));

          // KRごとの詳細分析を okr_analyses に保存
          try { await insertOkrAnalysis(p.krId, buildKrAnalysisMd(p), currentUser.id, false); } catch (e) { console.warn("KR分析の保存に失敗:", e); }
          cur++; setProgress(pr => ({ ...pr, current: cur }));

          for (const d of (p.checkin?.declarations ?? [])) {
            if (!d.content.trim()) continue;
            const memberId = [...memberById.values()].find(m => m.short_name === d.member_short_name)?.id ?? currentUser.id;
            await insertKrDeclaration({
              session_id: session.id,
              member_id: memberId,
              content: d.content,
              due_date: d.due_date,
              result_status: null, result_note: "",
              updated_by: currentUser.id,
            } as Parameters<typeof insertKrDeclaration>[0]);
            cur++; setProgress(pr => ({ ...pr, current: cur }));
          }
        } else {
          await insertKrSession({
            kr_id: p.krId,
            week_start: weekStart,
            session_type: "win_session",
            signal: p.win?.signal ?? null,
            signal_comment: p.win?.signal_comment ?? "",
            learnings: p.win?.learnings ?? "",
            external_changes: p.win?.external_changes ?? "",
            transcript: transcript.slice(0, 200000),
            summary: "", decisions: "", kr_mentions: "",
            created_by: currentUser.id, updated_by: currentUser.id,
          } as Parameters<typeof insertKrSession>[0]);
          cur++; setProgress(pr => ({ ...pr, current: cur }));

          try { await insertOkrAnalysis(p.krId, buildKrAnalysisMd(p), currentUser.id, false); } catch (e) { console.warn("KR分析の保存に失敗:", e); }
          cur++; setProgress(pr => ({ ...pr, current: cur }));

          for (const r of (p.win?.declaration_results ?? [])) {
            const prev = p.previousDeclarations?.[r.declaration_index];
            if (!prev || !r.result_status) { cur++; continue; }
            await updateKrDeclarationResult(prev.id, r.result_status, r.result_note, currentUser.id);
            cur++; setProgress(pr => ({ ...pr, current: cur }));
          }
        }
      }
      setProgress({ current: total, total, label: "完了" });
      setStep("done");
      onSaved?.();
    } catch (e) {
      setError(formatErrorForUser("保存に失敗しました", e));
      setStep("review");
    }
  }, [panels, mode, currentUser.id, memberById, onSaved, transcript, objective, overall, buildKrAnalysisMd, buildObjectiveMd,
      activeKrs, freeformPrimaryKrId, freeformFollowUps, freeformSummary, freeformDecisions, freeformKrMentions]);

  const handleReset = () => {
    setTranscript(""); setAttachment(null); setPanels([]); setOverall({ summary: "", cross_kr_insights: "" }); setActiveTab("overall");
    setFreeformSummary(""); setFreeformDecisions([]); setFreeformKrMentions([]); setFreeformFollowUps([]);
    setError(null); setStep("input");
  };

  // ===== 描画 =====

  const inputCount = transcript.trim().length;
  const canExtract = (inputCount >= 20 || !!attachment) && (
    mode === "freeform" ? !!freeformPrimaryKrId : selectedKrIds.size > 0
  );

  if (step === "extracting") {
    const phases = mode === "checkin" ? PHASES_CHECKIN
                 : mode === "win_session" ? PHASES_WIN
                 : PHASES_FREEFORM;
    return <div style={{ padding: "32px 24px" }}><AIProgressLoader phases={phases} intervalMs={4500} /></div>;
  }
  if (step === "saving") {
    return <div style={{ padding: "32px 24px" }}><SaveProgressLoader current={progress.current} total={progress.total} label={progress.label} title="セッションと分析を保存しています" /></div>;
  }
  if (step === "done") {
    const doneDetail = mode === "freeform"
      ? "OKR議論（summary・決定事項・フォローアップ）を記録しました"
      : `${panels.filter(p => p.selected).length} 件のKRぶんを記録＆分析しました`;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "40px 20px" }}>
        <div style={{ fontSize: "44px" }}>🎉</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>保存が完了しました</div>
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{doneDetail}</div>
        <button onClick={handleReset} style={primaryBtn}>続けて別のセッションを記録する</button>
      </div>
    );
  }

  if (step === "review" && mode === "freeform") {
    const primary = activeKrs.find(k => k.id === freeformPrimaryKrId);
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>AI抽出結果を確認・修正してください</span>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>メインKR「{primary?.title ?? "—"}」に紐付けて保存します</span>
            <div style={{ flex: 1 }} />
            <button onClick={handleReset} style={ghostBtn}>やり直す</button>
          </div>

          <Field label="議論サマリ">
            <TextArea value={freeformSummary} onChange={setFreeformSummary} rows={6} placeholder="会議全体のサマリ" />
          </Field>

          <div>
            <Label>決定事項（{freeformDecisions.length}件）</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {freeformDecisions.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: "6px" }}>
                  <input type="text" value={d}
                    onChange={e => setFreeformDecisions(freeformDecisions.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="決定内容"
                    style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => setFreeformDecisions(freeformDecisions.filter((_, j) => j !== i))}
                    style={{ ...ghostBtn, padding: "5px 8px" }} title="削除">✕</button>
                </div>
              ))}
              <button onClick={() => setFreeformDecisions([...freeformDecisions, ""])}
                style={{ ...ghostBtn, alignSelf: "flex-start" }}>＋ 決定事項を追加</button>
            </div>
          </div>

          <div>
            <Label>言及されたKR / TF（{freeformKrMentions.length}件）</Label>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "5px" }}>
              AIが推測したタイトルです。必要に応じて言及内容を編集してください
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {freeformKrMentions.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <input type="text" value={m.kr_title_hint}
                    onChange={e => setFreeformKrMentions(freeformKrMentions.map((x, j) => j === i ? { ...x, kr_title_hint: e.target.value } : x))}
                    placeholder="KR/TF タイトル"
                    style={{ ...inputStyle, flex: "1 1 240px" }} />
                  <input type="text" value={m.note}
                    onChange={e => setFreeformKrMentions(freeformKrMentions.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                    placeholder="言及内容"
                    style={{ ...inputStyle, flex: "2 1 280px" }} />
                  <button onClick={() => setFreeformKrMentions(freeformKrMentions.filter((_, j) => j !== i))}
                    style={{ ...ghostBtn, padding: "5px 8px" }} title="削除">✕</button>
                </div>
              ))}
              <button onClick={() => setFreeformKrMentions([...freeformKrMentions, { kr_title_hint: "", note: "" }])}
                style={{ ...ghostBtn, alignSelf: "flex-start" }}>＋ KR/TF言及を追加</button>
            </div>
          </div>

          <div>
            <Label>フォローアップタスク候補（{freeformFollowUps.length}件）</Label>
            <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "5px" }}>
              メインKRに紐づく宣言として保存されます（result_status 未設定）
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {freeformFollowUps.map(row => (
                <div key={row.tempId} style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <select value={row.member_short_name}
                    onChange={e => setFreeformFollowUps(freeformFollowUps.map(r => r.tempId === row.tempId ? { ...r, member_short_name: e.target.value } : r))}
                    style={selStyleSm}>
                    <option value="">（誰）</option>
                    {memberShortNames.map(n => <option key={n} value={n}>{n}</option>)}
                    {!memberShortNames.includes(row.member_short_name) && row.member_short_name && (
                      <option value={row.member_short_name}>{row.member_short_name}</option>
                    )}
                  </select>
                  <input type="text" value={row.content}
                    onChange={e => setFreeformFollowUps(freeformFollowUps.map(r => r.tempId === row.tempId ? { ...r, content: e.target.value } : r))}
                    placeholder="タスク内容"
                    style={{ ...inputStyle, flex: 1, minWidth: "200px" }} />
                  <input type="date" value={row.due_date}
                    onChange={e => setFreeformFollowUps(freeformFollowUps.map(r => r.tempId === row.tempId ? { ...r, due_date: e.target.value } : r))}
                    style={selStyleSm} />
                  <button onClick={() => setFreeformFollowUps(freeformFollowUps.filter(r => r.tempId !== row.tempId))}
                    style={{ ...ghostBtn, padding: "5px 8px" }} title="削除">✕</button>
                </div>
              ))}
              <button onClick={() => setFreeformFollowUps([...freeformFollowUps, {
                tempId: `tmp-fu-${Date.now()}`, member_short_name: "", content: "", due_date: "",
              }])} style={{ ...ghostBtn, alignSelf: "flex-start" }}>＋ フォローアップを追加</button>
            </div>
          </div>

          {error && <ErrBox>{error}</ErrBox>}
        </div>

        <div style={{ flexShrink: 0, padding: "10px 20px", borderTop: "1px solid var(--color-border-primary)", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>
            保存すると kr_sessions（session_type=freeform）＋ フォローアップが kr_declarations に保存されます。
          </div>
          <button onClick={handleSave} disabled={!freeformPrimaryKrId} style={{ ...primaryBtn, opacity: freeformPrimaryKrId ? 1 : 0.5 }}>
            OKR議論を保存
          </button>
        </div>
      </div>
    );
  }

  if (step === "review") {
    const cur = activeTab === "overall" ? null : (panels.find(p => p.krId === activeTab) ?? null);
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>AI分析・抽出結果を確認・修正してください</span>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>「全体」タブには会議全体の所感、各KRタブには議論サマリ・学び・リスク・次の一手・宣言が入ります。</span>
            <div style={{ flex: 1 }} />
            <button onClick={handleReset} style={ghostBtn}>やり直す</button>
          </div>

          {/* タブ：全体 + KRごと */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "6px" }}>
            <button onClick={() => setActiveTab("overall")} style={tabBtn(activeTab === "overall")}>全体（Objective）</button>
            {panels.map(p => (
              <button key={p.krId} onClick={() => setActiveTab(p.krId)} style={{ ...tabBtn(activeTab === p.krId), display: "flex", alignItems: "center", gap: "6px" }}>
                <input type="checkbox" checked={p.selected}
                  onClick={e => e.stopPropagation()}
                  onChange={e => { const v = e.target.checked; setPanels(prev => prev.map(q => q.krId === p.krId ? { ...q, selected: v } : q)); }}
                  style={{ accentColor: "var(--color-brand)" }} />
                {p.krTitle.length > 22 ? p.krTitle.slice(0, 22) + "…" : p.krTitle}
              </button>
            ))}
          </div>

          {activeTab === "overall" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <Field label="会議全体のサマリ"><TextArea value={overall.summary} onChange={v => setOverall(o => ({ ...o, summary: v }))} rows={6} placeholder="議論の流れ・対立・合意のまとめ" /></Field>
              <Field label="KR間で見えること（依存・矛盾・温度差など）"><TextArea value={overall.cross_kr_insights} onChange={v => setOverall(o => ({ ...o, cross_kr_insights: v }))} rows={5} /></Field>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>※ Objective に紐づく分析として保存されます。各KRタブも確認のうえ保存してください。</div>
            </div>
          )}

          {cur && cur.selected && mode === "checkin" && cur.checkin && (
            <CheckinReview
              draft={cur.checkin}
              memberShortNames={memberShortNames}
              onChange={patch => setPanels(prev => prev.map(q => q.krId === cur.krId ? { ...q, checkin: { ...cur.checkin!, ...patch } } : q))}
            />
          )}
          {cur && cur.selected && mode === "win_session" && cur.win && (
            <WinReview
              draft={cur.win}
              previousDeclarations={cur.previousDeclarations ?? []}
              memberById={memberById}
              onChange={patch => setPanels(prev => prev.map(q => q.krId === cur.krId ? { ...q, win: { ...cur.win!, ...patch } } : q))}
            />
          )}
          {cur && !cur.selected && (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>このKRは保存対象から外れています。タブ内のチェックでON/OFFできます。</div>
          )}

          {error && <ErrBox>{error}</ErrBox>}
        </div>

        {/* sticky 保存バー */}
        <div style={{ flexShrink: 0, padding: "10px 20px", borderTop: "1px solid var(--color-border-primary)", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>保存すると、KRごとに kr_sessions・kr_declarations・KRの詳細分析（okr_analyses）が、会議全体は Objective分析として保存されます。</div>
          <button onClick={handleSave} disabled={panels.filter(p => p.selected).length === 0} style={{ ...primaryBtn, opacity: panels.filter(p => p.selected).length === 0 ? 0.5 : 1 }}>
            {mode === "checkin" ? "チェックインと分析を保存" : "ウィンセッションと分析を保存"}（{panels.filter(p => p.selected).length} KR）
          </button>
        </div>
      </div>
    );
  }

  // step === "input"
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>
            {mode === "freeform"
              ? "戦略会議・四半期計画など自由形式のOKR議論。議事メモから「議論サマリ・決定事項・言及KR/TF・フォローアップ」を抽出します。"
              : "合同会議の議事メモを投入すると、AIが文字起こしを詳細に分析し、KRごとに「議論サマリ・学び・リスク・次の一手・宣言・シグナル」を整理します。"}
          </div>
          <HelpButton modeKey="okr.session" title="② セッション記録&分析の使い方を開く" />
          {onClose && (
            <button onClick={onClose} aria-label="閉じる" title="閉じる" style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: "18px", color: "var(--color-text-tertiary)", padding: "2px 6px",
            }}>✕</button>
          )}
        </div>

        {/* モード */}
        <div>
          <Label>セッションの種類</Label>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {([
              { v: "checkin" as const,     label: "チェックイン" },
              { v: "win_session" as const, label: "ウィンセッション" },
              { v: "freeform" as const,    label: "その他のOKR議論（自由形式）" },
            ]).map(opt => (
              <button key={opt.v} onClick={() => setMode(opt.v)} style={modeBtn(mode === opt.v)}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* 対象KR（mode で UI が切り替わる） */}
        {mode === "freeform" ? (
          <div>
            <Label>メインKR（議論の主軸になる KR を1つ。kr_mentions で他KRも記録可）</Label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {activeKrs.length === 0 && <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>KRが登録されていません</span>}
              {activeKrs.map(k => {
                const on = freeformPrimaryKrId === k.id;
                return (
                  <button key={k.id} onClick={() => setFreeformPrimaryKrId(k.id)} style={chipBtn(on)}>
                    <span>{on ? "●" : "○"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <Label>対象KR（複数選択可・既定は全KR）</Label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {activeKrs.length === 0 && <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>KRが登録されていません</span>}
              {activeKrs.map(k => {
                const on = selectedKrIds.has(k.id);
                return (
                  <button key={k.id} onClick={() => toggleKr(k.id)} style={chipBtn(on)}>
                    <span>{on ? "✓" : "○"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 議事メモ入力 */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
            <Label>議事メモ / 文字起こし</Label>
            <button onClick={() => vttInputRef.current?.click()} style={ghostBtn} title=".vtt / .srt / .txt を選択して本文に読み込み">📄 ファイルから読み込む（.vtt 等）</button>
            <input ref={vttInputRef} type="file" accept=".vtt,.srt,.txt,.text,text/plain,text/vtt" style={{ display: "none" }} onChange={handlePickTextFile} />
            <FileAttachButton attachment={attachment} onAttach={setAttachment} onRemove={() => setAttachment(null)} />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{inputCount.toLocaleString()} 文字</span>
          </div>
          <FileDropZone onAttach={setAttachment}>
            <div ref={dropAreaRef} onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDropToTextarea}>
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                placeholder={attachment ? "添付ファイルがある場合は空欄でも分析できます。補足メモを足しても可。" : "合同会議の文字起こし・議事メモをここに貼り付け／📄ボタンで .vtt 読み込み／PDF・Word は📎で添付できます。"}
                rows={12}
                style={{
                  width: "100%", padding: "10px 12px", fontSize: "12px",
                  border: `1px solid ${isDragging ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                  borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
                  resize: "vertical", lineHeight: 1.6, boxSizing: "border-box", fontFamily: "monospace",
                }}
              />
            </div>
          </FileDropZone>
        </div>

        {error && <ErrBox>{error}</ErrBox>}
      </div>

      {/* sticky 抽出バー（スクロール不要） */}
      <div style={{ flexShrink: 0, padding: "10px 20px", borderTop: "1px solid var(--color-border-primary)", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>
          {!canExtract
            ? (mode === "freeform"
                ? "議事メモまたは添付ファイルと、メインKRを選択してください"
                : "議事メモまたは添付ファイルと、対象KRを1つ以上選択してください")
            : mode === "freeform"
              ? "メインKRに紐付けて議論サマリ・決定事項・言及KR・フォローアップを整理します"
              : `${selectedKrIds.size} KR について、議事メモを詳細分析→KRごとに整理します`}
        </div>
        <button onClick={handleExtract} disabled={!canExtract} style={{ ...primaryBtn, opacity: canExtract ? 1 : 0.5, cursor: canExtract ? "pointer" : "not-allowed" }}>
          ✨ AIで詳細分析・抽出する
        </button>
      </div>
    </div>
  );
}

// ===== レビューUI部品 =====

function CheckinReview({ draft, memberShortNames, onChange }: {
  draft: CheckinDraft;
  memberShortNames: string[];
  onChange: (patch: Partial<CheckinDraft>) => void;
}) {
  const updateDecl = (i: number, patch: Partial<CheckinDraft["declarations"][number]>) => {
    onChange({ declarations: draft.declarations.map((d, j) => j === i ? { ...d, ...patch } : d) });
  };
  const addDecl = () => onChange({ declarations: [...draft.declarations, { member_short_name: "", content: "", due_date: null }] });
  const removeDecl = (i: number) => onChange({ declarations: draft.declarations.filter((_, j) => j !== i) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <SignalRow value={draft.signal} comment={draft.signal_comment} onChange={(s, c) => onChange({ signal: s, signal_comment: c })} />
      <Field label="議論サマリ（このKRに関する議論の要点）"><TextArea value={draft.discussion_summary} onChange={v => onChange({ discussion_summary: v })} rows={4} /></Field>
      <Field label="学び・気づき"><TextArea value={draft.learnings} onChange={v => onChange({ learnings: v })} rows={3} /></Field>
      <Field label="気になる点・リスク（1行1件）"><TextArea value={draft.risks} onChange={v => onChange({ risks: v })} rows={3} placeholder="- 〇〇が止まっている&#10;- △△の判断が未決" /></Field>
      <Field label="次の一手（1行1件）"><TextArea value={draft.next_actions} onChange={v => onChange({ next_actions: v })} rows={3} placeholder="- 来週△△までに〇〇" /></Field>
      <div>
        <Label>宣言（誰が・何を・いつまでに）</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {draft.declarations.length === 0 && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>このKRに該当する宣言はAIが検出しませんでした。必要があれば「＋ 宣言を追加」してください。</div>}
          {draft.declarations.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <select value={d.member_short_name} onChange={e => updateDecl(i, { member_short_name: e.target.value })} style={selStyleSm}>
                <option value="">（誰）</option>
                {memberShortNames.map(n => <option key={n} value={n}>{n}</option>)}
                {!memberShortNames.includes(d.member_short_name) && d.member_short_name && <option value={d.member_short_name}>{d.member_short_name}</option>}
              </select>
              <input type="text" value={d.content} onChange={e => updateDecl(i, { content: e.target.value })} placeholder="宣言内容" style={{ ...inputStyle, flex: 1, minWidth: "200px" }} />
              <input type="date" value={d.due_date ?? ""} onChange={e => updateDecl(i, { due_date: e.target.value || null })} style={selStyleSm} />
              <button onClick={() => removeDecl(i)} style={{ ...ghostBtn, padding: "5px 8px" }} title="削除">✕</button>
            </div>
          ))}
          <button onClick={addDecl} style={{ ...ghostBtn, alignSelf: "flex-start" }}>＋ 宣言を追加</button>
        </div>
      </div>
    </div>
  );
}

function WinReview({ draft, previousDeclarations, memberById, onChange }: {
  draft: WinDraft;
  previousDeclarations: KrDeclaration[];
  memberById: Map<string, Member>;
  onChange: (patch: Partial<WinDraft>) => void;
}) {
  const setResult = (i: number, patch: Partial<WinDraft["declaration_results"][number]>) => {
    const cur = draft.declaration_results;
    const found = cur.findIndex(r => r.declaration_index === i);
    let next: WinDraft["declaration_results"];
    if (found >= 0) next = cur.map((r, j) => j === found ? { ...r, ...patch } : r);
    else next = [...cur, { declaration_index: i, result_status: null, result_note: "", ...patch }];
    onChange({ declaration_results: next });
  };
  const getResult = (i: number) => draft.declaration_results.find(r => r.declaration_index === i) ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <SignalRow value={draft.signal} comment={draft.signal_comment} onChange={(s, c) => onChange({ signal: s, signal_comment: c })} />
      <Field label="議論サマリ（このKRに関する議論の要点）"><TextArea value={draft.discussion_summary} onChange={v => onChange({ discussion_summary: v })} rows={4} /></Field>
      <Field label="学び・気づき"><TextArea value={draft.learnings} onChange={v => onChange({ learnings: v })} rows={3} /></Field>
      <Field label="外部環境の変化（任意）"><TextArea value={draft.external_changes} onChange={v => onChange({ external_changes: v })} rows={2} /></Field>
      <Field label="気になる点・リスク（1行1件）"><TextArea value={draft.risks} onChange={v => onChange({ risks: v })} rows={3} /></Field>
      <Field label="次の一手（1行1件）"><TextArea value={draft.next_actions} onChange={v => onChange({ next_actions: v })} rows={3} /></Field>
      <div>
        <Label>前回チェックイン宣言の結果</Label>
        {previousDeclarations.length === 0 && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>前回のチェックイン宣言は見つかりませんでした。</div>}
        {previousDeclarations.map((pd, i) => {
          const r = getResult(i);
          const who = memberById.get(pd.member_id)?.short_name ?? "（不明）";
          return (
            <div key={pd.id} style={{ display: "flex", gap: "6px", alignItems: "flex-start", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px dashed var(--color-border-primary)" }}>
              <div style={{ flex: "1 1 280px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{who}</span>：{pd.content}{pd.due_date ? ` （期日: ${pd.due_date}）` : ""}
              </div>
              <select value={r?.result_status ?? ""} onChange={e => setResult(i, { result_status: (e.target.value || null) as WinDraft["declaration_results"][number]["result_status"] })} style={selStyleSm}>
                <option value="">—</option>
                <option value="achieved">達成</option>
                <option value="partial">一部達成</option>
                <option value="not_achieved">未達</option>
              </select>
              <input type="text" value={r?.result_note ?? ""} onChange={e => setResult(i, { result_note: e.target.value })} placeholder="メモ（任意）" style={{ ...inputStyle, flex: "1 1 200px" }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignalRow({ value, comment, onChange }: {
  value: "green" | "yellow" | "red" | null;
  comment: string;
  onChange: (signal: "green" | "yellow" | "red" | null, comment: string) => void;
}) {
  const opts: { v: "green" | "yellow" | "red" | null; label: string; color: string }[] = [
    { v: "green", label: "🟢 順調", color: "#16a34a" },
    { v: "yellow", label: "🟡 注意", color: "#ca8a04" },
    { v: "red", label: "🔴 要対応", color: "#dc2626" },
    { v: null, label: "—", color: "var(--color-text-tertiary)" },
  ];
  return (
    <div>
      <Label>シグナル</Label>
      <div style={{ display: "flex", gap: "5px", marginBottom: "6px", flexWrap: "wrap" }}>
        {opts.map(o => (
          <button key={String(o.v)} onClick={() => onChange(o.v, comment)} style={{
            fontSize: "12px", padding: "5px 12px", borderRadius: "var(--radius-md)",
            border: value === o.v ? `1.5px solid ${o.color}` : "1px solid var(--color-border-primary)",
            background: value === o.v ? `${o.color}18` : "var(--color-bg-primary)",
            color: value === o.v ? o.color : "var(--color-text-secondary)",
            cursor: "pointer", fontWeight: value === o.v ? 600 : 400,
          }}>{o.label}</button>
        ))}
      </div>
      <TextArea value={comment} onChange={v => onChange(value, v)} rows={2} placeholder="シグナルの根拠・補足コメント" />
    </div>
  );
}

// ===== スタイル ＆ 共通部品 =====

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

const inputStyle: React.CSSProperties = {
  padding: "6px 9px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box",
};
const selStyleSm: React.CSSProperties = { ...inputStyle, padding: "6px 8px", minWidth: "100px" };
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
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "5px 11px", borderRadius: "var(--radius-md)",
  border: active ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
  background: active ? "var(--color-brand-light)" : "var(--color-bg-primary)",
  color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor: "pointer", fontSize: "12px", fontWeight: active ? 600 : 400,
});
const modeBtn = (active: boolean): React.CSSProperties => ({
  fontSize: "12px", padding: "6px 14px", borderRadius: "var(--radius-md)",
  border: active ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
  background: active ? "var(--color-brand-light)" : "var(--color-bg-primary)",
  color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor: "pointer", fontWeight: active ? 600 : 400,
});
const chipBtn = (on: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "var(--radius-full)",
  border: on ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
  background: on ? "var(--color-brand-light)" : "var(--color-bg-primary)",
  color: on ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor: "pointer", fontSize: "11px", fontWeight: on ? 600 : 400, maxWidth: "320px",
});
