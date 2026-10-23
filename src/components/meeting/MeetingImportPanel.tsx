// src/components/meeting/MeetingImportPanel.tsx
//
// 【設計意図】
// 会議の文字起こし（VTT/SRT/テキスト貼り付け）を読み込み、
// AIがタスク提案・ステータス更新候補・決定事項・リスクを抽出する。
// ユーザーが各提案をレビュー・編集してから一括登録する。
// ラボ機能例外ルール適用：PJ・タスク・メンバー情報をAIに渡す。

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedMembers } from "../../stores/appStore";
import type { Member, Task } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import { resolveAiScope } from "../../lib/ai/aiTarget";
import {
  parseTranscript,
  extractMeetingData,
  type MeetingAnalysis,
} from "../../lib/ai/meetingExtractor";
import {
  applyMeetingDrafts, buildStatusDrafts, buildTaskDrafts, describeApplyShortfall, type StatusDraft, type TaskDraft,
} from "../../lib/ai/meetingDrafts";
import {
  hasReviewContent, takeRestorableMeetingDraft, useMeetingImportDraftStore,
} from "../../stores/meetingImportDraftStore";
import { useUnsavedEditor } from "../../hooks/useUnsavedEditor";
import { confirmDialog } from "../../lib/dialog";
import type { FileAttachment } from "../../lib/ai/invokeAI";
import { extractDocxText, isDocxFile } from "../../lib/docxText";
import { extractHtmlText, isHtmlFile } from "../../lib/htmlText";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { SaveProgressLoader } from "../common/SaveProgressLoader";
import { formatErrorForUser } from "../../lib/errorMessage";
import { CustomSelect } from "../common/CustomSelect";
import { TASK_STATUS_LABEL, TASK_STATUS_STYLE, TASK_PRIORITY_LABEL } from "../../lib/taskMeta";

const MEETING_PHASES = [
  "テキストを読み込んでいます",
  "タスク候補を抽出しています",
  "ステータス変更を確認しています",
  "決定事項・リスクを整理しています",
  "結果をまとめています",
];

// ===== 定数 =====

const MAX_TRANSCRIPT_CHARS = 30000;
// 読み込み時の安全上限（画面が固まらないための値）。AIに渡す30,000字は、タイムスタンプ等を除いた整形後の文字数で数える。
// 読み込み時に30,000字で切ると、VTT/SRTでは整形後に収まる分まで捨ててしまい、超過の警告も出なかった（v3.183）
const MAX_RAW_CHARS = 1_000_000;
const capRawText = (text: string): string => (text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text);

// ラベルは taskMeta.ts（アプリ全体の単一の真実源）から取得し、他画面（リスト/カンバン等）との表記統一を保つ
const PRIORITY_OPTIONS: { value: "high" | "mid" | "low"; label: string }[] = (
  ["high", "mid", "low"] as const
).map(value => ({ value, label: TASK_PRIORITY_LABEL[value] }));

// ===== Props =====

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
  /** AIパネルの「対象PJ」。null＝すべてのPJ（アーカイブ・完了を除く）／id＝そのPJだけ。PJの候補とタスクの一覧がこの範囲になる */
  targetPjId?: string | null;
}

type Step = "input" | "analyzing" | "review" | "applying" | "done";

// ===== メインコンポーネント =====

