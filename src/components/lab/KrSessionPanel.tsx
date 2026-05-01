// src/components/lab/KrSessionPanel.tsx
//
// 【設計意図】
// チェックイン・ウィンセッション用の会議ハブ画面。
// 文字起こしを貼り付け → AI抽出 → 確認・修正 → DBに保存 の流れ。
// 進行役1人が代表入力するシングル入力モデル。

import { useState, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import {
  extractCheckinData,
  extractWinSessionData,
  type ExtractedCheckin,
  type ExtractedWinSession,
} from "../../lib/ai/krSessionExtractor";
import {
  insertKrSession,
  insertKrDeclaration,
  updateKrDeclarationResult,
  fetchLatestCheckinSession,
  fetchKrDeclarations,
  type KrDeclaration,
} from "../../lib/supabase/krSessionStore";
import { AIProgressLoader } from "../common/AIProgressLoader";

// ===== 型 =====

type SessionType = "checkin" | "win_session";
type Step = "input" | "extracting" | "confirm" | "saving" | "done";

interface CheckinRow {
  tempId: string;
  member_id: string;
  member_short_name: string;
  content: string;
  due_date: string;
}

interface WinRow {
  declaration_id: string;
  member_short_name: string;
  content: string;
  due_date: string | null;
  result_status: "achieved" | "partial" | "not_achieved";
  result_note: string;
}

// ===== ユーティリティ =====

function getThisMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const SIGNAL_OPTIONS: { value: "green" | "yellow" | "red"; label: string; color: string }[] = [
  { value: "green",  label: "🟢 順調（60%以上）", color: "#16a34a" },
  { value: "yellow", label: "🟡 注意（50〜59%）", color: "#ca8a04" },
  { value: "red",    label: "🔴 要対応（49%以下）", color: "#dc2626" },
];

const RESULT_OPTIONS: { value: "achieved" | "partial" | "not_achieved"; label: string; color: string }[] = [
  { value: "achieved",     label: "達成",   color: "#16a34a" },
  { value: "partial",      label: "部分",   color: "#ca8a04" },
  { value: "not_achieved", label: "未達成", color: "#dc2626" },
];

// ===== コンポーネント =====

interface Props {
  onClose: () => void;
  currentUser: Member;
  inline?: boolean;
  initialKrId?: string;
  onSaved?: () => void;
}

export function KrSessionPanel({ onClose, currentUser, inline = false, initialKrId, onSaved }: Props) {
  const { keyResults, members } = useAppData();
  const activeKrs = useMemo(() => (keyResults ?? []).filter(kr => !kr.is_deleted), [keyResults]);
  const activeMembers = useMemo(() => (members ?? []).filter(m => !m.is_deleted), [members]);

  // --- 入力ステート ---
  const [selectedKrId, setSelectedKrId] = useState<string>(initialKrId ?? activeKrs[0]?.id ?? "");
  const [sessionType, setSessionType] = useState<SessionType>("checkin");
  const [weekStart, setWeekStart] = useState<string>(getThisMonday());
  const [transcript, setTranscript] = useState("");

  // --- フロー制御 ---
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);

  // --- チェックイン確認データ ---
  const [checkinSignal, setCheckinSignal] = useState<"green" | "yellow" | "red">("yellow");
  const [checkinSignalComment, setCheckinSignalComment] = useState("");
  const [checkinRows, setCheckinRows] = useState<CheckinRow[]>([]);

  // --- ウィンセッション確認データ ---
  const [winSignal, setWinSignal] = useState<"green" | "yellow" | "red">("yellow");
  const [winSignalComment, setWinSignalComment] = useState("");
  const [winRows, setWinRows] = useState<WinRow[]>([]);
  const [winLearnings, setWinLearnings] = useState("");
  const [winExternalChanges, setWinExternalChanges] = useState("");

  // --- 前回チェックイン宣言（ウィン用） ---
  const [prevDeclarations, setPrevDeclarations] = useState<KrDeclaration[]>([]);

  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;

  // --- メンバーshort_nameからIDを解決 ---
  const resolveOrUnknown = (shortName: string): string => {
    const m = activeMembers.find(
      m => m.short_name === shortName || m.display_name.includes(shortName),
    );
    return m?.id ?? "";
  };

  // ===== AI解析 =====

  const handleExtract = async () => {
    if (!selectedKr || !transcript.trim()) return;
    setError(null);
    setStep("extracting");

    try {
      if (sessionType === "checkin") {
        const result: ExtractedCheckin = await extractCheckinData({
          krTitle: selectedKr.title,
          memberShortNames: activeMembers.map(m => m.short_name),
          transcript: transcript.trim(),
        });

        setCheckinSignal(result.signal ?? "yellow");
        setCheckinSignalComment(result.signal_comment ?? "");
        setCheckinRows(
          (result.declarations ?? []).map((d, i) => ({
            tempId: `tmp-${i}`,
            member_id: resolveOrUnknown(d.member_short_name),
            member_short_name: d.member_short_name,
            content: d.content,
            due_date: d.due_date ?? "",
          })),
        );
      } else {
        // ウィンセッション: 前回チェックインの宣言を取得してAIに渡す
        const latestCheckin = await fetchLatestCheckinSession(selectedKrId);
        let prevDecls: KrDeclaration[] = [];
        if (latestCheckin) {
          prevDecls = await fetchKrDeclarations(latestCheckin.id);
          setPrevDeclarations(prevDecls);
        }

        const result: ExtractedWinSession = await extractWinSessionData({
          krTitle: selectedKr.title,
          memberShortNames: activeMembers.map(m => m.short_name),
          previousDeclarations: prevDecls.map((d, i) => ({
            index: i,
            member: activeMembers.find(m => m.id === d.member_id)?.short_name ?? d.member_id,
            content: d.content,
            due_date: d.due_date,
          })),
          transcript: transcript.trim(),
        });

        setWinSignal(result.signal ?? "yellow");
        setWinSignalComment(result.signal_comment ?? "");
        setWinLearnings(result.learnings ?? "");
        setWinExternalChanges(result.external_changes ?? "");

        const resultMap = new Map(
          (result.declaration_results ?? []).map(r => [r.declaration_index, r]),
        );
        setWinRows(
          prevDecls.map((d, i) => {
            const r = resultMap.get(i);
            return {
              declaration_id: d.id,
              member_short_name: activeMembers.find(m => m.id === d.member_id)?.short_name ?? d.member_id,
              content: d.content,
              due_date: d.due_date,
              result_status: (r?.result_status ?? "not_achieved") as WinRow["result_status"],
              result_note: r?.result_note ?? "",
            };
          }),
        );
      }

      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI解析中にエラーが発生しました。");
      setStep("input");
    }
  };

  // ===== DB保存 =====

  const handleSave = async () => {
    if (!selectedKr) return;
    setStep("saving");
    setError(null);

    try {
      if (sessionType === "checkin") {
        const session = await insertKrSession({
          kr_id: selectedKrId,
          week_start: weekStart,
          session_type: "checkin",
          signal: checkinSignal,
          signal_comment: checkinSignalComment,
          learnings: "",
          external_changes: "",
          transcript: transcript.trim(),
          created_by: currentUser.id,
          updated_by: currentUser.id,
        });

        for (const row of checkinRows) {
          if (!row.content.trim()) continue;
          await insertKrDeclaration({
            session_id: session.id,
            member_id: row.member_id || currentUser.id,
            content: row.content,
            due_date: row.due_date || null,
            result_status: null,
            result_note: "",
            updated_by: currentUser.id,
          });
        }
      } else {
        const session = await insertKrSession({
          kr_id: selectedKrId,
          week_start: weekStart,
          session_type: "win_session",
          signal: winSignal,
          signal_comment: winSignalComment,
          learnings: winLearnings,
          external_changes: winExternalChanges,
          transcript: transcript.trim(),
          created_by: currentUser.id,
          updated_by: currentUser.id,
        });

        // 前回宣言の結果を更新
        for (const row of winRows) {
          await updateKrDeclarationResult(
            row.declaration_id,
            row.result_status,
            row.result_note,
            currentUser.id,
          );
        }
        // ウィンセッション記録に宣言スナップショットを紐づける（参照用）
        for (const row of winRows) {
          await insertKrDeclaration({
            session_id: session.id,
            member_id: prevDeclarations.find(d => d.id === row.declaration_id)?.member_id ?? currentUser.id,
            content: row.content,
            due_date: row.due_date,
            result_status: row.result_status,
            result_note: row.result_note,
            updated_by: currentUser.id,
          });
        }
      }

      setStep("done");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存中にエラーが発生しました。");
      setStep("confirm");
    }
  };

  const handleReset = () => {
    setStep("input");
    setTranscript("");
    setError(null);
    setCheckinRows([]);
    setWinRows([]);
    setPrevDeclarations([]);
  };

  // ===== レンダリング =====

  const panelContent = (
    <div
      style={{
        width: inline ? "100%" : "min(960px, 100vw)",
        height: "100%",
        background: "var(--color-bg-primary)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        ...(inline ? {} : { boxShadow: "-4px 0 24px rgba(0,0,0,0.18)" }),
      }}
      onClick={inline ? undefined : e => e.stopPropagation()}
    >
        {/* ヘッダー */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
          background: "var(--color-bg-secondary)",
        }}>
          <span style={{ fontSize: "18px" }}>🗓️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              KRセッション記録
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              文字起こしを貼り付け → AI解析 → 確認・保存
            </div>
          </div>
          {step !== "input" && step !== "done" && (
            <button
              onClick={handleReset}
              style={{
                fontSize: "11px", padding: "5px 10px",
                background: "transparent",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              最初からやり直す
            </button>
          )}
          {!inline && (
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: "20px", color: "var(--color-text-tertiary)",
                padding: "4px", lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>

          {/* ステップ1: 入力 */}
          {step === "input" && (
            <InputStep
              activeKrs={activeKrs}
              selectedKrId={selectedKrId}
              setSelectedKrId={setSelectedKrId}
              sessionType={sessionType}
              setSessionType={setSessionType}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              transcript={transcript}
              setTranscript={setTranscript}
              error={error}
              onExtract={handleExtract}
            />
          )}

          {/* ステップ2: 解析中 */}
          {step === "extracting" && (
            <AIProgressLoader
              phases={[
                "文字起こしを読み込んでいます...",
                "宣言・シグナルを抽出しています...",
                "担当者・期日を照合しています...",
                "内容を整形しています...",
              ]}
              intervalMs={4500}
            />
          )}

          {/* ステップ3: 確認（チェックイン） */}
          {step === "confirm" && sessionType === "checkin" && (
            <CheckinConfirmStep
              signal={checkinSignal}
              setSignal={setCheckinSignal}
              signalComment={checkinSignalComment}
              setSignalComment={setCheckinSignalComment}
              rows={checkinRows}
              setRows={setCheckinRows}
              members={activeMembers}
              error={error}
              onSave={handleSave}
            />
          )}

          {/* ステップ3: 確認（ウィンセッション） */}
          {step === "confirm" && sessionType === "win_session" && (
            <WinConfirmStep
              signal={winSignal}
              setSignal={setWinSignal}
              signalComment={winSignalComment}
              setSignalComment={setWinSignalComment}
              rows={winRows}
              setRows={setWinRows}
              learnings={winLearnings}
              setLearnings={setWinLearnings}
              externalChanges={winExternalChanges}
              setExternalChanges={setWinExternalChanges}
              error={error}
              onSave={handleSave}
            />
          )}

          {/* ステップ4: 保存中 */}
          {step === "saving" && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "16px", minHeight: "200px",
            }}>
              <div style={{ fontSize: "32px" }}>💾</div>
              <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                保存しています...
              </div>
            </div>
          )}

          {/* ステップ5: 完了 */}
          {step === "done" && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: "20px", padding: "40px 20px", textAlign: "center",
            }}>
              <div style={{ fontSize: "48px" }}>✅</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                保存しました
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {sessionType === "checkin"
                  ? "宣言内容がDBに保存されました。金曜のウィンセッション時に自動的に参照されます。"
                  : "ウィンセッションの結果が保存されました。"}
              </div>
              <button
                onClick={handleReset}
                style={{
                  padding: "10px 24px",
                  background: "var(--color-brand)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                別のセッションを記録する
              </button>
            </div>
          )}
        </div>
    </div>
  );

  if (inline) return panelContent;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {panelContent}
    </div>
  );
}

