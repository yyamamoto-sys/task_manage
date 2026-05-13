// src/components/lab/KrJointSessionFlow.tsx
//
// 【設計意図】
// 合同チェックイン／ウィンセッションのための入力フロー。
// グループ全体での議事メモを1回貼り付け／添付し、AI が複数KRぶんを一括で振り分けて抽出する。
// 抽出結果はKRごとにタブで確認・修正して、KRごとに kr_sessions を保存する。
// 単一KR用の KrSessionPanel と並列の役割。OkrDashboardView の「② セッション記録」内で
// モードトグルにより切り替える。

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
import {
  extractJointCheckinData, extractJointWinSessionData,
} from "../../lib/ai/krSessionExtractor";

type JointMode = "checkin" | "win_session";
type Step = "input" | "extracting" | "review" | "saving" | "done";

const PHASES_CHECKIN = [
  "文字起こしを読み込んでいます…",
  "KRごとの発言を振り分けています…",
  "宣言・シグナルを抽出しています…",
  "結果をまとめています…",
];
const PHASES_WIN = [
  "文字起こしを読み込んでいます…",
  "KRごとの発言を振り分けています…",
  "前回宣言と照合しています…",
  "学び・外部環境を抽出しています…",
];

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
  declarations: { member_short_name: string; content: string; due_date: string | null }[];
}
interface WinDraft {
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  declaration_results: { declaration_index: number; result_status: "achieved" | "partial" | "not_achieved" | null; result_note: string }[];
  learnings: string;
  external_changes: string;
}
interface KrPanelState {
  krId: string;
  krTitle: string;
  selected: boolean;
  /** チェックイン時のドラフト */
  checkin?: CheckinDraft;
  /** ウィン時のドラフト */
  win?: WinDraft;
  /** ウィン時に表示する前回チェックインの宣言（result_results の参照用） */
  previousDeclarations?: KrDeclaration[];
}

interface Props {
  currentUser: Member;
  /** 既定で選択されるKR（OKRモードで選択中のKR）。指定があれば対象に含める */
  initialKrId?: string;
  onSaved?: () => void;
}

