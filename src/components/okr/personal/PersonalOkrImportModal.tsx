// src/components/okr/personal/PersonalOkrImportModal.tsx
//
// 【設計意図】
// Kintone「個人OKR設定フォーム」（個人四半期KR）／「個人OKR_月次振返り記録」（個人月次計画・
// 振り返り）のPDF・テキストを取り込む。`OkrImportModal.tsx`（グループOKR取込）と同じ
// Human-in-the-loopの型（PDF/テキスト→AI抽出→人が確認・編集→登録）を踏襲する
// （docs/dev/okr-redesign-plan.md §8 Phase2・CLAUDE.md Section 24）。
//
// 🔴【最重要】既存の同じ四半期のpersonal_krに対応づける確認画面を必ず経由すること。
// personal_kr_weeks/personal_kr_memosはpersonal_kr_id（＝personal_krs.id）にしか紐づいて
// いないため、既存KRを取込で作り直すと週の目標状態・メモが孤立して画面から消える。
// そのため「対応づけ先」は必ず人が確認・修正できるドロップダウンにし（importMatch.tsの
// ランキングはあくまで初期選択のヒント）、実際の書き込みはimportApplyPlan.tsの
// buildImportApplyPlan()に一本化する（既存idの再利用ロジックをここに分散させない）。
//
// 種別（四半期OKRか月次振返りか）はAIに判定させ、人が確認画面で切り替えられるようにする
// （山本さんの決定）。既存にあって抽出結果に無いKR・月には一切触れない（論理削除もしない）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  KeyResult, Member, Objective, PersonalKr, PersonalKrBand, PersonalKrKind, PersonalKrMonth,
  Quarter, TaskForce,
} from "../../../lib/localData/types";
import { active } from "../../../lib/localData/localStore";
import {
  extractPersonalOkrImportData, type PersonalOkrDocType, type PersonalOkrImportAnalysis,
  type PersonalOkrImportProgress,
} from "../../../lib/ai/personalOkrImportExtractor";
import { mapKrKindHint, parseBandValue, parseWeightPct, parsePercentValue } from "../../../lib/personalOkr/importFieldParse";
import { rankExistingPersonalKrMatches, rankGroupTfMatches, pickDefaultMapping } from "../../../lib/personalOkr/importMatch";
import { buildImportApplyPlan, type ImportKrDraftInput, type ImportMonthDraftInput } from "../../../lib/personalOkr/importApplyPlan";
import { keyResultsInGroup, taskForcesInGroup, DEFAULT_OKR_GROUP_ID } from "../../../lib/okr/deptScope";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { isPersonalOkrImportTextTooLong } from "../../../lib/personalOkr/importCharWarning";
import { describeKintoneImportSource, type KintoneImportEngineSource } from "../../../lib/personalOkr/kintoneTextParse";
import { FileAttachButton, FileDropZone } from "../../common/FileAttachButton";
import { CustomSelect } from "../../common/CustomSelect";
import { SaveProgressLoader } from "../../common/SaveProgressLoader";
import { formatErrorForUser } from "../../../lib/errorMessage";
import type { FileAttachment } from "../../../lib/ai/invokeAI";

const MAX_TEXT_CHARS = 40000;
const NEW_KR_VALUE = "__new__";

const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: "1Q", label: "1Q（1〜3月）" },
  { value: "2Q", label: "2Q（4〜6月）" },
  { value: "3Q", label: "3Q（7〜9月）" },
  { value: "4Q", label: "4Q（10〜12月）" },
];

const KR_KIND_OPTIONS: { value: PersonalKrKind; label: string }[] = [
  { value: "group_kr", label: "グループKR紐づけ" },
  { value: "general", label: "全般" },
  { value: "company_common", label: "全社共通" },
  { value: "om_common", label: "OM共通" },
  { value: "agm_common", label: "AGM共通" },
  { value: "leader_common", label: "リーダー共通" },
];

type Step = "input" | "analyzing" | "review" | "applying" | "done";

interface MonthDraft {
  tempId: string;
  checked: boolean;
  monthIndex: 1 | 2 | 3;
  positioning: string;
  activities: string;
  targetAndEvidence: string;
  risks: string;
  bandTarget: PersonalKrBand | null;
  weightOverridePct: string;
  reviewText: string;
  selfEvalPct: string;
  gmEvalPct: string;
  gmComment: string;
}

interface KrDraft {
  tempId: string;
  checked: boolean;
  sourceLabel: string | null;
  groupKrHint: string | null;
  /** NEW_KR_VALUE = 新規作成。それ以外は既存personal_krs.id（対応づけ＝更新） */
  mappedTo: string;
  krKind: PersonalKrKind;
  keyResultId: string;
  taskForceId: string;
  label: string;
  weightPct: string;
  category: string;
  activity: string;
  strengthRole: string;
  weaknessRole: string;
  criteria: string;
  supplement: string;
  months: MonthDraft[];
}

