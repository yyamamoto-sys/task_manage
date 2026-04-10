// src/components/common/ErrorBar.tsx
//
// アプリ画面最下部に表示する小さなエラー通知バー。
// - reportError() が発火した "app:error" イベントをリッスン
// - エラーメッセージ・コード・操作コンテキストを表示
// - コピーボタンでエラー詳細をクリップボードにコピー
// - 15秒後に自動消去、× ボタンで手動消去
// - localStorage に最大 20 件の履歴を自動保存
// - 「履歴」ボタンで保存済みエラー一覧を確認・クリア可能

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { AppError } from "../../lib/errorReporter";

const HISTORY_KEY = "app:error_history";
const MAX_HISTORY = 20;

function loadHistory(): AppError[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as AppError[]) : [];
  } catch {
    return [];
  }
}

function saveToHistory(err: AppError) {
  const prev = loadHistory();
  const next = [...prev, err].slice(-MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ストレージ容量超過などは無視
  }
}

function formatEntry(err: AppError) {
  return [
    `[エラー] ${err.timestamp}`,
    err.context  ? `操作: ${err.context}` : null,
    err.code     ? `コード: ${err.code}`  : null,
    `内容: ${err.message}`,
  ].filter(Boolean).join("\n");
}

// ===== 履歴パネル =====

interface HistoryPanelProps {
  onClose: () => void;
}