export function MeetingImportPanel({ onClose, currentUser, inline = false, targetPjId = null }: Props) {
  const allProjects = useAppStore(selectScopedProjects);
  const allTasks    = useAppStore(selectScopedTasks);
  const allMembers  = useAppStore(selectScopedMembers);
  // 既存タスクの担当者名の解決は全件（他部署の担当者が空欄にならないように）。候補・AIに渡す部署メンバー一覧は表示部署（v3.139）
  const everyMember = useAppStore(s => s.members);
  const saveTask    = useAppStore(s => s.saveTask);
  const saveProject = useAppStore(s => s.saveProject);

  const taskProjects = useAppStore(s => s.taskProjects);
  // AIに渡すPJ・タスクの範囲は aiTarget.ts が決める（アーカイブ済みPJのタスクと完了・中止のタスクは送らない）
  const aiScope = useMemo(
    () => resolveAiScope({
      projects: allProjects, tasks: allTasks, taskProjects, targetPjId, includeProjectlessTasks: true,
    }),
    [allProjects, allTasks, taskProjects, targetPjId],
  );
  const projects = useMemo(() => aiScope.projects.map(sp => sp.project), [aiScope]);
  const tasks = aiScope.openTasks;
  const members = useMemo(
    () => active(allMembers),
    [allMembers],
  );

  // 確認画面の下書きはパネルの外のストアに持つ（v3.184・M84）。タブ切替でこのパネルがアンマウントされても、戻ったら復元する
  const [restored] = useState(() => takeRestorableMeetingDraft(currentUser.id));
  const [step, setStep] = useState<Step>(restored ? "review" : "input");
  const [rawText, setRawText] = useState("");
  const [pendingNewProjName, setPendingNewProjName] = useState(restored?.newProjName ?? "");
  const [pendingNewProjColor, setPendingNewProjColor] = useState(restored?.newProjColor ?? "#6366f1");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(restored?.analysis ?? null);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>(restored?.taskDrafts ?? []);
  const [statusDrafts, setStatusDrafts] = useState<StatusDraft[]>(restored?.statusDrafts ?? []);
  const [applyResults, setApplyResults] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number; label: string }>({
    current: 0, total: 1, label: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const dropAreaRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const [isDragging, setIsDragging] = useState(false);
  // PDF はクライアント側でテキスト抽出してから軽量なテキスト添付として渡す（v3.79。
  // 抽出できない場合はbuildPdfAttachment内で自動的にbase64直送へフォールバックする。
  // CLAUDE.md Section 19 ⑦・27・28参照）。Word(.docx) はテキスト抽出して rawText に入れる。
  const [pdfAttachment, setPdfAttachment] = useState<FileAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // ===== ファイル読み込み =====

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    // PDF：クライアント側でテキスト抽出してから軽量なテキスト添付として渡す（v3.79。
    // 抽出結果が空・抽出自体が失敗した場合はbuildPdfAttachment内で自動的にbase64直送へ
    // フォールバックする。ただしテキスト層が無く、かつ PDF_BASE64_FALLBACK_MAX_BYTES を
    // 超える場合は例外を投げる（546を踏ませず、次にすべきことが分かる文言を出すため。
    // v3.79・Section 37）。したがってfileErrorになるのは「サイズ超過」と「base64の
    // 読み込み自体の失敗」の2通り。CLAUDE.md Section 19 ⑦・27・28・37参照）
    if (ext === "pdf" || file.type === "application/pdf") {
      import("../../lib/pdfAttachment")
        .then(({ buildPdfAttachment }) => buildPdfAttachment(file))
        .then(att => { setPdfAttachment(att); setRawText(""); })
        .catch((e: unknown) => setFileError(e instanceof Error ? e.message : "PDFの読み込みに失敗しました。"));
      return;
    }
    // Word(.docx)：本文テキストを抽出
    if (isDocxFile(file)) {
      extractDocxText(file)
        .then(text => { setPdfAttachment(null); setRawText(capRawText(text)); })
        .catch((e: unknown) => setFileError(e instanceof Error ? e.message : "Wordファイルの読み込みに失敗しました。"));
      return;
    }
    // HTML(.html/.htm)：本文テキストを抽出（raw HTML ではなく textContent を渡す）
    if (isHtmlFile(file)) {
      extractHtmlText(file)
        .then(text => { setPdfAttachment(null); setRawText(capRawText(text)); })
        .catch((e: unknown) => setFileError(e instanceof Error ? e.message : "HTMLファイルの読み込みに失敗しました。"));
      return;
    }
    // それ以外：テキストとして読み込む（.vtt / .srt / .txt 等）
    const reader = new FileReader();
    reader.onload = e => {
      setPdfAttachment(null);
      const text = (e.target?.result as string) ?? "";
      setRawText(capRawText(text));
    };
    reader.onerror = () => setFileError("ファイルの読み込みに失敗しました。");
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ===== AI 解析 =====

  // 解析中の二重起動（Ctrl+Enterの連打・ボタンとの重なり）で2回課金しない
  const analyzingRef = useRef(false);

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim();
    if (!text && !pdfAttachment) return;
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setError(null);
    setStep("analyzing");

    try {
      const cleaned = text ? parseTranscript(text) : "";
      const today = new Date().toISOString().slice(0, 10);

      const result = await extractMeetingData({
        transcript: cleaned.length > MAX_TRANSCRIPT_CHARS
          ? cleaned.slice(0, MAX_TRANSCRIPT_CHARS)
          : cleaned,
        projects: projects.map(p => ({ id: p.id, name: p.name })),
        tasks: tasks.map(t => ({
          id: t.id,
          name: t.name,
          assignee: everyMember.find(m => m.id === t.assignee_member_id)?.short_name ?? "",
          status: t.status,
          due_date: t.due_date,
        })),
        members: members.map(m => ({ short_name: m.short_name })),
        today,
        attachment: pdfAttachment,
      });

      // 対象PJを1つに絞っているときは、PJのヒントが無い新規タスクの初期値をそのPJにする（M85）
      const nextTasks = buildTaskDrafts(result.new_tasks, members, projects, currentUser.id, targetPjId);
      const nextStatus = buildStatusDrafts(result.status_updates, new Set(tasks.map(t => t.id)));
      setAnalysis(result);
      setTaskDrafts(nextTasks);
      setStatusDrafts(nextStatus);
      createdProjectIdRef.current = null;
      // 解析中にタブを切り替えてパネルが消えていても、AI課金済みの結果を失わない
      if (hasReviewContent(nextTasks, nextStatus)) {
        useMeetingImportDraftStore.getState().saveDraft({
          userId: currentUser.id, analysis: result, taskDrafts: nextTasks, statusDrafts: nextStatus,
          newProjName: "", newProjColor: "#6366f1", createdProjectId: null,
        });
      } else {
        useMeetingImportDraftStore.getState().clearDraft();
      }

      setStep("review");
    } catch (e) {
      setError(formatErrorForUser("AI解析に失敗しました", e));
      setStep("input");
    } finally {
      analyzingRef.current = false;
    }
  }, [rawText, pdfAttachment, projects, tasks, members, everyMember, currentUser.id, targetPjId]);

  // ===== 適用 =====

  // 前回の登録で作成済みの新規PJ。途中で失敗して再登録しても、同じPJを二重に作らない
  const createdProjectIdRef = useRef<string | null>(restored?.createdProjectId ?? null);
  const applyingRef = useRef(false);

  // 確認画面にいる間は下書きをストアへ写す（編集のたびに追従）。項目が無ければ保持しない
  useEffect(() => {
    if (step !== "review" || !analysis) return;
    if (!hasReviewContent(taskDrafts, statusDrafts)) {
      useMeetingImportDraftStore.getState().clearDraft();
      return;
    }
    useMeetingImportDraftStore.getState().saveDraft({
      userId: currentUser.id, analysis, taskDrafts, statusDrafts,
      newProjName: pendingNewProjName, newProjColor: pendingNewProjColor,
      createdProjectId: createdProjectIdRef.current,
    });
  }, [step, analysis, taskDrafts, statusDrafts, pendingNewProjName, pendingNewProjColor, currentUser.id]);

  // タブ切替ではストアから復元できるが、ログアウト・再読み込み・部署切替などはメモリごと消える。
  // その経路では未保存編集レジストリ（Section 46）の確認を出す。ビュー切替は下書きが残るので出さない
  // （survivesViewSwitch・v3.185）。登録中（保存の最中）は下書きを外してあるため、切替でも確認する
  useUnsavedEditor(
    (step === "review" && hasReviewContent(taskDrafts, statusDrafts)) || step === "applying",
    { survivesViewSwitch: step !== "applying" },
  );

  const handleApply = useCallback(async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setStep("applying");
    setError(null);
    // 登録中にパネルが消えても、保存済みの下書きが復元されて二重登録にならないよう、いったん外す
    useMeetingImportDraftStore.getState().clearDraft();

    try {
      const outcome = await applyMeetingDrafts(
        {
          taskDrafts, statusDrafts, currentUserId: currentUser.id,
          newProject: { name: pendingNewProjName, color: pendingNewProjColor },
          createdProjectId: createdProjectIdRef.current,
        },
        {
          saveTask, saveProject,
          // 更新対象は、AIの対象PJの範囲ではなく表示部署のタスクから引く（登録前に対象PJを変えても更新が黙って落ちない）
          findTask: id => allTasks.find(t => t.id === id && !t.is_deleted),
          onProgress: (current, total, label) => setSaveProgress({ current, total, label }),
        },
      );
      createdProjectIdRef.current = outcome.createdProjectId;

      if (outcome.error) {
        // 保存できた分は画面から外す（残したまま再登録すると同じタスクが二重に作られる）。
        // 失敗した分と、連続失敗で手を付けていない分は残し、再試行の対象にする
        const savedTasks = new Set(outcome.savedTaskTempIds);
        const gone = new Set([...outcome.savedStatusTempIds, ...outcome.skippedStatusTempIds]);
        setTaskDrafts(prev => prev.filter(d => !savedTasks.has(d.tempId)));
        setStatusDrafts(prev => prev.filter(d => !gone.has(d.tempId)));
        const shortfall = describeApplyShortfall(outcome);
        setError(`${formatErrorForUser("登録に失敗しました", outcome.error)}${shortfall ? `。${shortfall}` : ""}`);
        setStep("review");
        // 登録中にパネルが消えていても、残りを後から開いて再試行できるよう、ストアへも書く
        if (analysis) {
          const keptTasks = taskDrafts.filter(d => !savedTasks.has(d.tempId));
          const keptStatus = statusDrafts.filter(d => !gone.has(d.tempId));
          if (hasReviewContent(keptTasks, keptStatus)) {
            useMeetingImportDraftStore.getState().saveDraft({
              userId: currentUser.id, analysis, taskDrafts: keptTasks, statusDrafts: keptStatus,
              newProjName: pendingNewProjName, newProjColor: pendingNewProjColor,
              createdProjectId: outcome.createdProjectId,
            });
          }
        }
        return;
      }

      useMeetingImportDraftStore.getState().clearDraft();
      setApplyResults({ created: outcome.created, updated: outcome.updated, skipped: outcome.skipped });
      setStep("done");
    } finally {
      applyingRef.current = false;
    }
  }, [taskDrafts, statusDrafts, analysis, allTasks, currentUser, saveTask, saveProject, pendingNewProjName, pendingNewProjColor]);

  const handleReset = () => {
    setStep("input");
    setRawText("");
    setPdfAttachment(null);
    setFileError(null);
    setError(null);
    setAnalysis(null);
    setTaskDrafts([]);
    setStatusDrafts([]);
    setApplyResults(null);
    createdProjectIdRef.current = null;
    useMeetingImportDraftStore.getState().clearDraft();
  };

  // 確認画面の「やり直す」は、AI課金済みの内容を捨てる操作なので、取り込み済みの項目があるときだけ確認する
  const requestReset = async () => {
    if (hasReviewContent(taskDrafts, statusDrafts)) {
      const ok = await confirmDialog("確認画面の内容は破棄されます。最初からやり直しますか？", {
        tone: "danger", confirmLabel: "破棄してやり直す",
      });
      if (!ok) return;
    }
    handleReset();
  };

  const checkedTaskCount = taskDrafts.filter(d => d.checked && d.name.trim()).length;
  const checkedStatusCount = statusDrafts.filter(d => d.checked && d.task_id).length;
  const charCount = rawText.trim().length;
  // 上限超過は解析をブロックしない。超過分は handleAnalyze 側で自動的に切り詰める。
  // PDFを添付している場合はテキストが無くても解析可。
  const canAnalyze = charCount >= 20 || !!pdfAttachment;

  // ===== コンテンツ =====

  const contentArea = (
    <>
      {/* インライン時: ステップ状態バー */}
      {inline && step === "review" && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--color-border-primary)", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flex: 1 }}>
            {step === "review" ? "内容を確認して登録してください" : ""}
          </span>
          <button onClick={() => void requestReset()} style={{ fontSize: "11px", padding: "3px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            やり直す
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: inline ? "14px" : "20px" }}>
        {step === "input" && (
          <InputStep
            rawText={rawText}
            setRawText={setRawText}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            dropAreaRef={dropAreaRef}
            fileInputRef={fileInputRef}
            onDrop={handleDrop}
            onFileChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            error={error}
            fileError={fileError}
            pdfAttachment={pdfAttachment}
            onRemovePdf={() => setPdfAttachment(null)}
            onAnalyze={handleAnalyze}
          />
        )}
        {/* スクロール余白 */}
        {step === "input" && <div style={{ height: "8px" }} />}
        {step === "analyzing" && (
          <AIProgressLoader phases={MEETING_PHASES} expectedMs={16000} />
        )}
        {step === "review" && analysis && (
          <ReviewStep
            analysis={analysis}
            taskDrafts={taskDrafts}
            setTaskDrafts={setTaskDrafts}
            statusDrafts={statusDrafts}
            setStatusDrafts={setStatusDrafts}
            members={members}
            projects={projects}
            tasks={tasks}
            error={error}
            checkedTaskCount={checkedTaskCount}
            checkedStatusCount={checkedStatusCount}
            onApply={handleApply}
            onNewProjNameChange={setPendingNewProjName}
            onNewProjColorChange={setPendingNewProjColor}
            initialNewProjName={pendingNewProjName}
            initialNewProjColor={pendingNewProjColor}
          />
        )}
        {step === "applying" && (
          <SaveProgressLoader
            current={saveProgress.current}
            total={saveProgress.total}
            label={saveProgress.label}
            title="資料から登録しています"
          />
        )}
        {step === "done" && applyResults && (
          <DoneStep
            created={applyResults.created}
            updated={applyResults.updated}
            skipped={applyResults.skipped}
            onReset={handleReset}
            onClose={onClose}
          />
        )}
      </div>

      {/* 解析ボタン（常に下部に固定） */}
      {step === "input" && (
        <div style={{
          flexShrink: 0,
          borderTop: "1px solid var(--color-border-primary)",
          padding: "10px 14px",
          background: "var(--color-bg-primary)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>
            Ctrl+Enter でも送信できます
          </span>
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            style={primaryButtonStyle(!canAnalyze)}
          >
            🤖 AIで内容を解析する
          </button>
        </div>
      )}
    </>
  );

  // ===== インラインモード =====

  if (inline) {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {contentArea}
      </div>
    );
  }

  // ===== フローティングモード =====

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* イベントバブリング防止用のラッパー（クリックしても何も起きない） */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="panel-slide-up"
        style={{
          width: "min(760px, 100vw)",
          height: "100%",
          background: "var(--color-bg-primary)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="ai-shimmer" style={{
          background: "var(--gradient-ai)",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "20px" }}>📄</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>資料インプット</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
              {step === "analyzing" ? "AI解析中..." : "議事録・資料（テキスト/Word/PDF）→ AI解析 → タスク登録"}
            </div>
          </div>
          {step === "review" && (
            <button onClick={() => void requestReset()} style={{ fontSize: "12px", padding: "5px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer" }}>やり直す</button>
          )}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: "18px", color: "#fff", padding: "4px 8px", lineHeight: 1, borderRadius: "var(--radius-sm)" }}>✕</button>
        </div>
        {contentArea}
      </div>
    </div>
  );
}