function monthDraftFromExtracted(m: PersonalOkrImportAnalysis["krs"][number]["months"][number], fallbackIndex: 1 | 2 | 3): MonthDraft {
  return {
    tempId: uuidv4(),
    checked: true,
    monthIndex: m.month_index ?? fallbackIndex,
    positioning: m.positioning ?? "",
    activities: m.activities ?? "",
    targetAndEvidence: m.target_and_evidence ?? "",
    risks: m.risks ?? "",
    bandTarget: parseBandValue(m.band_target),
    weightOverridePct: m.weight_override_pct != null ? String(m.weight_override_pct) : "",
    reviewText: m.review_text ?? "",
    selfEvalPct: m.self_eval_pct != null ? String(m.self_eval_pct) : "",
    gmEvalPct: m.gm_eval_pct != null ? String(m.gm_eval_pct) : "",
    gmComment: m.gm_comment ?? "",
  };
}

interface Props {
  onClose: () => void;
  currentUser: Member;
  currentGroupId: string | null;
  /** 本人の全期間のpersonal_kr（対応づけ候補の母集団。usePersonalOkrUiStore.krs） */
  allPersonalKrs: PersonalKr[];
  monthsByKr: Record<string, PersonalKrMonth[]>;
  ensureKrDetailLoaded: (krId: string) => Promise<void>;
  saveKr: (kr: PersonalKr) => Promise<void>;
  saveMonth: (month: PersonalKrMonth) => Promise<void>;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  objectives: Objective[];
  defaultFiscalYear: number;
  defaultQuarter: Quarter;
}