export function KrJointSessionFlow({ currentUser, initialKrId, onSaved }: Props) {
  const rawKrs = useAppStore(s => s.keyResults);
  const rawMembers = useAppStore(s => s.members);
  const activeKrs = useMemo(() => (rawKrs ?? []).filter(k => !k.is_deleted), [rawKrs]);
  const memberById = useMemo(() => new Map((rawMembers ?? []).filter(m => !m.is_deleted).map(m => [m.id, m])), [rawMembers]);
  const memberShortNames = useMemo(() => [...memberById.values()].map(m => m.short_name), [memberById]);

  const [mode, setMode] = useState<JointMode>("checkin");
  const [selectedKrIds, setSelectedKrIds] = useState<Set<string>>(() => new Set(activeKrs.map(k => k.id)));
  useEffect(() => {
    // アクティブKR一覧が変わったら、それを既定値として再選択。initialKrId があれば必ず含める
    const s = new Set(activeKrs.map(k => k.id));
    if (initialKrId) s.add(initialKrId);
    setSelectedKrIds(s);
  }, [activeKrs, initialKrId]);

  const [transcript, setTranscript] = useState("");
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string }>({ current: 0, total: 1, label: "" });

  // 各KRのドラフト（review ステップで使う）
  const [panels, setPanels] = useState<KrPanelState[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  const dropAreaRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // FileDropZone を素直に流用してもいいが、ここは直接処理
    if (file.name.toLowerCase().endsWith(".vtt") || file.name.toLowerCase().endsWith(".srt") || file.type.startsWith("text/")) {
      const reader = new FileReader();
      reader.onload = ev => setTranscript((ev.target?.result as string) ?? "");
      reader.readAsText(file, "utf-8");
    } else {
      // PDF/docx は FileAttachButton 経由で（こちらでは扱わない）
      alert("ここに直接ドロップできるのはテキスト系（.vtt / .srt / .txt 等）です。PDF・Word は上の📎ボタンで添付してください。");
    }
  }, []);

  const toggleKr = (id: string) => {
    setSelectedKrIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ===== 抽出 =====

  const handleExtract = useCallback(async () => {
    setError(null);
    const text = transcript.trim();
    if (!text && !attachment) { setError("文字起こしを貼り付けるか、ファイルを添付してください。"); return; }
    const targetKrs = activeKrs.filter(k => selectedKrIds.has(k.id));
    if (targetKrs.length === 0) { setError("対象KRを1つ以上選択してください。"); return; }

    setStep("extracting");
    try {
      if (mode === "checkin") {
        const results = await extractJointCheckinData({
          krs: targetKrs.map(k => ({ id: k.id, title: k.title })),
          memberShortNames,
          transcript: text,
          attachment: attachment ?? undefined,
        });
        // KRごとのパネルを構築（AI が返さなかった KR は空ドラフトで埋める）
        const byKr = new Map(results.map(r => [r.kr_id, r.checkin] as const));
        const next: KrPanelState[] = targetKrs.map(k => ({
          krId: k.id, krTitle: k.title, selected: true,
          checkin: byKr.get(k.id) ?? { signal: null, signal_comment: "", declarations: [] },
        }));
        setPanels(next); setActiveTab(0); setStep("review");
      } else {
        // ウィン：前回チェックイン宣言を各KRぶん取得
        const prevByKr: Record<string, KrDeclaration[]> = {};
        for (const k of targetKrs) {
          const last = await fetchLatestCheckinSession(k.id).catch(() => null);
          prevByKr[k.id] = last ? await fetchKrDeclarations(last.id).catch(() => []) : [];
        }
        const results = await extractJointWinSessionData({
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
        const byKr = new Map(results.map(r => [r.kr_id, r.win] as const));
        const next: KrPanelState[] = targetKrs.map(k => ({
          krId: k.id, krTitle: k.title, selected: true,
          win: byKr.get(k.id) ?? { signal: null, signal_comment: "", declaration_results: [], learnings: "", external_changes: "" },
          previousDeclarations: prevByKr[k.id] ?? [],
        }));
        setPanels(next); setActiveTab(0); setStep("review");
      }
    } catch (e) {
      setError(formatErrorForUser("AI抽出に失敗しました", e));
      setStep("input");
    }
  }, [transcript, attachment, activeKrs, selectedKrIds, memberShortNames, memberById, mode]);

  // ===== 保存 =====

  const handleSave = useCallback(async () => {
    setStep("saving");
    setError(null);
    try {
      const weekStart = getThisMonday();
      const selected = panels.filter(p => p.selected);
      const total = selected.reduce((n, p) => n + 1 + (mode === "checkin" ? (p.checkin?.declarations.length ?? 0) : (p.win?.declaration_results.length ?? 0)), 1);
      let cur = 0;
      setProgress({ current: 0, total, label: "保存を開始しています…" });

      for (const p of selected) {
        setProgress(pr => ({ ...pr, current: cur, label: `${p.krTitle} を保存中…` }));
        if (mode === "checkin") {
          const session = await insertKrSession({
            kr_id: p.krId,
            week_start: weekStart,
            session_type: "checkin",
            signal: p.checkin?.signal ?? null,
            signal_comment: p.checkin?.signal_comment ?? "",
            learnings: "", external_changes: "", transcript: "", summary: "", decisions: "", kr_mentions: "",
            created_by: currentUser.id, updated_by: currentUser.id,
          } as Parameters<typeof insertKrSession>[0]);
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
            transcript: "", summary: "", decisions: "", kr_mentions: "",
            created_by: currentUser.id, updated_by: currentUser.id,
          } as Parameters<typeof insertKrSession>[0]);
          cur++; setProgress(pr => ({ ...pr, current: cur }));
          // 前回チェックイン宣言の結果更新
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
  }, [panels, mode, currentUser.id, memberById, onSaved]);

  const handleReset = () => {
    setTranscript(""); setAttachment(null); setPanels([]); setActiveTab(0);
    setError(null); setStep("input");
  };

  // ===== 描画 =====

  const inputCount = transcript.trim().length;
  const canExtract = (inputCount >= 20 || !!attachment) && selectedKrIds.size > 0;

  if (step === "extracting") {
    return <div style={{ padding: "32px 24px" }}><AIProgressLoader phases={mode === "checkin" ? PHASES_CHECKIN : PHASES_WIN} intervalMs={3500} /></div>;
  }
  if (step === "saving") {
    return <div style={{ padding: "32px 24px" }}><SaveProgressLoader current={progress.current} total={progress.total} label={progress.label} title="合同セッションを保存しています" /></div>;
  }
  if (step === "done") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "40px 20px" }}>
        <div style={{ fontSize: "44px" }}>🎉</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>保存が完了しました</div>
        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{panels.filter(p => p.selected).length} 件のKRぶんを記録しました</div>
        <button onClick={handleReset} style={primaryBtn}>続けて別のセッションを記録する</button>
      </div>
    );
  }

  if (step === "review") {
    const cur = panels[activeTab];
    return (
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>抽出結果を確認・修正してください</span>
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>（KRごとにタブで表示。チェック外のKRは保存しません）</span>
          <div style={{ flex: 1 }} />
          <button onClick={handleReset} style={ghostBtn}>やり直す</button>
        </div>

        {/* KRタブ */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "6px" }}>
          {panels.map((p, i) => (
            <button key={p.krId} onClick={() => setActiveTab(i)} style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "var(--radius-md)",
              border: i === activeTab ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
              background: i === activeTab ? "var(--color-brand-light)" : "var(--color-bg-primary)",
              color: i === activeTab ? "var(--color-brand)" : "var(--color-text-secondary)",
              cursor: "pointer", fontSize: "12px", fontWeight: i === activeTab ? 600 : 400,
            }}>
              <input
                type="checkbox" checked={p.selected}
                onClick={e => e.stopPropagation()}
                onChange={e => { const v = e.target.checked; setPanels(prev => prev.map((q, j) => j === i ? { ...q, selected: v } : q)); }}
                style={{ accentColor: "var(--color-brand)" }}
              />
              {p.krTitle.length > 22 ? p.krTitle.slice(0, 22) + "…" : p.krTitle}
            </button>
          ))}
        </div>

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
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "20px" }}>このKRは保存対象から外れています。上のチェックでON/OFFできます。</div>
        )}

        {error && <ErrBox>{error}</ErrBox>}

        <div style={{ display: "flex", gap: "8px", paddingTop: "8px", borderTop: "1px solid var(--color-border-primary)" }}>
          <div style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={panels.filter(p => p.selected).length === 0} style={{ ...primaryBtn, opacity: panels.filter(p => p.selected).length === 0 ? 0.5 : 1 }}>
            {mode === "checkin" ? "チェックインを保存" : "ウィンセッションを保存"}（{panels.filter(p => p.selected).length} KR）
          </button>
        </div>
      </div>
    );
  }

  // step === "input"
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
        合同会議の議事メモを1回貼り付けるか添付すると、選択した各KRの宣言・シグナル・学びをAIが自動で振り分けます。
      </div>

      {/* モード */}
      <div>
        <Label>セッションの種類</Label>
        <div style={{ display: "flex", gap: "6px" }}>
          {([
            { v: "checkin" as const, label: "チェックイン" },
            { v: "win_session" as const, label: "ウィンセッション" },
          ]).map(opt => (
            <button key={opt.v} onClick={() => setMode(opt.v)} style={{
              fontSize: "12px", padding: "6px 14px", borderRadius: "var(--radius-md)",
              border: mode === opt.v ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
              background: mode === opt.v ? "var(--color-brand-light)" : "var(--color-bg-primary)",
              color: mode === opt.v ? "var(--color-brand)" : "var(--color-text-secondary)",
              cursor: "pointer", fontWeight: mode === opt.v ? 600 : 400,
            }}>{opt.label}</button>
          ))}
        </div>
      </div>

      {/* 対象KR（複数選択） */}
      <div>
        <Label>対象KR（複数選択可・既定は全KR）</Label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {activeKrs.length === 0 && <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>KRが登録されていません</span>}
          {activeKrs.map(k => {
            const on = selectedKrIds.has(k.id);
            return (
              <button key={k.id} onClick={() => toggleKr(k.id)} style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "var(--radius-full)",
                border: on ? "1.5px solid var(--color-brand)" : "1px solid var(--color-border-primary)",
                background: on ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                color: on ? "var(--color-brand)" : "var(--color-text-secondary)",
                cursor: "pointer", fontSize: "11px", fontWeight: on ? 600 : 400, maxWidth: "320px",
              }}>
                <span>{on ? "✓" : "○"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 議事メモ入力 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <Label>議事メモ / 文字起こし</Label>
          <FileAttachButton attachment={attachment} onAttach={setAttachment} onRemove={() => setAttachment(null)} />
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{inputCount.toLocaleString()} 文字</span>
        </div>
        <FileDropZone onAttach={setAttachment}>
          <div ref={dropAreaRef} onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              placeholder={attachment ? "添付ファイルがある場合は空欄でも抽出できます。補足メモを足しても可。" : "合同会議の文字起こし・議事メモをここに貼り付けてください。\nまたはファイルをドラッグ＆ドロップ（PDF / Word は上の📎ボタン）"}
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

      <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
        <div style={{ flex: 1 }} />
        <button onClick={handleExtract} disabled={!canExtract} style={{ ...primaryBtn, opacity: canExtract ? 1 : 0.5, cursor: canExtract ? "pointer" : "not-allowed" }}>
          ✨ AIで {selectedKrIds.size} KRぶんを抽出する
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
      <Field label="学び・気づき"><TextArea value={draft.learnings} onChange={v => onChange({ learnings: v })} rows={4} /></Field>
      <Field label="外部環境の変化（任意）"><TextArea value={draft.external_changes} onChange={v => onChange({ external_changes: v })} rows={3} /></Field>
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
