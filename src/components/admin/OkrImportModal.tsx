// src/components/admin/OkrImportModal.tsx
//
// 【設計意図】
// Kintoneで記録したOKR（Objective/KR/TF）のPDF・テキストをAIに読み込ませ、
// 構造抽出→人が確認・編集→登録する取込フロー。
// meeting/MeetingImportPanel.tsx と同じ作法（PDFはdocumentブロックで添付・
// 抽出→プレビュー→確認登録のHuman-in-the-loop）を踏襲する。
//
// 既存OKRとの二重登録を避けるため、登録先を
// 「新しい期のObjectiveとして作成」（既定）／「既存のObjectiveに追記」から選ばせる。
// メンバー突合は氏名の自動マッチ→曖昧/不一致は手動選択（未登録者を勝手に新規作成しない）。

import { useState, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../stores/appStore";
import type { Member, Objective, KeyResult, TaskForce, Quarter } from "../../lib/localData/types";
import { active } from "../../lib/localData/localStore";
import {
  extractOkrImportData,
  type OkrImportAnalysis,
} from "../../lib/ai/okrImportExtractor";
import { matchMemberByName } from "../../lib/okr/okrImportMatch";
import { pickCurrentObjectiveForGroup } from "../../lib/okr/deptScope";
import type { FileAttachment } from "../../lib/ai/invokeAI";
import { extractDocxText, isDocxFile } from "../../lib/docxText";
import { currentQuarter } from "../../lib/date";
import { AIProgressLoader } from "../common/AIProgressLoader";
import { SaveProgressLoader } from "../common/SaveProgressLoader";
import { formatErrorForUser } from "../../lib/errorMessage";
import { CustomSelect } from "../common/CustomSelect";

const OKR_IMPORT_PHASES = [
  "PDF/テキストを読み込んでいます",
  "Objective・KRの構造を読み取っています",
  "Task Forceの構造を読み取っています",
  "担当者の氏名を確認しています",
  "結果をまとめています",
];

const MAX_TEXT_CHARS = 30000;

const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: "1Q", label: "1Q（1〜3月）" },
  { value: "2Q", label: "2Q（4〜6月）" },
  { value: "3Q", label: "3Q（7〜9月）" },
  { value: "4Q", label: "4Q（10〜12月）" },
];

// ===== ドラフト型 =====

interface TfDraft {
  tempId: string;
  checked: boolean;
  tf_number: string;
  name: string;
  description: string;
  background: string;
  quarter: Quarter;
  leader_member_id: string;
  source_quote: string;
}

interface KrDraft {
  tempId: string;
  checked: boolean;
  title: string;
  /** "new" = 新規KRとして作成。それ以外（既存KRのid）= 既存KRに紐づけ（"既存に追記"モードのみ有効） */
  linkTo: string;
  tfDrafts: TfDraft[];
}

type TargetMode = "new" | "existing";
type Step = "input" | "analyzing" | "review" | "applying" | "done";

interface Props {
  onClose: () => void;
  currentUser: Member;
  /** 取込先の部署（AdminViewのローカル部署セレクタ selectedGroupId）。
   *  新規Objectiveのgroup_id・「既存に追記」時のctxObjの決定に使う。 */
  targetGroupId: string;
}