// ===== サブコンポーネント =====

function InputStep({
  activeKrs, selectedKrId, setSelectedKrId,
  sessionType, setSessionType,
  weekStart, setWeekStart,
  transcript, setTranscript,
  error, onExtract,
}: {
  activeKrs: { id: string; title: string }[];
  selectedKrId: string; setSelectedKrId: (v: string) => void;
  sessionType: SessionType; setSessionType: (v: SessionType) => void;
  weekStart: string; setWeekStart: (v: string) => void;
  transcript: string; setTranscript: (v: string) => void;
  error: string | null;
  onExtract: () => void;
}) {
  const canExtract = !!selectedKrId && transcript.trim().length > 20;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {/* KR選択 */}
        <div style={{ flex: "2 1 200px" }}>
          <FieldLabel>対象KR</FieldLabel>
          {activeKrs.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              KRが登録されていません
            </div>
          ) : (
            <select
              value={selectedKrId}
              onChange={e => setSelectedKrId(e.target.value)}
              style={selectStyle}
            >
              {activeKrs.map(kr => (
                <option key={kr.id} value={kr.id}>{kr.title}</option>
              ))}
            </select>
          )}
        </div>

        {/* 週選択 */}
        <div style={{ flex: "1 1 140px" }}>
          <FieldLabel>週（月曜日の日付）</FieldLabel>
          <input
            type="date"
            value={weekStart}
            onChange={e => setWeekStart(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* 会議種別 */}
      <div>
        <FieldLabel>会議の種類</FieldLabel>
        <div style={{ display: "flex", gap: "10px" }}>
          {([
            { value: "checkin", label: "チェックイン", sub: "月曜PM：宣言・シグナル入力" },
            { value: "win_session", label: "ウィンセッション", sub: "金曜：宣言結果・学び入力" },
          ] as const).map(opt => (
            <button
              key={opt.value}
              onClick={() => setSessionType(opt.value)}
              style={{
                flex: 1, padding: "10px 12px", textAlign: "left",
                border: `1.5px solid ${sessionType === opt.value ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)",
                background: sessionType === opt.value ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: "600", color: sessionType === opt.value ? "var(--color-brand)" : "var(--color-text-primary)", marginBottom: "3px" }}>
                {opt.label}
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{opt.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 文字起こし入力 */}
      <div>
        <FieldLabel>
          文字起こし / 議事メモ
          <span style={{ fontSize: "10px", fontWeight: "400", color: "var(--color-text-tertiary)", marginLeft: "8px" }}>
            Teams録音の文字起こしや手書きメモをそのまま貼り付けてください
          </span>
        </FieldLabel>
        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          placeholder="会議の文字起こしや議事メモをここに貼り付けてください。AIが宣言・シグナル・結果などを自動で抽出します。"
          rows={12}
          style={{
            width: "100%", padding: "10px 12px", fontSize: "12px",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            resize: "vertical", lineHeight: 1.6, boxSizing: "border-box",
          }}
        />
      </div>

      {error && <ErrorBox message={error} />}

      <button
        onClick={onExtract}
        disabled={!canExtract}
        style={primaryButtonStyle(!canExtract)}
      >
        🤖 AIで解析する
      </button>
    </div>
  );
}

function CheckinConfirmStep({
  signal, setSignal, signalComment, setSignalComment,
  rows, setRows, members, error, onSave,
}: {
  signal: "green" | "yellow" | "red"; setSignal: (v: "green" | "yellow" | "red") => void;
  signalComment: string; setSignalComment: (v: string) => void;
  rows: CheckinRow[]; setRows: (r: CheckinRow[]) => void;
  members: Member[];
  error: string | null;
  onSave: () => void;
}) {
  const addRow = () => {
    setRows([...rows, {
      tempId: `tmp-${Date.now()}`,
      member_id: members[0]?.id ?? "",
      member_short_name: members[0]?.short_name ?? "",
      content: "",
      due_date: "",
    }]);
  };

  const updateRow = (tempId: string, patch: Partial<CheckinRow>) => {
    setRows(rows.map(r => r.tempId === tempId ? { ...r, ...patch } : r));
  };

  const removeRow = (tempId: string) => {
    setRows(rows.filter(r => r.tempId !== tempId));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <SectionHeader icon="✅" title="解析結果を確認・修正してください" />

      {/* シグナル */}
      <Card>
        <FieldLabel>進捗シグナル</FieldLabel>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          {SIGNAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSignal(opt.value)}
              style={{
                flex: 1, padding: "8px", fontSize: "11px", fontWeight: "600",
                border: `2px solid ${signal === opt.value ? opt.color : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)",
                background: signal === opt.value ? `${opt.color}18` : "var(--color-bg-primary)",
                color: signal === opt.value ? opt.color : "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >{opt.label}</button>
          ))}
        </div>
        <input
          type="text"
          value={signalComment}
          onChange={e => setSignalComment(e.target.value)}
          placeholder="シグナルのコメント（任意）"
          style={inputStyle}
        />
      </Card>

      {/* 宣言リスト */}
      <Card>
        <FieldLabel>宣言（{rows.length}件）</FieldLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map(row => (
            <div key={row.tempId} style={{
              display: "flex", gap: "8px", alignItems: "flex-start",
              background: "var(--color-bg-secondary)",
              padding: "10px", borderRadius: "var(--radius-md)",
            }}>
              <select
                value={row.member_id}
                onChange={e => {
                  const m = members.find(m => m.id === e.target.value);
                  updateRow(row.tempId, { member_id: e.target.value, member_short_name: m?.short_name ?? "" });
                }}
                style={{ ...selectStyle, width: "100px", flexShrink: 0 }}
              >
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.short_name}</option>
                ))}
                {!row.member_id && <option value="">未特定</option>}
              </select>
              <textarea
                value={row.content}
                onChange={e => updateRow(row.tempId, { content: e.target.value })}
                placeholder="宣言内容"
                rows={2}
                style={{ ...inputStyle, flex: 1, resize: "vertical" }}
              />
              <input
                type="date"
                value={row.due_date}
                onChange={e => updateRow(row.tempId, { due_date: e.target.value })}
                style={{ ...inputStyle, width: "130px", flexShrink: 0 }}
              />
              <button
                onClick={() => removeRow(row.tempId)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: "var(--color-text-tertiary)", fontSize: "16px", padding: "4px",
                }}
              >✕</button>
            </div>
          ))}
          <button
            onClick={addRow}
            style={{
              fontSize: "11px", padding: "7px",
              background: "transparent",
              border: "1px dashed var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >＋ 宣言を追加</button>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}

      <button onClick={onSave} style={primaryButtonStyle(false)}>
        💾 DBに保存する
      </button>
    </div>
  );
}

