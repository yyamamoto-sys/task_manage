// src/components/consultation/LoadingView.tsx
// AI相談の応答待ち中に表示するローディングコンポーネント。

import { AIProgressLoader } from "../common/AIProgressLoader";

const CONSULT_PHASES = [
  "データを読み込んでいます",
  "状況を分析しています",
  "提案を生成しています",
  "内容を最終確認しています",
];

export function LoadingView({ message: _ }: { message: string }) {
  return <AIProgressLoader phases={CONSULT_PHASES} intervalMs={3800} />;
}
