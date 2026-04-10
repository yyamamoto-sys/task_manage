// src/components/common/ErrorBar.tsx
//
// アプリ画面最下部に表示する小さなエラー通知バー。
// - reportError() が発火した "app:error" イベントをリッスン
// - エラーメッセージ・コード・操作コンテキストを表示
// - コピーボタンでエラー詳細をクリップボードにコピー
// - 15秒後に自動消去、× ボタンで手動消去

import { useState, useEffect, useCallback } from "react";
import type { AppError } from "../../lib/errorReporter";

export function ErrorBar() {
  const [errors, setErrors] = useState<AppError[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AppError>).detail;
      setErrors(prev => [...prev.slice(-4), detail]); // 最大5件
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
    const lines = [
      `[エラー] ${err.timestamp}`,
      err.context  ? `操作: ${err.context}` : null,
      err.code     ? `コード: ${err.code}`  : null,
      `内容: ${err.message}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
    } catch {
      // フォールバック（古いブラウザ）
      const ta = document.createElement("textarea");
      ta.value = lines;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  if (errors.length === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      zIndex: 9000,
      display: "flex", flexDirection: "column", gap: "2px",
      pointerEvents: "none",
    }}>
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
          {/* エラーアイコン */}
          <span style={{ color: "rgba(255,100,100,0.8)", flexShrink: 0 }}>⚠</span>

          {/* コンテキスト */}
          {err.context && (
            <span style={{ color: "rgba(255,180,180,0.7)", flexShrink: 0 }}>
              [{err.context}]
            </span>
          )}

          {/* コード */}
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

          {/* メッセージ */}
          <span style={{
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "rgba(255,220,220,0.85)",
          }}>
            {err.message}
          </span>

          {/* コピーボタン */}
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

          {/* 閉じるボタン */}
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
  );
}