export function PersonalOkrImportModal({
  onClose, currentUser, currentGroupId, allPersonalKrs, monthsByKr, ensureKrDetailLoaded,
  saveKr, saveMonth, keyResults, taskForces, objectives, defaultFiscalYear, defaultQuarter,
}: Props) {
  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [docType, setDocType] = useState<PersonalOkrDocType>("quarterly");
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  const [quarter, setQuarter] = useState<Quarter>(defaultQuarter);
  const [krDrafts, setKrDrafts] = useState<KrDraft[]>([]);

  // 呼び出しを2回に分けたことに伴う実進度（1/2 個人KRを抽出中／2/2 月次計画を抽出中）。
  // 無言で長時間待たせないため、時間ベースの演出ではなく実際の呼び出し完了状況を表示する。
  const [analyzeProgress, setAnalyzeProgress] = useState<PersonalOkrImportProgress>({ current: 0, total: 2, label: "解析を開始しています…" });
  // 診断用：決定的パーサ／AIどちらの経路で読み取ったか＋実際にAIへ送信した文字数
  // （成功後もレビュー画面に出し続ける。山本さんが実機でどちらが動いたか報告するための
  // 唯一の手がかりのため必ず表示する。v3.56）。
  const [importSourceInfo, setImportSourceInfo] = useState<{
    quarterlySource: KintoneImportEngineSource;
    monthlySource: KintoneImportEngineSource;
    originalCharCount: number;
    aiSentCharCount: number;
  } | null>(null);
  // 呼び出し1・2のどちらかが失敗したときの警告（両方成功時は空配列。全部やり直しにはしない）。
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number; label: string }>({ current: 0, total: 1, label: "" });
  const [applyResults, setApplyResults] = useState<{ krCount: number; monthCount: number } | null>(null);

  const krsInGroup = useMemo(() => keyResultsInGroup(keyResults, objectives, currentGroupId), [keyResults, objectives, currentGroupId]);
  const tfsInGroup = useMemo(() => taskForcesInGroup(taskForces, keyResults, objectives, currentGroupId), [taskForces, keyResults, objectives, currentGroupId]);

  // 対応づけ候補の母集団：本人の全personal_krのうち、選択中の年度・四半期に属するもの
  const existingKrsInPeriod = useMemo(
    () => active(allPersonalKrs).filter(k => k.fiscal_year === fiscalYear && k.quarter === quarter),
    [allPersonalKrs, fiscalYear, quarter],
  );
  const existingKrsById = useMemo(() => Object.fromEntries(existingKrsInPeriod.map(k => [k.id, k])), [existingKrsInPeriod]);

  // 対応づけ先として選ばれた既存KRの月次計画を先読みする（確認画面の「既存を更新します」バッジと、
  // 登録時の重複作成防止のため。ensureKrDetailLoadedは既に読み込み済みならno-op）
  const mappedExistingIds = useMemo(
    () => Array.from(new Set(krDrafts.filter(d => d.mappedTo !== NEW_KR_VALUE).map(d => d.mappedTo))),
    [krDrafts],
  );
  useEffect(() => {
    for (const id of mappedExistingIds) void ensureKrDetailLoaded(id);
  }, [mappedExistingIds, ensureKrDetailLoaded]);

  // ===== ファイル入力 =====
  // ファイル種別の判定・テキスト抽出（PDF/Word/画像/テキスト）はFileAttachButton側の
  // processFileAttachment()に一元化されている（重複実装しない）。

  const handleAttach = useCallback((att: FileAttachment) => {
    setFileError(null);
    if (att.isText) {
      setRawText(att.data.length > MAX_TEXT_CHARS ? att.data.slice(0, MAX_TEXT_CHARS) : att.data);
      setAttachment(null);
    } else {
      setAttachment(att);
      setRawText("");
    }
  }, []);

  // ===== AI解析 =====

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim();
    if (!text && !attachment) return;
    setError(null);
    setImportWarnings([]);
    setStep("analyzing");
    const sentText = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
    setAnalyzeProgress({ current: 0, total: 2, label: "解析を開始しています…" });
    try {
      const result = await extractPersonalOkrImportData(
        { transcript: sentText, attachment },
        progress => setAnalyzeProgress(progress),
      );
      setImportSourceInfo({
        quarterlySource: result.quarterlySource,
        monthlySource: result.monthlySource,
        originalCharCount: result.originalCharCount,
        aiSentCharCount: result.aiSentCharCount,
      });
      setImportWarnings(result.warnings);
      setDocType(result.detected_doc_type);
      if (result.fiscal_year) setFiscalYear(result.fiscal_year);
      if (result.quarter) setQuarter(result.quarter);

      const effectiveFiscalYear = result.fiscal_year ?? fiscalYear;
      const effectiveQuarter = result.quarter ?? quarter;
      const candidatePool = active(allPersonalKrs).filter(
        k => k.fiscal_year === effectiveFiscalYear && k.quarter === effectiveQuarter,
      );

      const drafts: KrDraft[] = result.krs.map(kr => {
        const krKind = mapKrKindHint(kr.kr_kind_hint);
        const matches = rankExistingPersonalKrMatches(kr.label, krKind, candidatePool);
        const mappedTo = pickDefaultMapping(matches) ?? NEW_KR_VALUE;

        let keyResultId = "";
        let taskForceId = "";
        if (krKind === "group_kr" && kr.group_kr_hint) {
          const tfMatches = rankGroupTfMatches(kr.group_kr_hint, tfsInGroup, krsInGroup);
          const topTf = tfMatches[0];
          if (topTf && topTf.score >= 0.5) {
            keyResultId = topTf.keyResult.id;
            taskForceId = topTf.taskForce.id;
          }
        }

        return {
          tempId: uuidv4(),
          checked: true,
          sourceLabel: kr.source_label,
          groupKrHint: kr.group_kr_hint,
          mappedTo,
          krKind,
          keyResultId,
          taskForceId,
          label: kr.label,
          weightPct: kr.weight_pct != null ? String(kr.weight_pct) : "",
          category: kr.category ?? "",
          activity: kr.activity ?? "",
          strengthRole: kr.strength_role ?? "",
          weaknessRole: kr.weakness_role ?? "",
          criteria: kr.criteria ?? "",
          supplement: kr.supplement ?? "",
          months: kr.months.map((m, i) => monthDraftFromExtracted(m, ((i % 3) + 1) as 1 | 2 | 3)),
        };
      });
      setKrDrafts(drafts);
      setStep("review");
    } catch (e) {
      setError(formatErrorForUser("AI解析に失敗しました", e));
      setStep("input");
    }
  }, [rawText, attachment, fiscalYear, quarter, allPersonalKrs, tfsInGroup, krsInGroup]);

  // ===== 登録 =====

  const checkedKrCount = krDrafts.filter(d => d.checked && d.label.trim()).length;
  const checkedMonthCount = krDrafts.reduce((sum, d) => sum + (d.checked ? d.months.filter(m => m.checked).length : 0), 0);
  const hasAnything = checkedKrCount > 0;

  const handleApply = useCallback(async () => {
    setStep("applying");
    setError(null);
    // 対応づけ先の月次計画を確実に読み込んでから計画を組む（重複作成防止。ファイル冒頭コメント参照）
    const targetIds = Array.from(new Set(krDrafts.filter(d => d.checked && d.mappedTo !== NEW_KR_VALUE).map(d => d.mappedTo)));
    await Promise.all(targetIds.map(id => ensureKrDetailLoaded(id)));

    const nowIso = new Date().toISOString();
    const sourceLabel = `個人OKR${docType === "quarterly" ? "設定フォーム" : "_月次振返り記録"} ${quarter}・${new Date().toLocaleDateString("ja-JP")}取込`;

    const existingMonthsByKrIdAndIndex: Record<string, Partial<Record<1 | 2 | 3, PersonalKrMonth>>> = {};
    for (const id of targetIds) {
      const list = active(monthsByKr[id] ?? []);
      existingMonthsByKrIdAndIndex[id] = Object.fromEntries(list.map(m => [m.month_index, m])) as Partial<Record<1 | 2 | 3, PersonalKrMonth>>;
    }

    const drafts: ImportKrDraftInput[] = krDrafts.map(d => ({
      checked: d.checked && !!d.label.trim(),
      mappedExistingId: d.mappedTo === NEW_KR_VALUE ? null : d.mappedTo,
      newId: uuidv4(),
      krKind: d.krKind,
      keyResultId: d.keyResultId || null,
      taskForceId: d.taskForceId || null,
      label: d.label.trim(),
      weightPct: parseWeightPct(d.weightPct) ?? 0,
      category: d.category || null,
      activity: d.activity || null,
      strengthRole: d.strengthRole || null,
      weaknessRole: d.weaknessRole || null,
      criteria: d.criteria || null,
      supplement: d.supplement || null,
      months: docType === "quarterly" ? [] : d.months.map((m): ImportMonthDraftInput => ({
        checked: m.checked,
        monthIndex: m.monthIndex,
        newId: uuidv4(),
        positioning: m.positioning || null,
        activities: m.activities || null,
        targetAndEvidence: m.targetAndEvidence || null,
        risks: m.risks || null,
        bandTarget: m.bandTarget,
        weightOverridePct: parseWeightPct(m.weightOverridePct),
        reviewText: m.reviewText || null,
        selfEvalPct: parsePercentValue(m.selfEvalPct),
        gmEvalPct: parsePercentValue(m.gmEvalPct),
        gmComment: m.gmComment || null,
      })),
    }));

    const plan = buildImportApplyPlan({
      fiscalYear, quarter, memberId: currentUser.id, groupId: currentGroupId ?? DEFAULT_OKR_GROUP_ID,
      sourceLabel, nowIso, drafts, existingKrsById, existingMonthsByKrIdAndIndex,
      nextDisplayOrderStart: existingKrsInPeriod.length,
    });

    const total = Math.max(1, plan.krs.length + plan.months.length);
    setSaveProgress({ current: 0, total, label: "登録処理を開始しています…" });
    let count = 0;
    try {
      for (const kr of plan.krs) {
        setSaveProgress(p => ({ ...p, current: count, label: `個人KR「${kr.label}」を保存中…` }));
        await saveKr(kr);
        count++;
        setSaveProgress(p => ({ ...p, current: count }));
      }
      for (const month of plan.months) {
        setSaveProgress(p => ({ ...p, current: count, label: `${month.month_index}か月目の計画・振り返りを保存中…` }));
        await saveMonth(month);
        count++;
        setSaveProgress(p => ({ ...p, current: count }));
      }
      setApplyResults({ krCount: plan.krs.length, monthCount: plan.months.length });
      setStep("done");
    } catch (e) {
      setError(formatErrorForUser("登録に失敗しました", e));
      setStep("review");
    }
  }, [
    krDrafts, docType, quarter, fiscalYear, currentUser.id, currentGroupId, existingKrsById,
    existingKrsInPeriod.length, monthsByKr, ensureKrDetailLoaded, saveKr, saveMonth,
  ]);

  const updateKr = (tempId: string, patch: Partial<KrDraft>) =>
    setKrDrafts(prev => prev.map(d => (d.tempId === tempId ? { ...d, ...patch } : d)));
  const updateMonth = (krTempId: string, monthTempId: string, patch: Partial<MonthDraft>) =>
    setKrDrafts(prev => prev.map(d => (d.tempId === krTempId
      ? { ...d, months: d.months.map(m => (m.tempId === monthTempId ? { ...m, ...patch } : m)) }
      : d)));

  const handleReset = () => {
    setStep("input"); setRawText(""); setAttachment(null); setFileError(null); setError(null);
    setKrDrafts([]); setApplyResults(null); setImportSourceInfo(null); setImportWarnings([]);
  };

  const charCount = rawText.trim().length;
  const canAnalyze = charCount >= 10 || !!attachment;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "stretch", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="panel-slide-up"
        style={{ width: "min(820px, 100vw)", height: "100%", background: "var(--color-bg-primary)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "-4px 0 24px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="ai-shimmer" style={{ background: "var(--gradient-ai)", padding: "14px 20px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <span style={{ fontSize: "20px" }}>📥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>個人OKRをKintoneから取込</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
              {step === "analyzing" ? "AI解析中..." : "Kintone「個人OKR設定フォーム」／「個人OKR_月次振返り記録」のPDF・テキスト → 確認 → 登録"}
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
              <FileDropZone onAttach={handleAttach}>
                <div style={{ border: "2px dashed var(--color-border-primary)", borderRadius: "var(--radius-lg)", padding: "20px", textAlign: "center", background: "var(--color-bg-secondary)" }}>
                  <div style={{ fontSize: "28px", marginBottom: "8px" }}>📄</div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", marginBottom: "8px" }}>
                    Kintoneの個人OKR画面をPDF化してドラッグ＆ドロップ
                  </div>
                  <FileAttachButton attachment={attachment} onAttach={handleAttach} onRemove={() => setAttachment(null)} />
                  <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
                    「個人四半期OKR3Q」「個人OKR_月次振返り記録」のいずれのPDFでもかまいません。種別はAIが判定します。
                  </div>
                </div>
              </FileDropZone>
              {fileError && <ErrorBox message={fileError} />}

              <div>
                <FieldLabel>または直接貼り付け</FieldLabel>
                <textarea
                  value={rawText}
                  onChange={e => { setRawText(e.target.value); if (e.target.value) setAttachment(null); }}
                  placeholder={"Kintoneの「個人OKR設定フォーム」または「個人OKR_月次振返り記録」の画面テキストをそのまま貼り付けてください。"}
                  rows={10}
                  style={{ width: "100%", padding: "10px 12px", fontSize: "12px", fontFamily: "monospace", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }}
                />
                {charCount > 0 && <CharCountNotice charCount={charCount} />}
              </div>

              <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "10px 12px", lineHeight: 1.7 }}>
                <strong>🔒 AIに送信される内容：</strong>添付したファイル、または貼り付けたテキストの全文です。
                「個人OKR_月次振返り記録」にはGM評価・面談コメントが含まれる場合があり、それも送信されます。
                個人四半期KR・週の目標状態・メモ等、アプリ内に既に保存されている内容はこの取込では一切送信しません。
              </div>

              {error && <ErrorBox message={error} />}
            </div>
          )}

          {step === "analyzing" && (
            <SaveProgressLoader
              current={analyzeProgress.current} total={analyzeProgress.total} label={analyzeProgress.label}
              title="個人OKRを解析しています"
            />
          )}

          {step === "review" && (
            <ReviewStep
              docType={docType} setDocType={setDocType}
              fiscalYear={fiscalYear} setFiscalYear={setFiscalYear}
              quarter={quarter} setQuarter={setQuarter}
              krDrafts={krDrafts} updateKr={updateKr} updateMonth={updateMonth}
              existingKrsInPeriod={existingKrsInPeriod}
              krsInGroup={krsInGroup} tfsInGroup={tfsInGroup}
              error={error} checkedKrCount={checkedKrCount} checkedMonthCount={checkedMonthCount}
              hasAnything={hasAnything} onApply={handleApply}
              sourceInfo={importSourceInfo} warnings={importWarnings}
            />
          )}

          {step === "applying" && (
            <SaveProgressLoader current={saveProgress.current} total={saveProgress.total} label={saveProgress.label} title="個人OKRを登録しています" />
          )}

          {step === "done" && applyResults && (
            <DoneStep results={applyResults} onReset={handleReset} onClose={onClose} />
          )}
        </div>

        {step === "input" && (
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--color-border-primary)", padding: "10px 14px", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>
              評価の確定・面談記録はKintoneが正本のまま。ここでの取込は本人のみが見える内容の反映です。
            </span>
            <button onClick={handleAnalyze} disabled={!canAnalyze} style={primaryButtonStyle(!canAnalyze)}>🤖 AIで解析する</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== ReviewStep =====

function ReviewStep({
  docType, setDocType, fiscalYear, setFiscalYear, quarter, setQuarter,
  krDrafts, updateKr, updateMonth, existingKrsInPeriod, krsInGroup, tfsInGroup,
  error, checkedKrCount, checkedMonthCount, hasAnything, onApply,
  sourceInfo, warnings,
}: {
  docType: PersonalOkrDocType; setDocType: (t: PersonalOkrDocType) => void;
  fiscalYear: number; setFiscalYear: (n: number) => void;
  quarter: Quarter; setQuarter: (q: Quarter) => void;
  krDrafts: KrDraft[];
  updateKr: (tempId: string, patch: Partial<KrDraft>) => void;
  updateMonth: (krTempId: string, monthTempId: string, patch: Partial<MonthDraft>) => void;
  existingKrsInPeriod: PersonalKr[];
  krsInGroup: KeyResult[]; tfsInGroup: TaskForce[];
  error: string | null; checkedKrCount: number; checkedMonthCount: number; hasAnything: boolean;
  onApply: () => void;
  sourceInfo: {
    quarterlySource: KintoneImportEngineSource; monthlySource: KintoneImportEngineSource;
    originalCharCount: number; aiSentCharCount: number;
  } | null;
  warnings: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {sourceInfo && <ImportSourceNotice info={sourceInfo} />}
      {warnings.map((w, i) => <WarningBox key={i} message={w} />)}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
        <span style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>
          {docType === "quarterly" ? "個人四半期OKRとして読み取りました" : "個人月次振返り（計画・振り返り）として読み取りました"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>違っていたら切り替え：</span>
        <SegButton active={docType === "quarterly"} onClick={() => setDocType("quarterly")}>四半期OKR</SegButton>
        <SegButton active={docType === "monthly_review"} onClick={() => setDocType("monthly_review")}>月次振返り</SegButton>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <div style={{ flex: "0 0 110px" }}>
          <FieldLabel>会計年度</FieldLabel>
          <input type="number" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value) || fiscalYear)} style={inputStyle} />
        </div>
        <div style={{ flex: "0 0 160px" }}>
          <FieldLabel>四半期</FieldLabel>
          <CustomSelect value={quarter} onChange={v => setQuarter(v as Quarter)} options={QUARTER_OPTIONS} />
        </div>
        <div style={{ flex: 1, fontSize: "11px", color: "var(--color-text-tertiary)", alignSelf: "flex-end", paddingBottom: "8px" }}>
          既存の個人KRへの対応づけ候補は、この年度・四半期のものから提示されます。
        </div>
      </div>

      <div>
        <SectionHeader icon="🔑" title={`個人KR 候補（${krDrafts.length}件）`} />
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 10px" }}>
          🔴「対応づけ」で既存のKRを選ぶと、その行を上書き更新します。既存の週の目標状態・メモはこの操作で失われません。
          「新規KRとして作成」を選んだ場合のみ新しい行が作られます。既存にあってここに無いKRには一切触れません。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {krDrafts.map(draft => (
            <KrDraftCard
              key={draft.tempId}
              draft={draft}
              docType={docType}
              existingKrsInPeriod={existingKrsInPeriod}
              krsInGroup={krsInGroup}
              tfsInGroup={tfsInGroup}
              onChange={patch => updateKr(draft.tempId, patch)}
              onChangeMonth={(monthTempId, patch) => updateMonth(draft.tempId, monthTempId, patch)}
            />
          ))}
        </div>
        {krDrafts.length === 0 && (
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>個人KR候補は見つかりませんでした</div>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      <button onClick={onApply} disabled={!hasAnything} style={primaryButtonStyle(!hasAnything)}>
        {hasAnything ? `登録する（KR ${checkedKrCount}件${checkedMonthCount > 0 ? `・月 ${checkedMonthCount}件` : ""}）` : "登録する項目がありません"}
      </button>
    </div>
  );
}

function KrDraftCard({
  draft, docType, existingKrsInPeriod, krsInGroup, tfsInGroup, onChange, onChangeMonth,
}: {
  draft: KrDraft;
  docType: PersonalOkrDocType;
  existingKrsInPeriod: PersonalKr[];
  krsInGroup: KeyResult[]; tfsInGroup: TaskForce[];
  onChange: (patch: Partial<KrDraft>) => void;
  onChangeMonth: (monthTempId: string, patch: Partial<MonthDraft>) => void;
}) {
  const tfsForSelectedKr = useMemo(
    () => (draft.keyResultId ? tfsInGroup.filter(tf => tf.kr_id === draft.keyResultId) : []),
    [tfsInGroup, draft.keyResultId],
  );
  const mappedExisting = existingKrsInPeriod.find(k => k.id === draft.mappedTo) ?? null;

  return (
    <div style={{ border: `1.5px solid ${draft.checked ? "var(--color-brand)" : "var(--color-border-primary)"}`, borderRadius: "var(--radius-lg)", padding: "14px 16px", background: draft.checked ? "var(--color-brand-light)" : "var(--color-bg-secondary)" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "10px" }}>
        <input type="checkbox" checked={draft.checked} onChange={e => onChange({ checked: e.target.checked })} style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--color-brand)" }} />
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
          {draft.label || "（名称未設定）"}{draft.sourceLabel ? ` （${draft.sourceLabel}）` : ""}
        </span>
      </label>

      {draft.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <FieldLabel>対応づけ（🔴既存を選ぶと週・メモを残したまま更新します）</FieldLabel>
            <CustomSelect
              value={draft.mappedTo}
              onChange={v => onChange({ mappedTo: v })}
              options={[
                { value: NEW_KR_VALUE, label: "＋ 新規KRとして作成" },
                ...existingKrsInPeriod.map(k => ({ value: k.id, label: `対応づけ：${k.label}` })),
              ]}
              searchable searchPlaceholder="既存の個人KRで検索..."
            />
            {mappedExisting && (
              <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                「{mappedExisting.label}」を更新します。既存の週の目標状態・メモはそのまま残ります。
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>KR種別</FieldLabel>
              <CustomSelect value={draft.krKind} onChange={v => onChange({ krKind: v as PersonalKrKind })} options={KR_KIND_OPTIONS} />
            </div>
            <div style={{ flex: "0 0 100px" }}>
              <FieldLabel>ウェイト（%）</FieldLabel>
              <input value={draft.weightPct} onChange={e => onChange({ weightPct: e.target.value })} style={inputStyle} />
            </div>
          </div>

          {draft.krKind === "group_kr" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {draft.groupKrHint && (
                <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", background: "var(--color-bg-tertiary)", borderLeft: "3px solid var(--color-border-primary)", padding: "5px 8px", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0" }}>
                  原文のヒント：「{draft.groupKrHint}」
                </div>
              )}
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <FieldLabel>グループKR（表示中の部署のみ）</FieldLabel>
                  <CustomSelect
                    value={draft.keyResultId}
                    onChange={v => onChange({ keyResultId: v, taskForceId: "" })}
                    options={[{ value: "", label: "（未選択）" }, ...krsInGroup.map(kr => ({ value: kr.id, label: kr.title }))]}
                    searchable
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <FieldLabel>TF（任意）</FieldLabel>
                  <CustomSelect
                    value={draft.taskForceId}
                    onChange={v => onChange({ taskForceId: v })}
                    options={[{ value: "", label: "（未選択）" }, ...tfsForSelectedKr.map(tf => ({ value: tf.id, label: `TF${tf.tf_number} ${tf.name}` }))]}
                    disabled={!draft.keyResultId}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <FieldLabel>KR名（タブに出す短い名前）</FieldLabel>
            <input value={draft.label} onChange={e => onChange({ label: e.target.value })} style={inputStyle} />
          </div>

          <details>
            <summary style={{ cursor: "pointer", fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-secondary)" }}>このKRの内容（Kintone個人OKR設定フォームの欄）</summary>
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <LabeledTextarea label="●対象業務カテゴリ" value={draft.category} onChange={v => onChange({ category: v })} />
              <LabeledTextarea label="●実施内容" value={draft.activity} onChange={v => onChange({ activity: v })} />
              <LabeledTextarea label="●得意領域の強化：（役割）" value={draft.strengthRole} onChange={v => onChange({ strengthRole: v })} />
              <LabeledTextarea label="●苦手領域の克服：（役割）" value={draft.weaknessRole} onChange={v => onChange({ weaknessRole: v })} />
              <LabeledTextarea label="●達成基準" value={draft.criteria} onChange={v => onChange({ criteria: v })} />
              <LabeledTextarea label="●補足" value={draft.supplement} onChange={v => onChange({ supplement: v })} />
            </div>
          </details>

          {docType === "monthly_review" && draft.months.length > 0 && (
            <div style={{ borderTop: "1px dotted var(--color-border-primary)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <FieldLabel>月次計画・振り返り（{draft.months.length}か月分）</FieldLabel>
              {draft.months.map(m => (
                <MonthDraftCard key={m.tempId} month={m} onChange={patch => onChangeMonth(m.tempId, patch)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthDraftCard({ month, onChange }: { month: MonthDraft; onChange: (patch: Partial<MonthDraft>) => void }) {
  return (
    <div style={{ border: `1px solid ${month.checked ? "#2563eb" : "var(--color-border-primary)"}`, borderRadius: "var(--radius-md)", padding: "10px 12px", background: month.checked ? "#eff6ff" : "var(--color-bg-primary)" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "8px" }}>
        <input type="checkbox" checked={month.checked} onChange={e => onChange({ checked: e.target.checked })} style={{ width: "14px", height: "14px", cursor: "pointer", accentColor: "#2563eb" }} />
        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>{month.monthIndex}か月目</span>
        <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>対応する月</span>
        <CustomSelect
          value={String(month.monthIndex)}
          onChange={v => onChange({ monthIndex: Number(v) as 1 | 2 | 3 })}
          options={[1, 2, 3].map(n => ({ value: String(n), label: `${n}か月目` }))}
          style={{ width: "110px" }}
        />
      </label>

      {month.checked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <LabeledTextarea label="【位置づけ】" value={month.positioning} onChange={v => onChange({ positioning: v })} />
          <LabeledTextarea label="当月に取り組む内容（計画）" value={month.activities} onChange={v => onChange({ activities: v })} />
          <LabeledTextarea label="当月末の達成目標と、その証拠（計画値）" value={month.targetAndEvidence} onChange={v => onChange({ targetAndEvidence: v })} />
          <LabeledTextarea label="リスクと依存関係" value={month.risks} onChange={v => onChange({ risks: v })} />

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <div>
              <FieldLabel>当月末 達成度バンド（狙い）</FieldLabel>
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                {BAND_VALUES.map(b => {
                  const disabled = isBandDisabled(b);
                  const on = month.bandTarget === b;
                  return (
                    <button
                      key={b}
                      onClick={() => !disabled && onChange({ bandTarget: on ? null : b })}
                      disabled={disabled}
                      title={BAND_LABELS[b]}
                      style={{
                        fontFamily: "inherit", fontSize: "10.5px", padding: "3px 9px", borderRadius: "var(--radius-sm)",
                        border: `1px solid ${on ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                        background: on ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                        color: on ? "var(--color-brand)" : "var(--color-text-tertiary)",
                        fontWeight: on ? 700 : 400, textDecoration: disabled ? "line-through" : "none",
                        opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer",
                      }}
                    >{b}</button>
                  );
                })}
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", alignSelf: "center" }}>複数基準の説明文しか無い場合は未設定のままにしています</span>
              </div>
            </div>
            <div style={{ flex: "0 0 140px" }}>
              <FieldLabel>ウェイト特例（%・任意）</FieldLabel>
              <input value={month.weightOverridePct} onChange={e => onChange({ weightOverridePct: e.target.value })} placeholder="例：25" style={inputStyle} />
            </div>
          </div>

          <div style={{ borderTop: "1px dashed var(--color-border-primary)", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <LabeledTextarea label="振り返り本文" value={month.reviewText} onChange={v => onChange({ reviewText: v })} />
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>自己評価（%）</FieldLabel>
                <input value={month.selfEvalPct} onChange={e => onChange({ selfEvalPct: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>GM評価（%）</FieldLabel>
                <input value={month.gmEvalPct} onChange={e => onChange({ gmEvalPct: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <LabeledTextarea label="GMコメント" value={month.gmComment} onChange={v => onChange({ gmComment: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
    </div>
  );
}

function SegButton({ active: isActive, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", cursor: "pointer",
        borderRadius: "var(--radius-full)",
        border: `1px solid ${isActive ? "var(--color-brand)" : "var(--color-border-primary)"}`,
        background: isActive ? "var(--color-brand)" : "transparent",
        color: isActive ? "#fff" : "var(--color-text-secondary)",
        fontWeight: isActive ? 700 : 400,
      }}
    >{children}</button>
  );
}

// ===== DoneStep =====

function DoneStep({ results, onReset, onClose }: { results: { krCount: number; monthCount: number }; onReset: () => void; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "48px" }}>🎉</div>
      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>登録が完了しました</div>
      <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
        <div>個人KR {results.krCount}件を反映しました（新規作成・既存更新の両方を含みます）</div>
        {results.monthCount > 0 && <div>月次計画・振り返り {results.monthCount}件を反映しました</div>}
        <div style={{ marginTop: "8px", color: "var(--color-text-tertiary)", fontSize: "12px" }}>Kintoneが正本です。取り込んだ内容はこのアプリ上でも編集できます。</div>
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
        <button onClick={onReset} style={ghostButtonStyle}>別の資料を読み込む</button>
        <button onClick={onClose} style={primaryButtonStyle(false)}>閉じる</button>
      </div>
    </div>
  );
}

// ===== ユーティリティ =====

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "16px" }}>{icon}</span>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)" }}>{title}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-secondary)", marginBottom: "5px" }}>{children}</div>;
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ fontSize: "12px", color: "var(--color-text-danger)", background: "var(--color-bg-danger)", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>{message}</div>;
}

/** 診断用：抽出文字数の表示（解析実行前のみ・入力欄からの推定量）。閾値超えは行動が分かる警告文を添える。 */
function CharCountNotice({ charCount }: { charCount: number }) {
  const tooLong = isPersonalOkrImportTextTooLong(charCount);
  return (
    <div style={{ fontSize: "10.5px", color: tooLong ? "var(--color-text-danger)" : "var(--color-text-tertiary)", marginTop: "6px" }}>
      抽出できた文字数：{charCount.toLocaleString("ja-JP")}字
      {tooLong && "　⚠️ 量が多いため、四半期OKRと月次振返りを別々に取り込むことをお勧めします"}
    </div>
  );
}

/**
 * 🔴 決定的パーサ（画面の構造から読み取り）／AIどちらの経路で読み取ったかを確認画面に必ず
 * 表示する（山本さんが実機で報告できるようにするための唯一の手がかり。v3.56）。
 * あわせて「元◯◯字→送信◯◯字」を表示し、削減の実感を出す（AI未使用なら送信0字）。
 */
function ImportSourceNotice({ info }: {
  info: { quarterlySource: KintoneImportEngineSource; monthlySource: KintoneImportEngineSource; originalCharCount: number; aiSentCharCount: number };
}) {
  const tooLong = isPersonalOkrImportTextTooLong(info.aiSentCharCount);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "8px 12px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {describeKintoneImportSource(info.quarterlySource, info.monthlySource)}
      </div>
      <div style={{ fontSize: "10.5px", color: tooLong ? "var(--color-text-danger)" : "var(--color-text-tertiary)" }}>
        {"元の文字数：" + info.originalCharCount.toLocaleString("ja-JP") + "字　→　AIへの送信：" +
          (info.aiSentCharCount === 0 ? "0字（AI未使用）" : info.aiSentCharCount.toLocaleString("ja-JP") + "字")}
        {tooLong && "　⚠️ 量が多いため、四半期OKRと月次振返りを別々に取り込むことをお勧めします"}
      </div>
    </div>
  );
}

/** 呼び出し1・2のどちらかが失敗したときの非致命的な警告（赤いErrorBoxとは区別する）。 */
function WarningBox({ message }: { message: string }) {
  return (
    <div style={{ fontSize: "12px", color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
      ⚠️ {message}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", boxSizing: "border-box", fontFamily: "inherit",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "11px 24px",
  background: disabled ? "var(--color-bg-tertiary)" : "linear-gradient(135deg, var(--color-ai-to), var(--color-ai-from-deep))",
  border: "none", borderRadius: "var(--radius-md)",
  color: disabled ? "var(--color-text-tertiary)" : "#fff",
  fontSize: "13px", fontWeight: "600", cursor: disabled ? "not-allowed" : "pointer",
  boxShadow: disabled ? "none" : "0 2px 8px rgba(124,58,237,0.35)", width: "100%",
});

const ghostButtonStyle: React.CSSProperties = {
  padding: "9px 16px", fontSize: "12px", background: "transparent",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  color: "var(--color-text-secondary)", cursor: "pointer",
};
