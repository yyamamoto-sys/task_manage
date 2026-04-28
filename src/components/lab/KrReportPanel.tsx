// src/components/lab/KrReportPanel.tsx
//
// 【設計意図】
// ラボ機能：KRチェックイン/ウィンセッションの議事メモをAIに渡し、HTMLレポートを生成する。
// OKR/KR/TFデータをAIに渡すことはユーザー確認済みのポリシー変更による許可。
// GraphViewと同じフルスクリーンオーバーレイ形式で表示する。

import { useState, useRef, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";
import { buildKrReportContext, type KrReportMode } from "../../lib/ai/krReportPrompt";
import { callKrReportAI } from "../../lib/ai/krReportClient";

interface Props {
  onClose: () => void;
  currentUser: Member;
}

const MODE_OPTIONS: { value: KrReportMode; label: string; description: string }[] = [
  {
    value: "checkin",
    label: "チェックイン分析",
    description: "月曜PM：今週の宣言・到達可能性・仮説たたき案",
  },
  {
    value: "win_session",
    label: "ウィンセッション分析",
    description: "金曜：宣言達成確認・学び・次の一手",
  },
];

export function KrReportPanel({ onClose }: Props) {
  const { keyResults, taskForces, todos, tasks, members } = useAppData();

  const activeKrs = useMemo(
    () => (keyResults ?? []).filter(kr => !kr.is_deleted),
    [keyResults],
  );

  const [selectedKrId, setSelectedKrId] = useState<string>(activeKrs[0]?.id ?? "");
  const [mode, setMode] = useState<KrReportMode>("checkin");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const reportRef = useRef<HTMLIFrameElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  const selectedKr = activeKrs.find(kr => kr.id === selectedKrId) ?? null;

  const handleGenerate = async () => {
    if (!selectedKr) return;
    if (!meetingNotes.trim()) {
      setError("議事メモを入力してください。");
      return;
    }

    setGenerating(true);
    setError(null);
    setReportHtml(null);

    try {
      const context = buildKrReportContext({
        today,
        kr: selectedKr,
        tfs: taskForces ?? [],
        todos: todos ?? [],
        tasks: tasks ?? [],
        members: members ?? [],
        mode,
        meetingNotes: meetingNotes.trim(),
      });

      const result = await callKrReportAI(context, mode);
      setReportHtml(result.html);

      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "レポート生成中にエラーが発生しました。");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyHtml = () => {
    if (!reportHtml) return;
    navigator.clipboard.writeText(reportHtml).then(() => {
      alert("HTMLをクリップボードにコピーしました。");
    });
  };

  const handleCopyRendered = () => {
    if (!reportRef.current) return;
    const text = reportRef.current.contentDocument?.body?.innerText ?? "";
    navigator.clipboard.writeText(text).then(() => {
      alert("テキストをクリップボードにコピーしました。");
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(960px, 100vw)",
          height: "100%",
          background: "var(--color-bg-primary)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "10px",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "18px" }}>🧪</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              KRレポート生成
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              チェックイン・ウィンセッションの議事メモからAIがレポートを生成します
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: "20px", color: "var(--color-text-tertiary)",
              padding: "4px", lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* コンテンツ */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          {/* 設定エリア */}
          <div style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-lg)",
            padding: "18px 20px",
            marginBottom: "20px",
          }}>

            {/* KR選択 */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                対象KR
              </label>
              {activeKrs.length === 0 ? (
                <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                  KRが登録されていません。管理画面でKRを作成してください。
                </div>
              ) : (
                <select
                  value={selectedKrId}
                  onChange={e => setSelectedKrId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: "13px",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-primary)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {activeKrs.map(kr => (
                    <option key={kr.id} value={kr.id}>{kr.title}</option>
                  ))}
                </select>
              )}
            </div>

            {/* モード選択 */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "8px" }}>
                会議の種類
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setMode(opt.value)}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      border: `1.5px solid ${mode === opt.value ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                      borderRadius: "var(--radius-md)",
                      background: mode === opt.value ? "var(--color-brand-light)" : "var(--color-bg-primary)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      color: mode === opt.value ? "var(--color-brand)" : "var(--color-text-primary)",
                      marginBottom: "3px",
                    }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 議事メモ入力 */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-text-primary)", display: "block", marginBottom: "6px" }}>
                議事メモ / 文字起こし
              </label>
              <textarea
                value={meetingNotes}
                onChange={e => setMeetingNotes(e.target.value)}
                placeholder="チェックインまたはウィンセッションの議事メモや文字起こしをここに貼り付けてください。"
                rows={10}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "12px",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)",
                  resize: "vertical",
                  lineHeight: 1.6,
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* エラー */}
            {error && (
              <div style={{
                fontSize: "12px",
                color: "var(--color-text-danger)",
                background: "var(--color-bg-danger)",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                marginBottom: "12px",
              }}>
                {error}
              </div>
            )}

            {/* 生成ボタン */}
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedKr || !meetingNotes.trim()}
              style={{
                width: "100%",
                padding: "11px",
                background: generating || !selectedKr || !meetingNotes.trim()
                  ? "var(--color-bg-tertiary)"
                  : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                border: "none",
                borderRadius: "var(--radius-md)",
                color: generating || !selectedKr || !meetingNotes.trim()
                  ? "var(--color-text-tertiary)"
                  : "#fff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: generating || !selectedKr || !meetingNotes.trim() ? "not-allowed" : "pointer",
                boxShadow: generating || !selectedKr || !meetingNotes.trim()
                  ? "none"
                  : "0 2px 8px rgba(124,58,237,0.35)",
              }}
            >
              {generating ? "⏳ レポートを生成中..." : "✨ AIでレポートを生成する"}
            </button>
          </div>

          {/* レポート出力エリア */}
          {reportHtml && (
            <div>
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                marginBottom: "12px",
              }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-text-primary)", flex: 1 }}>
                  生成されたレポート
                </div>
                <button
                  onClick={handleCopyRendered}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  テキストをコピー
                </button>
                <button
                  onClick={handleCopyHtml}
                  style={{
                    fontSize: "11px", padding: "5px 10px",
                    background: "transparent",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  HTMLをコピー
                </button>
              </div>
              <iframe
                ref={reportRef}
                srcDoc={reportHtml}
                style={{
                  width: "100%",
                  minHeight: "600px",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--radius-lg)",
                  background: "#fff",
                }}
                onLoad={e => {
                  const iframe = e.currentTarget;
                  const body = iframe.contentDocument?.body;
                  if (body) {
                    iframe.style.height = `${body.scrollHeight + 32}px`;
                  }
                }}
                title="KRレポートプレビュー"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
