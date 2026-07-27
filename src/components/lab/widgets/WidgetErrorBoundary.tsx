// src/components/lab/widgets/WidgetErrorBoundary.tsx
//
// 【設計意図】
// マイページの各ウィジェットを個別に包む、専用の小さな ErrorBoundary。
// 既存の src/components/common/ErrorBoundary.tsx はアプリ全体用（全画面フォールバック・
// 再読み込みボタン）で、fallback を差し替えられない設計のため流用しない。ここに専用の
// 境界を新設することで、既存のグローバル ErrorBoundary の挙動には一切手を加えずに、
// 「1個のウィジェットが落ちてもマイページ全体は生き続ける」を実現する。

import { Component, type ReactNode } from "react";
import { reportError } from "../../../lib/errorReporter";

interface Props {
  /** エラー表示に添えるウィジェット名 */
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    reportError(error, `WidgetErrorBoundary(${this.props.title}): ${info.componentStack.split("\n").slice(0, 2).join(" / ")}`);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: "16px 10px", textAlign: "center",
          fontSize: "11px", lineHeight: 1.6,
          color: "var(--color-text-danger)",
        }}>
          ⚠ 「{this.props.title}」の表示中にエラーが発生しました。
        </div>
      );
    }
    return this.props.children;
  }
}
