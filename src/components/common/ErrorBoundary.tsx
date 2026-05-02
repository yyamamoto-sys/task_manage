// src/components/common/ErrorBoundary.tsx
//
// 【設計意図】
// React render 中の例外で画面が真っ白になるのを防ぐ。
// App.tsx の最上位に1つ置く。Class component でしか実装できない（getDerivedStateFromError）。

import { Component, type ReactNode } from "react";
import { reportError } from "../../lib/errorReporter";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    reportError(error, `ErrorBoundary: ${info.componentStack.split("\n").slice(0, 3).join(" / ")}`);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleClear = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column",
          padding: "32px 24px",
          background: "var(--color-bg-secondary)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          gap: "20px",
        }}>
          <div style={{
            maxWidth: "520px",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md)",
            padding: "28px 28px 24px",
          }}>
            <div style={{
              fontSize: "13px", fontWeight: 600,
              color: "var(--color-text-danger)",
              letterSpacing: "0.05em", textTransform: "uppercase",
              marginBottom: "10px",
            }}>
              予期しないエラー
            </div>
            <h1 style={{
              fontSize: "20px", fontWeight: 700,
              color: "var(--color-text-primary)",
              marginBottom: "12px", lineHeight: 1.4,
            }}>
              画面の表示中に問題が発生しました
            </h1>
            <p style={{
              fontSize: "13px", lineHeight: 1.7,
              color: "var(--color-text-secondary)",
              marginBottom: "20px",
            }}>
              下のボタンから再読み込みすると復旧することが多いです。
              繰り返す場合は、開いていたタブと操作内容を控えて山本さんに連絡してください。
            </p>
            <details style={{
              fontSize: "11px",
              color: "var(--color-text-tertiary)",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              marginBottom: "20px",
            }}>
              <summary style={{ cursor: "pointer", userSelect: "none" }}>
                エラー詳細
              </summary>
              <pre style={{
                marginTop: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "10.5px", lineHeight: 1.5,
              }}>
                {this.state.error.name}: {this.state.error.message}
                {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
              </pre>
            </details>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={this.handleClear}
                style={{
                  padding: "7px 14px", fontSize: "12px",
                  color: "var(--color-text-secondary)",
                  background: "transparent",
                  border: "1px solid var(--color-border-secondary)",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                }}
              >
                閉じて続ける
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: "7px 16px", fontSize: "12px", fontWeight: 600,
                  color: "var(--btn-primary-text)",
                  background: "var(--btn-primary-bg)",
                  border: "1px solid transparent",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                }}
              >
                再読み込み
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