export function OkrImportModal({ onClose, currentUser, targetGroupId }: Props) {
  const rawObjectives = useAppStore(s => s.objectives);
  const rawKrs      = useAppStore(s => s.keyResults);
  const rawMembers  = useAppStore(s => s.members);
  const saveObjective = useAppStore(s => s.saveObjective);
  const saveKeyResult = useAppStore(s => s.saveKeyResult);
  const saveTaskForce = useAppStore(s => s.saveTaskForce);

  // targetGroupId（取込先部署）の現在Objective。アプリ全体のcurrentGroupId（表示中の部署）
  // とは独立（AdminViewの部署セレクタで別部署を見ながら取り込むケースがあるため）。
  const ctxObj = useMemo(
    () => pickCurrentObjectiveForGroup(rawObjectives, targetGroupId),
    [rawObjectives, targetGroupId],
  );

  const members = useMemo(() => active(rawMembers), [rawMembers]);
  const existingKrs = useMemo(
    () => active(rawKrs).filter(k => k.objective_id === ctxObj?.id),
    [rawKrs, ctxObj],
  );

  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [pdfAttachment, setPdfAttachment] = useState<FileAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const dropAreaRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;

  const [analysis, setAnalysis] = useState<OkrImportAnalysis | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>("new");
  const [objTitle, setObjTitle] = useState("");
  const [objPurpose, setObjPurpose] = useState("");
  const [objBackground, setObjBackground] = useState("");
  const [objPeriod, setObjPeriod] = useState("");
  const [krDrafts, setKrDrafts] = useState<KrDraft[]>([]);

  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number; label: string }>({
    current: 0, total: 1, label: "",
  });
  const [applyResults, setApplyResults] = useState<{ objectives: number; krs: number; tfs: number } | null>(null);

  // ===== ファイル読み込み（PDF/Word/テキスト） =====

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf" || file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = (e.target?.result as string) ?? "";
        const base64 = dataUrl.split(",")[1] ?? "";
        if (!base64) { setFileError("PDFの読み込みに失敗しました。"); return; }
        setPdfAttachment({ fileName: file.name, mediaType: "application/pdf", data: base64, isText: false });
        setRawText("");
      };
      reader.onerror = () => setFileError("PDFの読み込みに失敗しました。");
      reader.readAsDataURL(file);
      return;
    }
    if (isDocxFile(file)) {
      extractDocxText(file)
        .then(text => { setPdfAttachment(null); setRawText(text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text); })
        .catch((e: unknown) => setFileError(e instanceof Error ? e.message : "Wordファイルの読み込みに失敗しました。"));
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      setPdfAttachment(null);
      const text = (e.target?.result as string) ?? "";
      setRawText(text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text);
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

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim();
    if (!text && !pdfAttachment) return;
    setError(null);
    setStep("analyzing");

    try {
      const result = await extractOkrImportData({
        transcript: text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text,
        attachment: pdfAttachment,
      });
      setAnalysis(result);
      setObjTitle(result.objective.title);
      setObjPurpose(result.objective.purpose ?? "");
      setObjBackground(result.objective.background ?? "");
      setObjPeriod(result.objective.period ?? ctxObj?.period ?? "2026年度");
      setTargetMode(ctxObj ? "new" : "new");

      setKrDrafts(result.key_results.map((kr, ki) => ({
        tempId: `kr-${ki}`,
        checked: true,
        title: kr.title,
        linkTo: "new",
        tfDrafts: kr.task_forces.map((tf, ti) => ({
          tempId: `kr-${ki}-tf-${ti}`,
          checked: true,
          tf_number: tf.tf_number ?? "",
          name: tf.name,
          description: tf.description ?? "",
          background: tf.background ?? "",
          quarter: currentQuarter(),
          leader_member_id: matchMemberByName(tf.leader_name_hint, members)?.id ?? "",
          source_quote: tf.source_quote,
        })),
      })));

      setStep("review");
    } catch (e) {
      setError(formatErrorForUser("AI解析に失敗しました", e));
      setStep("input");
    }
  }, [rawText, pdfAttachment, ctxObj, members]);

  // ===== 登録 =====

  const checkedKrCount = krDrafts.filter(d => d.checked && d.title.trim()).length;
  const checkedTfCount = krDrafts.reduce(
    (sum, d) => sum + (d.checked ? d.tfDrafts.filter(t => t.checked && t.name.trim()).length : 0), 0,
  );
  const hasAnything = checkedKrCount > 0;

  const handleApply = useCallback(async () => {
    setStep("applying");
    setError(null);

    const newObjNeeded = targetMode === "new";
    const validKrDrafts = krDrafts.filter(d => d.checked && d.title.trim());
    const totalSteps = (newObjNeeded ? 1 : 0)
      + validKrDrafts.filter(d => d.linkTo === "new").length
      + validKrDrafts.reduce((sum, d) => sum + d.tfDrafts.filter(t => t.checked && t.name.trim()).length, 0);

    setSaveProgress({ current: 0, total: Math.max(1, totalSteps), label: "登録処理を開始しています…" });

    let stepCount = 0;
    let objectivesCreated = 0;
    let krsCreated = 0;
    let tfsCreated = 0;

    try {
      // 1) Objective
      let targetObjectiveId: string;
      if (newObjNeeded) {
        setSaveProgress(p => ({ ...p, current: stepCount, label: "新しいObjectiveを作成中…" }));
        const now = new Date().toISOString();
        targetObjectiveId = uuidv4();
        const newObj: Objective = {
          id: targetObjectiveId,
          title: objTitle.trim() || "（無題）",
          purpose: objPurpose,
          background: objBackground,
          period: objPeriod.trim() || "2026年度",
          is_current: true,
          group_id: targetGroupId,
          created_at: now,
          updated_at: now,
          updated_by: currentUser.id,
        };
        await saveObjective(newObj);
        objectivesCreated++;
        // 従来のObjectiveは is_current を外す（同じ部署=targetGroupIdの現在Objectiveのみを
        // 対象にしているため、他部署の現在Objectiveを巻き込まない）
        if (ctxObj && ctxObj.id !== targetObjectiveId) {
          await saveObjective({ ...ctxObj, is_current: false, updated_by: currentUser.id });
        }
        stepCount += 1;
        setSaveProgress(p => ({ ...p, current: stepCount }));
      } else {
        if (!ctxObj) throw new Error("既存のObjectiveが見つかりません。");
        targetObjectiveId = ctxObj.id;
      }

      // 2) KR + TF
      for (const krDraft of validKrDrafts) {
        let krId: string;
        if (krDraft.linkTo !== "new") {
          krId = krDraft.linkTo;
        } else {
          setSaveProgress(p => ({ ...p, current: stepCount, label: `KR「${krDraft.title}」を作成中…` }));
          const now = new Date().toISOString();
          krId = uuidv4();
          const newKr: KeyResult = {
            id: krId,
            objective_id: targetObjectiveId,
            title: krDraft.title.trim(),
            is_deleted: false,
            created_at: now,
            updated_at: now,
            updated_by: currentUser.id,
          };
          await saveKeyResult(newKr);
          krsCreated++;
          stepCount += 1;
          setSaveProgress(p => ({ ...p, current: stepCount }));
        }

        const validTfDrafts = krDraft.tfDrafts.filter(t => t.checked && t.name.trim());
        for (const tfDraft of validTfDrafts) {
          setSaveProgress(p => ({ ...p, current: stepCount, label: `TF「${tfDraft.name}」を作成中…` }));
          const now = new Date().toISOString();
          const newTf: TaskForce = {
            id: uuidv4(),
            kr_id: krId,
            tf_number: tfDraft.tf_number.trim(),
            quarter: tfDraft.quarter,
            name: tfDraft.name.trim(),
            description: tfDraft.description.trim() || undefined,
            background: tfDraft.background.trim() || undefined,
            leader_member_id: tfDraft.leader_member_id,
            is_deleted: false,
            created_at: now,
            updated_at: now,
            updated_by: currentUser.id,
          };
          await saveTaskForce(newTf);
          tfsCreated++;
          stepCount += 1;
          setSaveProgress(p => ({ ...p, current: stepCount }));
        }
      }

      setApplyResults({ objectives: objectivesCreated, krs: krsCreated, tfs: tfsCreated });
      setStep("done");
    } catch (e) {
      setError(formatErrorForUser("登録に失敗しました", e));
      setStep("review");
    }
  }, [targetMode, krDrafts, objTitle, objPurpose, objBackground, objPeriod, ctxObj, targetGroupId, currentUser, saveObjective, saveKeyResult, saveTaskForce]);

  const handleReset = () => {
    setStep("input");
    setRawText("");
    setPdfAttachment(null);
    setFileError(null);
    setError(null);
    setAnalysis(null);
    setKrDrafts([]);
    setApplyResults(null);
  };

  const updateKr = (tempId: string, patch: Partial<KrDraft>) =>
    setKrDrafts(prev => prev.map(d => d.tempId === tempId ? { ...d, ...patch } : d));
  const updateTf = (krTempId: string, tfTempId: string, patch: Partial<TfDraft>) =>
    setKrDrafts(prev => prev.map(d => d.tempId === krTempId
      ? { ...d, tfDrafts: d.tfDrafts.map(t => t.tempId === tfTempId ? { ...t, ...patch } : t) }
      : d));

  const charCount = rawText.trim().length;
  const canAnalyze = charCount >= 10 || !!pdfAttachment;

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は下のボタンでキーボードから可能なため、
    // 背景要素をフォーカス可能にする必要はない
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="panel-slide-up"
        style={{
          width: "min(820px, 100vw)",
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
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>OKRをPDFから取込</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
              {step === "analyzing" ? "AI解析中..." : "Kintoneの画面PDF・テキスト → AI解析 → Objective/KR/TF登録"}
            </div>
          </div>
          {step === "review" && (
            <button onClick={handleReset} style={{ fontSize: "12px", padding: "5px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: "var(--radius-sm)", color: "#fff", cursor: "pointer" }}>やり直す</button>
          )}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: "18px", color: "#fff", padding: "4px 8px", lineHeight: 1, borderRadius: "var(--radius-sm)" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          {step === "input" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                ref={dropAreaRef}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
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
                  KintoneのOKR画面をPDF化してドラッグ＆ドロップ
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  または <span style={{ color: "var(--color-brand)", textDecoration: "underline" }}>クリックして選択</span>（.pdf / .docx(Word) / .txt）
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.text,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
              </div>

              {pdfAttachment && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "var(--color-bg-purple, #ede9fe)", border: "1px solid var(--color-border-purple, #ddd6fe)", borderRadius: "var(--radius-md)", fontSize: "12px" }}>
                  <span>📑</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)" }}>{pdfAttachment.fileName}</span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>このPDFをそのままAIに渡します</span>
                  <button onClick={() => setPdfAttachment(null)} title="添付を解除" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "13px", padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              )}
              {fileError && <ErrorBox message={fileError} />}

              <div>
                <FieldLabel>または直接貼り付け</FieldLabel>
                <textarea
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  placeholder={"Objective：〇〇年度△△\nPurpose：...\n\nKR1：...\nKR1-TF1：...\n担当OM：...\n\nのように、KintoneのOKR画面のテキストをそのまま貼り付けてください。"}
                  rows={10}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: "12px",
                    fontFamily: "monospace",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)",
                    color: "var(--color-text-primary)",
                    resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
                  }}
                />
              </div>

              {error && <ErrorBox message={error} />}
            </div>
          )}

          {step === "analyzing" && (
            <AIProgressLoader phases={OKR_IMPORT_PHASES} intervalMs={4200} />
          )}

          {step === "review" && analysis && (
            <ReviewStep
              ctxObj={ctxObj}
              targetMode={targetMode}
              setTargetMode={setTargetMode}
              objTitle={objTitle} setObjTitle={setObjTitle}
              objPurpose={objPurpose} setObjPurpose={setObjPurpose}
              objBackground={objBackground} setObjBackground={setObjBackground}
              objPeriod={objPeriod} setObjPeriod={setObjPeriod}
              krDrafts={krDrafts}
              existingKrs={existingKrs}
              members={members}
              updateKr={updateKr}
              updateTf={updateTf}
              error={error}
              checkedKrCount={checkedKrCount}
              checkedTfCount={checkedTfCount}
              hasAnything={hasAnything}
              onApply={handleApply}
            />
          )}

          {step === "applying" && (
            <SaveProgressLoader
              current={saveProgress.current}
              total={saveProgress.total}
              label={saveProgress.label}
              title="OKRを登録しています"
            />
          )}

          {step === "done" && applyResults && (
            <DoneStep results={applyResults} onReset={handleReset} onClose={onClose} />
          )}
        </div>

        {step === "input" && (
          <div style={{
            flexShrink: 0,
            borderTop: "1px solid var(--color-border-primary)",
            padding: "10px 14px",
            background: "var(--color-bg-primary)",
            display: "flex", alignItems: "center", gap: "10px",
          }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>
              評価基準バンド・ロジックモデル・月次タスクは取り込みません（Objective/KR/TFの骨組みのみ）
            </span>
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              style={primaryButtonStyle(!canAnalyze)}
            >
              🤖 AIで解析する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== ReviewStep =====

function ReviewStep({
  ctxObj, targetMode, setTargetMode,
  objTitle, setObjTitle, objPurpose, setObjPurpose, objBackground, setObjBackground, objPeriod, setObjPeriod,
  krDrafts, existingKrs, members, updateKr, updateTf,
  error, checkedKrCount, checkedTfCount, hasAnything, onApply,
}: {
  ctxObj: Objective | null;
  targetMode: TargetMode; setTargetMode: (m: TargetMode) => void;
  objTitle: string; setObjTitle: (v: string) => void;
  objPurpose: string; setObjPurpose: (v: string) => void;
  objBackground: string; setObjBackground: (v: string) => void;
  objPeriod: string; setObjPeriod: (v: string) => void;
  krDrafts: KrDraft[];
  existingKrs: KeyResult[];
  members: Member[];
  updateKr: (tempId: string, patch: Partial<KrDraft>) => void;
  updateTf: (krTempId: string, tfTempId: string, patch: Partial<TfDraft>) => void;
  error: string | null;
  checkedKrCount: number;
  checkedTfCount: number;
  hasAnything: boolean;
  onApply: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 登録先の選択（二重登録防止） */}
      <Card>
        <SectionHeader icon="🎯" title="登録先" />
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
          <label aria-label="新しい期のObjectiveとして作成" style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
            <input type="radio" checked={targetMode === "new"} onChange={() => setTargetMode("new")} style={{ marginTop: "3px" }} />
            <span>
              <span style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>新しい期のObjectiveとして作成（既定）</span>
              <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {ctxObj ? "現在のObjectiveは「過去の期」として残し、新規Objectiveを現在のものにします。" : "Objectiveがまだ無いため新規作成します。"}
              </span>
            </span>
          </label>
          <label aria-label="既存のObjectiveに追記" style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: ctxObj ? "pointer" : "not-allowed", opacity: ctxObj ? 1 : 0.5 }}>
            <input type="radio" checked={targetMode === "existing"} disabled={!ctxObj} onChange={() => setTargetMode("existing")} style={{ marginTop: "3px" }} />
            <span>
              <span style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)" }}>既存のObjectiveに追記</span>
              <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {ctxObj ? `現在のObjective「${ctxObj.title.slice(0, 30)}」の配下にKR/TFを追加します。` : "既存のObjectiveがありません。"}
              </span>
            </span>
          </label>
        </div>
      </Card>

      {/* Objective（新規作成モードのみ編集可） */}
      {targetMode === "new" && (
        <Card>
          <SectionHeader icon="🏁" title="Objective" />
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <FieldLabel>年度・範囲</FieldLabel>
              <input value={objPeriod} onChange={e => setObjPeriod(e.target.value)} style={inputStyle} placeholder="例：2026年度" />
            </div>
            <div>
              <FieldLabel>タイトル</FieldLabel>
              <textarea value={objTitle} onChange={e => setObjTitle(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <FieldLabel>Purpose（何を達成するか）</FieldLabel>
              <textarea value={objPurpose} onChange={e => setObjPurpose(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <FieldLabel>設計の意図や背景</FieldLabel>
              <textarea value={objBackground} onChange={e => setObjBackground(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
        </Card>
      )}

      {/* KR + TF 一覧 */}
      <div>
        <SectionHeader icon="🔑" title={`Key Result 候補（${krDrafts.length}件）`} />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
          チェックした項目が登録されます。内容・担当者は編集できます。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {krDrafts.map(krDraft => (
            <KrDraftCard
              key={krDraft.tempId}
              draft={krDraft}
              targetMode={targetMode}
              existingKrs={existingKrs}
              members={members}
              onChange={patch => updateKr(krDraft.tempId, patch)}
              onChangeTf={(tfTempId, patch) => updateTf(krDraft.tempId, tfTempId, patch)}
            />
          ))}
        </div>
        {krDrafts.length === 0 && (
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>
            KR候補は見つかりませんでした
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      <button onClick={onApply} disabled={!hasAnything} style={primaryButtonStyle(!hasAnything)}>
        {hasAnything ? `登録する（KR ${checkedKrCount}件・TF ${checkedTfCount}件）` : "登録する項目がありません"}
      </button>
    </div>
  );
}

function KrDraftCard({
  draft, targetMode, existingKrs, members, onChange, onChangeTf,
}: {
  draft: KrDraft;
  targetMode: TargetMode;
  existingKrs: KeyResult[];
  members: Member[];
  onChange: (patch: Partial<KrDraft>) => void;
  onChangeTf: (tfTempId: string, patch: Partial<TfDraft>) => void;
}) {
  return (
    <div style={{
      border: `1.5px solid ${draft.checked ? "var(--color-brand)" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      background: draft.checked ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "10px" }}>
        <input type="checkbox" checked={draft.checked} onChange={e => onChange({ checked: e.target.checked })} style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-brand)" }} />
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          {draft.title || "（名称未設定）"}
        </span>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {targetMode === "existing" && existingKrs.length > 0 && (
            <div>
              <FieldLabel>紐づけ先</FieldLabel>
              <CustomSelect
                value={draft.linkTo}
                onChange={value => onChange({ linkTo: value })}
                options={[
                  { value: "new", label: "＋ 新規KRとして追加" },
                  ...existingKrs.map(k => ({ value: k.id, label: k.title })),
                ]}
                searchable searchPlaceholder="既存KRで検索..."
              />
            </div>
          )}
          {draft.linkTo === "new" && (
            <div>
              <FieldLabel>KRタイトル</FieldLabel>
              <textarea value={draft.title} onChange={e => onChange({ title: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingLeft: "12px", borderLeft: "2px solid var(--color-border-primary)" }}>
            {draft.tfDrafts.map(tf => (
              <TfDraftCard key={tf.tempId} draft={tf} members={members} onChange={patch => onChangeTf(tf.tempId, patch)} />
            ))}
            {draft.tfDrafts.length === 0 && (
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>TF候補はありません</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TfDraftCard({ draft, members, onChange }: {
  draft: TfDraft;
  members: Member[];
  onChange: (patch: Partial<TfDraft>) => void;
}) {
  return (
    <div style={{
      border: `1px solid ${draft.checked ? "#2563eb" : "var(--color-border-primary)"}`,
      borderRadius: "var(--radius-md)",
      padding: "10px 12px",
      background: draft.checked ? "#eff6ff" : "var(--color-bg-primary)",
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "8px" }}>
        <input type="checkbox" checked={draft.checked} onChange={e => onChange({ checked: e.target.checked })} style={{ width: "14px", height: "14px", cursor: "pointer", accentColor: "#2563eb" }} />
        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          {draft.name || "（名称未設定）"}
        </span>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: "0 0 70px" }}>
              <FieldLabel>番号</FieldLabel>
              <input value={draft.tf_number} onChange={e => onChange({ tf_number: e.target.value })} style={inputStyle} placeholder="1" />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>TF名</FieldLabel>
              <input value={draft.name} onChange={e => onChange({ name: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <FieldLabel>クォーター</FieldLabel>
              <CustomSelect
                value={draft.quarter}
                onChange={value => onChange({ quarter: value as Quarter })}
                options={QUARTER_OPTIONS.map(q => ({ value: q.value, label: q.label }))}
              />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <FieldLabel>担当OM・リーダー</FieldLabel>
              <CustomSelect
                value={draft.leader_member_id}
                onChange={value => onChange({ leader_member_id: value })}
                options={[
                  { value: "", label: "（未設定・スキップ）" },
                  ...members.map(m => ({ value: m.id, label: m.display_name })),
                ]}
                searchable searchPlaceholder="メンバーで検索..."
              />
            </div>
          </div>
          <div>
            <FieldLabel>詳細・目的（任意）</FieldLabel>
            <textarea value={draft.description} onChange={e => onChange({ description: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <FieldLabel>設定した意図・背景（任意）</FieldLabel>
            <textarea value={draft.background} onChange={e => onChange({ background: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          {draft.source_quote && (
            <div style={{
              fontSize: "10px", color: "var(--color-text-tertiary)",
              background: "var(--color-bg-tertiary)",
              borderLeft: "3px solid var(--color-border-primary)",
              padding: "5px 8px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
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

function DoneStep({ results, onReset, onClose }: {
  results: { objectives: number; krs: number; tfs: number };
  onReset: () => void; onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "48px" }}>🎉</div>
      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>登録が完了しました</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
        {results.objectives > 0 && <div>Objective {results.objectives}件 を新規作成しました</div>}
        {results.krs > 0 && <div>KR {results.krs}件 を新規作成しました</div>}
        {results.tfs > 0 && <div>TF {results.tfs}件 を新規作成しました</div>}
        {results.objectives === 0 && results.krs === 0 && results.tfs === 0 && <div>変更はありませんでした</div>}
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
        <button onClick={onReset} style={ghostButtonStyle}>別の資料を読み込む</button>
        <button onClick={onClose} style={primaryButtonStyle(false)}>閉じる</button>
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
    <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
      {message}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "11px 24px",
  background: disabled ? "var(--color-bg-tertiary)" : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
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