function WinConfirmStep({
  signal, setSignal, signalComment, setSignalComment,
  rows, setRows,
  learnings, setLearnings,
  externalChanges, setExternalChanges,
  error, onSave,
}: {
  signal: "green" | "yellow" | "red"; setSignal: (v: "green" | "yellow" | "red") => void;
  signalComment: string; setSignalComment: (v: string) => void;
  rows: WinRow[]; setRows: (r: WinRow[]) => void;
  learnings: string; setLearnings: (v: string) => void;
  externalChanges: string; setExternalChanges: (v: string) => void;
  error: string | null;
  onSave: () => void;
}) {
  const updateRow = (id: string, patch: Partial<WinRow>) => {
    setRows(rows.map(r => r.declaration_id === id ? { ...r, ...patch } : r));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <SectionHeader icon="✅" title="解析結果を確認・修正してください" />

      {/* シグナル */}
      <Card>
        <FieldLabel>今週の進捗シグナル</FieldLabel>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          {SIGNAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSignal(opt.value)}
              style={{
                flex: 1, padding: "8px", fontSize: "11px", fontWeight: "600",
                border: `2px solid ${signal === opt.value ? opt.color : "var(--color-border-primary)"}`,
                borderRadius: "var(--radius-md)",
                background: signal === opt.value ? `${opt.color}18` : "var(--color-bg-primary)",
                color: signal === opt.value ? opt.color : "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >{opt.label}</button>
          ))}
        </div>
        <input
          type="text"
          value={signalComment}
          onChange={e => setSignalComment(e.target.value)}
          placeholder="シグナルのコメント（任意）"
          style={inputStyle}
        />
      </Card>

      {/* 宣言結果 */}
      <Card>
        <FieldLabel>先週の宣言 結果確認（{rows.length}件）</FieldLabel>
        {rows.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", padding: "8px" }}>
            前回のチェックイン記録が見つかりませんでした
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {rows.map(row => (
              <div key={row.declaration_id} style={{
                background: "var(--color-bg-secondary)",
                borderRadius: "var(--radius-md)",
                padding: "12px",
              }}>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>
                  {row.member_short_name} / 期日：{row.due_date ?? "未設定"}
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-primary)", marginBottom: "10px", fontWeight: "500" }}>
                  {row.content}
                </div>
                {/* 結果ボタン */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                  {RESULT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => updateRow(row.declaration_id, { result_status: opt.value })}
                      style={{
                        padding: "4px 12px", fontSize: "11px", fontWeight: "600",
                        border: `1.5px solid ${row.result_status === opt.value ? opt.color : "var(--color-border-primary)"}`,
                        borderRadius: "var(--radius-full)",
                        background: row.result_status === opt.value ? `${opt.color}18` : "var(--color-bg-primary)",
                        color: row.result_status === opt.value ? opt.color : "var(--color-text-tertiary)",
                        cursor: "pointer",
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
                <input
                  type="text"
                  value={row.result_note}
                  onChange={e => updateRow(row.declaration_id, { result_note: e.target.value })}
                  placeholder="コメント（任意）"
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 学び */}
      <Card>
        <FieldLabel>学び / 仮説検証の結果</FieldLabel>
        <textarea
          value={learnings}
          onChange={e => setLearnings(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Card>

      {/* 外部環境変化 */}
      <Card>
        <FieldLabel>外部環境変化（任意）</FieldLabel>
        <textarea
          value={externalChanges}
          onChange={e => setExternalChanges(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Card>

      {error && <ErrorBox message={error} />}

      <button onClick={onSave} style={primaryButtonStyle(false)}>
        💾 DBに保存する
      </button>
    </div>
  );
}

// ===== スタイルヘルパー =====

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "12px", fontWeight: "600",
      color: "var(--color-text-primary)",
      marginBottom: "6px",
    }}>
      {children}
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

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "18px" }}>{icon}</span>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text-primary)" }}>
        {title}
      </div>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: "12px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: "100%", padding: "11px",
  background: disabled
    ? "var(--color-bg-tertiary)"
    : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  border: "none",
  borderRadius: "var(--radius-md)",
  color: disabled ? "var(--color-text-tertiary)" : "#fff",
  fontSize: "13px", fontWeight: "600",
  cursor: disabled ? "not-allowed" : "pointer",
  boxShadow: disabled ? "none" : "0 2px 8px rgba(124,58,237,0.35)",
});