// ===== InputStep =====

function InputStep({
  rawText, setRawText,
  isDragging, setIsDragging,
  dropAreaRef, fileInputRef,
  onDrop, onFileChange,
  error, fileError, pdfAttachment, onRemovePdf, onAnalyze,
}: {
  rawText: string; setRawText: (v: string) => void;
  isDragging: boolean; setIsDragging: (v: boolean) => void;
  dropAreaRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  fileError: string | null;
  pdfAttachment: FileAttachment | null;
  onRemovePdf: () => void;
  onAnalyze: () => void;
}) {
  const trimmed = rawText.trim();
  // AIに渡す文字数は、時刻行などを除いた整形後で数える（handleAnalyze が切り詰める基準と同じ）
  const charCount = useMemo(() => parseTranscript(trimmed).length, [trimmed]);
  const overLimit = charCount > MAX_TRANSCRIPT_CHARS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ファイル読み込みエリア */}
      <div
        ref={dropAreaRef}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${isDragging ? "var(--color-brand)" : "var(--color-border-primary)"}`,
          borderRadius: "var(--radius-lg)",
          padding: "20px",
          textAlign: "center",
          background: isDragging ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
          transition: "all 0.15s",
          cursor: "pointer",
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
      >
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>📄</div>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "4px" }}>
          ファイルをドラッグ＆ドロップ
        </div>
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          または <span style={{ color: "var(--color-brand)", textDecoration: "underline" }}>クリックして選択</span>（.vtt / .srt / .txt / .docx(Word) / .pdf / .html）
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vtt,.srt,.txt,.text,.docx,.pdf,.html,.htm,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
      </div>

      {/* 添付PDF（ある場合） */}
      {pdfAttachment && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "var(--color-bg-purple, #ede9fe)", border: "1px solid var(--color-border-purple, #ddd6fe)", borderRadius: "var(--radius-md)", fontSize: "12px" }}>
          <span>📑</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)" }}>{pdfAttachment.fileName}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>このPDFを読み込みました</span>
          <button onClick={onRemovePdf} title="添付を解除" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "13px", padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      )}
      {fileError && (
        <div style={{ fontSize: "11px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>{fileError}</div>
      )}

      {/* テキスト入力 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <FieldLabel>
            または直接貼り付け
            <span style={{ fontSize: "10px", fontWeight: "400", color: "var(--color-text-tertiary)", marginLeft: "8px" }}>
              議事録・会議メモ・資料・報告書など何でも可
            </span>
          </FieldLabel>
          <span title="時刻の行などを除いた、AIに渡す文字数です" style={{
            fontSize: "10px",
            color: overLimit ? "#ca8a04" : "var(--color-text-tertiary)",
          }}>
            {charCount.toLocaleString()} / {MAX_TRANSCRIPT_CHARS.toLocaleString()} 文字
          </span>
        </div>
        <textarea
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onAnalyze(); } }}
          placeholder={"WEBVTT\n\n00:01:23.000 --> 00:01:28.000\n<v 田中>今週のAPIの実装が完了しました。\n\n...\n\nまたは普通のテキストをそのまま貼り付けてください。"}
          rows={10}
          style={{
            width: "100%", padding: "10px 12px", fontSize: "12px",
            fontFamily: "monospace",
            border: `1px solid ${overLimit ? "#ca8a04" : "var(--color-border-primary)"}`,
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
          }}
        />
        {overLimit && (
          <div style={{ fontSize: "11px", color: "#ca8a04", marginTop: "4px" }}>
            {MAX_TRANSCRIPT_CHARS.toLocaleString()}文字を超えた分は解析対象外になります（先頭{MAX_TRANSCRIPT_CHARS.toLocaleString()}文字のみAIに渡します）。そのまま解析できます。
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}
    </div>
  );
}

// ===== ReviewStep =====

function ReviewStep({
  analysis, taskDrafts, setTaskDrafts, statusDrafts, setStatusDrafts,
  members, projects, tasks,
  error, checkedTaskCount, checkedStatusCount, onApply,
  onNewProjNameChange, onNewProjColorChange, initialNewProjName, initialNewProjColor,
}: {
  analysis: MeetingAnalysis;
  taskDrafts: TaskDraft[]; setTaskDrafts: (d: TaskDraft[]) => void;
  statusDrafts: StatusDraft[]; setStatusDrafts: (d: StatusDraft[]) => void;
  members: Member[];
  projects: { id: string; name: string }[];
  tasks: Task[];
  error: string | null;
  checkedTaskCount: number;
  checkedStatusCount: number;
  onApply: () => void;
  onNewProjNameChange: (name: string) => void;
  onNewProjColorChange: (color: string) => void;
  initialNewProjName: string;
  initialNewProjColor: string;
}) {
  const updateTask = (tempId: string, patch: Partial<TaskDraft>) =>
    setTaskDrafts(taskDrafts.map(d => d.tempId === tempId ? { ...d, ...patch } : d));
  const updateStatus = (tempId: string, patch: Partial<StatusDraft>) =>
    setStatusDrafts(statusDrafts.map(d => d.tempId === tempId ? { ...d, ...patch } : d));

  const hasAnything = checkedTaskCount > 0 || checkedStatusCount > 0;

  const applyBulkProject = (projectId: string) => {
    if (!projectId) return;
    setTaskDrafts(taskDrafts.map(d => d.checked ? { ...d, project_id: projectId } : d));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* 資料サマリー */}
      <Card>
        <SectionHeader icon="📝" title="資料サマリー" />
        <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          {analysis.summary}
        </div>
      </Card>

      {/* 新規タスク候補 */}
      {taskDrafts.length > 0 && (
        <div>
          <SectionHeader icon="➕" title={`新規タスク候補（${taskDrafts.length}件）`} />
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
            チェックした項目が登録されます。内容は編集できます。
          </div>
          <BulkProjectBar
            projects={projects}
            onApplyBulk={applyBulkProject}
            onNewProjNameChange={onNewProjNameChange}
            onNewProjColorChange={onNewProjColorChange}
            initialNewProjName={initialNewProjName}
            initialNewProjColor={initialNewProjColor}
            initialBulkProjId={taskDrafts.some(d => d.project_id === "__new__") ? "__new__" : ""}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
            {taskDrafts.map(draft => (
              <TaskDraftCard
                key={draft.tempId}
                draft={draft}
                members={members}
                projects={projects}
                onChange={patch => updateTask(draft.tempId, patch)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ステータス更新候補 */}
      {statusDrafts.length > 0 && (
        <div>
          <SectionHeader icon="🔄" title={`ステータス更新候補（${statusDrafts.length}件）`} />
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
            「対象タスク」を正しいタスクに選択してチェックをつけてください。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {statusDrafts.map(draft => (
              <StatusDraftCard
                key={draft.tempId}
                draft={draft}
                tasks={tasks}
                onChange={patch => updateStatus(draft.tempId, patch)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 決定事項 */}
      {analysis.decisions.length > 0 && (
        <Card>
          <SectionHeader icon="✅" title="決定事項" />
          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {analysis.decisions.map((d, i) => (
              <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{d}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* リスク */}
      {analysis.risks.length > 0 && (
        <Card>
          <SectionHeader icon="⚠️" title="リスク・懸念" />
          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {analysis.risks.map((r, i) => (
              <li key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{r}</li>
            ))}
          </ul>
        </Card>
      )}

      {taskDrafts.length === 0 && statusDrafts.length === 0 && (
        <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>
          タスクや更新候補は見つかりませんでした
        </div>
      )}

      {error && <ErrorBox message={error} />}

      <button
        onClick={onApply}
        disabled={!hasAnything}
        style={primaryButtonStyle(!hasAnything)}
      >
        {hasAnything
          ? `登録する（タスク ${checkedTaskCount}件・更新 ${checkedStatusCount}件）`
          : "登録する項目がありません"}
      </button>
    </div>
  );
}

// ===== BulkProjectBar =====

const PROJ_COLORS = [
  { hex: "#6366f1", label: "紫" },
  { hex: "#2563eb", label: "青" },
  { hex: "#16a34a", label: "緑" },
  { hex: "#ca8a04", label: "黄" },
  { hex: "#dc2626", label: "赤" },
  { hex: "#0891b2", label: "水" },
  { hex: "#9333ea", label: "紫2" },
  { hex: "#64748b", label: "グレー" },
];

function BulkProjectBar({ projects, onApplyBulk, onNewProjNameChange, onNewProjColorChange, initialNewProjName, initialNewProjColor, initialBulkProjId }: {
  projects: { id: string; name: string }[];
  onApplyBulk: (projectId: string) => void;
  onNewProjNameChange: (name: string) => void;
  onNewProjColorChange: (color: string) => void;
  /** 復元・再表示のとき、親が持っている新規PJ名・色と表示を一致させる（見えない名前でPJが作られないように） */
  initialNewProjName: string;
  initialNewProjColor: string;
  initialBulkProjId: string;
}) {
  const [bulkProjId, setBulkProjId] = useState(initialBulkProjId);
  const [newName, setNewName] = useState(initialNewProjName);
  const [newColor, setNewColor] = useState(initialNewProjColor);

  const isNew = bulkProjId === "__new__";
  const canApply = !!bulkProjId && (!isNew || newName.trim().length > 0);

  return (
    <div style={{
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-md)",
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    }}>
      <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
        PJを一括設定（チェック済みのタスクに適用）
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <CustomSelect
          value={bulkProjId}
          onChange={value => setBulkProjId(value)}
          options={[
            { value: "", label: "（プロジェクトを選択）" },
            ...projects.map(p => ({ value: p.id, label: p.name })),
            { value: "__new__", label: "＋ 新規プロジェクトを作成" },
          ]}
          searchable searchPlaceholder="プロジェクトで検索..."
          style={{ flex: 1 }}
        />
        <button
          onClick={() => { if (canApply) onApplyBulk(bulkProjId); }}
          disabled={!canApply}
          style={{
            padding: "7px 14px",
            background: canApply
              ? "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))"
              : "var(--color-bg-tertiary)",
            border: "none",
            borderRadius: "var(--radius-md)",
            color: canApply ? "#fff" : "var(--color-text-tertiary)",
            fontSize: "12px",
            fontWeight: "600",
            cursor: canApply ? "pointer" : "not-allowed",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          一括適用
        </button>
      </div>
      {isNew && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="新規プロジェクト名（必須）"
            value={newName}
            onChange={e => { setNewName(e.target.value); onNewProjNameChange(e.target.value); }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            {PROJ_COLORS.map(c => (
              <div
                key={c.hex}
                onClick={() => { setNewColor(c.hex); onNewProjColorChange(c.hex); }}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { setNewColor(c.hex); onNewProjColorChange(c.hex); } }}
                aria-pressed={newColor === c.hex}
                title={c.label}
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: c.hex,
                  cursor: "pointer",
                  border: newColor === c.hex ? "2.5px solid var(--color-text-primary)" : "2px solid transparent",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== TaskDraftCard =====

function TaskDraftCard({
  draft, members, projects, onChange,
}: {
  draft: TaskDraft;
  members: Member[];
  projects: { id: string; name: string }[];
  onChange: (patch: Partial<TaskDraft>) => void;
}) {
  return (
    <div style={{
      border: `1.5px solid ${draft.checked ? "var(--color-brand)" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      background: draft.checked ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
      transition: "all 0.15s",
    }}>
      {/* チェックボックス行 */}
      <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={e => onChange({ checked: e.target.checked })}
          style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-brand)" }}
        />
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          {draft.name || "（名称未設定）"}
        </span>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* タスク名 */}
          <div>
            <FieldLabel>タスク名</FieldLabel>
            <input
              type="text"
              value={draft.name}
              onChange={e => onChange({ name: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {/* 担当者 */}
            <div style={{ flex: "1 1 120px" }}>
              <FieldLabel>担当者</FieldLabel>
              <CustomSelect
                value={draft.assignee_member_id}
                onChange={value => onChange({ assignee_member_id: value })}
                options={[
                  { value: "", label: "（未設定）" },
                  ...members.map(m => ({ value: m.id, label: m.short_name })),
                ]}
                searchable searchPlaceholder="メンバーで検索..."
              />
            </div>

            {/* 開始日 */}
            <div style={{ flex: "1 1 130px" }}>
              <FieldLabel>開始日</FieldLabel>
              <input
                type="date"
                value={draft.start_date}
                onChange={e => onChange({ start_date: e.target.value })}
                style={inputStyle}
              />
            </div>

            {/* 期日 */}
            <div style={{ flex: "1 1 130px" }}>
              <FieldLabel>期日</FieldLabel>
              <input
                type="date"
                value={draft.due_date}
                onChange={e => onChange({ due_date: e.target.value })}
                style={inputStyle}
              />
            </div>

            {/* 優先度 */}
            <div style={{ flex: "1 1 120px" }}>
              <FieldLabel>優先度</FieldLabel>
              <CustomSelect
                value={draft.priority ?? ""}
                onChange={value => onChange({ priority: (value as TaskDraft["priority"]) || null })}
                options={[
                  { value: "", label: "（未設定）" },
                  ...PRIORITY_OPTIONS.map(o => ({ value: o.value, label: o.label })),
                ]}
              />
            </div>
          </div>

          {/* プロジェクト */}
          <div>
            <FieldLabel>プロジェクト</FieldLabel>
            <CustomSelect
              value={draft.project_id}
              onChange={value => onChange({ project_id: value })}
              options={[
                { value: "", label: "（未設定）" },
                ...projects.map(p => ({ value: p.id, label: p.name })),
                { value: "__new__", label: "＋ 新規プロジェクト（一括設定で作成）" },
              ]}
              searchable searchPlaceholder="プロジェクトで検索..."
            />
          </div>

          {/* 根拠引用 */}
          {draft.source_quote && (
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-tertiary)",
              borderLeft: "3px solid var(--color-border-primary)",
              padding: "6px 10px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
            }}>
              「{draft.source_quote}」
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== StatusDraftCard =====

// ラベル・色は taskMeta.ts（アプリ全体の単一の真実源）から取得し、他画面（リスト/カンバン等）との表記・トークン統一を保つ
const STATUS_OPTIONS: { value: "todo" | "in_progress" | "done" | "on_hold" | "cancelled"; label: string }[] = (
  ["todo", "in_progress", "done", "on_hold", "cancelled"] as const
).map(value => ({ value, label: TASK_STATUS_LABEL[value] }));

function StatusDraftCard({
  draft, tasks, onChange,
}: {
  draft: StatusDraft;
  tasks: Task[];
  onChange: (patch: Partial<StatusDraft>) => void;
}) {
  const activeTasks = tasks.filter(t => t.status !== "done");

  return (
    <div style={{
      border: `1.5px solid ${draft.checked ? "#2563eb" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      background: draft.checked ? "#eff6ff" : "var(--color-bg-secondary)",
      transition: "all 0.15s",
    }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={e => onChange({ checked: e.target.checked })}
          style={{ width: "16px", height: "16px", marginTop: "2px", cursor: "pointer", accentColor: "#2563eb" }}
        />
        <div>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)" }}>
            「{draft.task_name_hint}」→ {STATUS_OPTIONS.find(o => o.value === draft.new_status)?.label}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            {draft.reason}
          </div>
        </div>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* 対象タスク選択 */}
          <div>
            <FieldLabel>対象タスク（既存から選択）</FieldLabel>
            <CustomSelect
              value={draft.task_id}
              onChange={value => onChange({ task_id: value })}
              options={[
                { value: "", label: "（選択してください）" },
                ...activeTasks.map(t => ({ value: t.id, label: t.name })),
              ]}
              searchable searchPlaceholder="タスクで検索..."
            />
          </div>

          {/* 新ステータス */}
          <div>
            <FieldLabel>新しいステータス</FieldLabel>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {STATUS_OPTIONS.map(opt => {
                const isActive = draft.new_status === opt.value;
                const style = TASK_STATUS_STYLE[opt.value];
                return (
                  <button
                    key={opt.value}
                    onClick={() => onChange({ new_status: opt.value })}
                    style={{
                      flex: "1 1 30%", padding: "6px 8px", fontSize: "11px", fontWeight: "600",
                      border: `1.5px solid ${isActive ? style.border : "var(--color-border-primary)"}`,
                      borderRadius: "var(--radius-md)",
                      background: isActive ? style.bg : "var(--color-bg-primary)",
                      color: isActive ? style.color : "var(--color-text-tertiary)",
                      cursor: "pointer",
                    }}
                  >{opt.label}</button>
                );
              })}
            </div>
          </div>

          {/* 根拠引用 */}
          {draft.source_quote && (
            <div style={{
              fontSize: "11px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-tertiary)",
              borderLeft: "3px solid var(--color-border-primary)",
              padding: "6px 10px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
            }}>
              「{draft.source_quote}」
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== DoneStep =====

function DoneStep({ created, updated, skipped, onReset, onClose }: {
  created: number; updated: number; skipped: number;
  onReset: () => void; onClose: () => void;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "16px", padding: "40px 20px", textAlign: "center",
    }}>
      <div style={{ fontSize: "48px" }}>🎉</div>
      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>
        登録が完了しました
      </div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
        {created > 0 && <div>タスク {created}件 を新規作成しました</div>}
        {updated > 0 && <div>タスク {updated}件 のステータスを更新しました</div>}
        {skipped > 0 && <div>タスク {skipped}件 は対象のタスクが見つからず、更新できませんでした</div>}
        {created === 0 && updated === 0 && skipped === 0 && <div>変更はありませんでした</div>}
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
        <button onClick={onReset} style={ghostButtonStyle}>
          別の資料を読み込む
        </button>
        <button onClick={onClose} style={primaryButtonStyle(false)}>
          閉じる
        </button>
      </div>
    </div>
  );
}

// ===== ユーティリティコンポーネント =====

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "16px" }}>{icon}</span>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)" }}>{title}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)",
      padding: "16px 18px",
    }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-secondary)", marginBottom: "5px" }}>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      fontSize: "12px", color: "var(--color-text-danger)",
      background: "var(--color-bg-danger)",
      padding: "8px 12px", borderRadius: "var(--radius-md)",
    }}>
      {message}
    </div>
  );
}

// ===== スタイル定数 =====

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "11px 24px",
  background: disabled
    ? "var(--color-bg-tertiary)"
    : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
  border: "none",
  borderRadius: "var(--radius-md)",
  color: disabled ? "var(--color-text-tertiary)" : "#fff",
  fontSize: "13px", fontWeight: "600",
  cursor: disabled ? "not-allowed" : "pointer",
  boxShadow: disabled ? "none" : "0 2px 8px rgba(124,58,237,0.35)",
  width: "100%",
});

const ghostButtonStyle: React.CSSProperties = {
  padding: "9px 16px", fontSize: "12px",
  background: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