function HistoryPanel({ onClose }: HistoryPanelProps) {
  const [history, setHistory] = useState<AppError[]>(() => loadHistory().slice().reverse());
  const [copied, setCopied] = useState<string | null>(null);

  const copyAll = useCallback(async () => {
    const text = loadHistory().slice().reverse()
      .map((e, i) => `--- ${i + 1} ---\n${formatEntry(e)}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied("all");
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const copyOne = useCallback(async (err: AppError) => {
    const text = formatEntry(err);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(err.timestamp);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const clearAll = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, []);

  return createPortal(
    <>
      {/* オーバーレイ */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 8990,
          background: "rgba(0,0,0,0.3)",
        }}
      />
      {/* パネル */}
      <div style={{
        position: "fixed", bottom: "40px", right: "16px", zIndex: 9000,
        width: "min(480px, calc(100vw - 32px))",
        maxHeight: "60vh",
        display: "flex", flexDirection: "column",
        background: "rgba(18,12,12,0.96)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(200,60,60,0.3)",
        borderRadius: "8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}>
        {/* ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(200,60,60,0.2)",
          flexShrink: 0,
        }}>
          <span style={{ color: "rgba(255,100,100,0.8)", fontSize: "12px" }}>⚠</span>
          <span style={{ flex: 1, fontSize: "12px", fontWeight: "600", color: "rgba(255,200,200,0.9)" }}>
            エラー履歴（最大{MAX_HISTORY}件）
          </span>
          {history.length > 0 && (
            <button
              onClick={() => void copyAll()}
              style={{
                padding: "3px 10px", fontSize: "10px",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "4px",
                color: copied === "all" ? "rgba(100,255,150,0.9)" : "rgba(255,255,255,0.6)",
                cursor: "pointer",
              }}
            >
              {copied === "all" ? "コピー済" : "全コピー"}
            </button>
          )}
          {history.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                padding: "3px 10px", fontSize: "10px",
                background: "rgba(255,80,80,0.15)",
                border: "1px solid rgba(255,80,80,0.25)",
                borderRadius: "4px",
                color: "rgba(255,150,150,0.8)",
                cursor: "pointer",
              }}
            >
              クリア
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "2px 6px", fontSize: "14px",
              background: "transparent", border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* リスト */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {history.length === 0 ? (
            <div style={{
              padding: "24px", textAlign: "center",
              fontSize: "12px", color: "rgba(255,255,255,0.3)",
            }}>
              保存されたエラーはありません
            </div>
          ) : (
            history.map((err, idx) => (
              <div
                key={err.timestamp + idx}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  display: "flex", flexDirection: "column", gap: "3px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "monospace", flexShrink: 0 }}>
                    {err.timestamp.replace("T", " ").slice(0, 19)}
                  </span>
                  {err.context && (
                    <span style={{ fontSize: "10px", color: "rgba(255,180,180,0.6)" }}>
                      [{err.context}]
                    </span>
                  )}
                  {err.code && (
                    <span style={{
                      fontSize: "10px", fontFamily: "monospace",
                      background: "rgba(255,100,100,0.12)",
                      border: "1px solid rgba(255,100,100,0.25)",
                      borderRadius: "3px", padding: "0 4px",
                      color: "rgba(255,180,180,0.8)",
                    }}>
                      {err.code}
                    </span>
                  )}
                  <button
                    onClick={() => void copyOne(err)}
                    style={{
                      marginLeft: "auto", flexShrink: 0,
                      padding: "1px 7px", fontSize: "9px",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "3px",
                      color: copied === err.timestamp ? "rgba(100,255,150,0.9)" : "rgba(255,255,255,0.45)",
                      cursor: "pointer",
                    }}
                  >
                    {copied === err.timestamp ? "済" : "コピー"}
                  </button>
                </div>
                <div style={{
                  fontSize: "11px", color: "rgba(255,220,220,0.75)",
                  lineHeight: 1.4, wordBreak: "break-all",
                }}>
                  {err.message}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ===== メインの ErrorBar =====

export function ErrorBar() {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [historyCount, setHistoryCount] = useState(() => loadHistory().length);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AppError>).detail;
      // localStorage に保存
      saveToHistory(detail);
      setHistoryCount(loadHistory().length);
      // 通知バーに表示（最大5件）
      setErrors(prev => [...prev.slice(-4), detail]);
    };
    window.addEventListener("app:error", handler);
    return () => window.removeEventListener("app:error", handler);
  }, []);

  // 15秒後に先頭エラーを自動消去
  useEffect(() => {
    if (errors.length === 0) return;
    const timer = setTimeout(() => {
      setErrors(prev => prev.slice(1));
    }, 15000);
    return () => clearTimeout(timer);
  }, [errors]);

  const dismiss = useCallback((idx: number) => {
    setErrors(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const copyError = useCallback(async (err: AppError) => {
    try {
      await navigator.clipboard.writeText(formatEntry(err));
    } catch {
      const ta = document.createElement("textarea");
      ta.value = formatEntry(err);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  // 履歴パネルを閉じたとき件数を再取得
  const handleCloseHistory = useCallback(() => {
    setShowHistory(false);
    setHistoryCount(loadHistory().length);
  }, []);

  return (
    <>
      {showHistory && <HistoryPanel onClose={handleCloseHistory} />}

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        zIndex: 9000,
        display: "flex", flexDirection: "column", gap: "2px",
        pointerEvents: "none",
      }}>
        {/* 履歴ボタン（常時表示） */}
        {historyCount > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px 2px", pointerEvents: "auto" }}>
            <button
              onClick={() => setShowHistory(prev => !prev)}
              title="エラー履歴を表示"
              style={{
                padding: "2px 10px", fontSize: "10px",
                background: "rgba(30,20,20,0.75)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(200,60,60,0.25)",
                borderRadius: "4px 4px 0 0",
                color: "rgba(255,180,180,0.65)",
                cursor: "pointer",
              }}
            >
              履歴 {historyCount}件
            </button>
          </div>
        )}

        {errors.map((err, idx) => (
          <div
            key={err.timestamp + idx}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "5px 12px",
              background: "rgba(30,20,20,0.88)",
              backdropFilter: "blur(4px)",
              borderTop: "1px solid rgba(200,60,60,0.35)",
              fontSize: "11px",
              color: "rgba(255,200,200,0.9)",
              pointerEvents: "auto",
            }}
          >
            <span style={{ color: "rgba(255,100,100,0.8)", flexShrink: 0 }}>⚠</span>

            {err.context && (
              <span style={{ color: "rgba(255,180,180,0.7)", flexShrink: 0 }}>
                [{err.context}]
              </span>
            )}

            {err.code && (
              <span style={{
                background: "rgba(255,100,100,0.15)",
                border: "1px solid rgba(255,100,100,0.3)",
                borderRadius: "3px", padding: "0 5px",
                fontFamily: "monospace", flexShrink: 0,
              }}>
                {err.code}
              </span>
            )}

            <span style={{
              flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: "rgba(255,220,220,0.85)",
            }}>
              {err.message}
            </span>

            <button
              onClick={() => void copyError(err)}
              title="エラー情報をコピー"
              style={{
                flexShrink: 0,
                padding: "2px 8px", fontSize: "10px",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "4px",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
              }}
            >
              コピー
            </button>

            <button
              onClick={() => dismiss(idx)}
              title="閉じる"
              style={{
                flexShrink: 0,
                padding: "2px 6px", fontSize: "11px",
                background: "transparent", border: "none",
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
