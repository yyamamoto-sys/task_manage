// src/components/tour/tours/ai-intro.ts
//
// AI機能ツアー（60秒・5ステップ）。
// アプリの最重要機能である AI 3種＋専用画面の入口を実演する。

import type { Tour } from "./types";

export const aiIntroTour: Tour = {
  id: "ai-intro",
  title: "AI機能ツアー",
  estimatedSeconds: 60,
  steps: [
    {
      id: "intro",
      placement: "center",
      title: "✨ AI機能ツアーへようこそ",
      body: "このアプリの AI は「現在の OKR・PJ・タスク・担当者・期日」を全て見た上で回答します。\n\n入口は大きく2系統：\n① 右下FAB（自由相談・PJ自動生成）\n② 各画面の専用ボタン（PJ分析・OKR分析など）",
    },
    {
      id: "fab-consult",
      target: "fab",
      placement: "left",
      skipIfMissing: true,
      title: "💬 AI に相談する（右下FAB → 紫ボタン）",
      body: "「来週の負荷を整理して」「○○の遅延の影響範囲は？」など、自由に質問できます。\n\nAI はそのとき表示している PJ や OKR の状況を踏まえて、具体的な根拠付きで答えます。",
    },
    {
      id: "fab-create",
      target: "fab",
      placement: "left",
      skipIfMissing: true,
      title: "✨ AI で PJ を作る（右下FAB → グラデ紫）",
      body: "議事メモ・打ち合わせ文字起こしを貼り付け、AI が PJ とタスクを自動生成します。\n\n「PJを作る最初の入力が面倒」を解消する機能。確認画面で内容を編集してから保存できます。",
    },
    {
      id: "pj-karte",
      placement: "center",
      title: "📊 PJ単体の AI 分析",
      body: "ダッシュボードで左サイドバーから PJ を選ぶと、「プロジェクトカルテ」が表示されます。\n\nそこの「✨ AI分析」ボタンで、その PJ 単体の進捗・リスク・担当者偏り・次の一手を AI が分析します。",
    },
    {
      id: "okr-analysis",
      target: "app-mode",
      placement: "bottom",
      skipIfMissing: true,
      title: "🎯 OKR モードの AI 分析",
      body: "OKR管理モードに切り替えると、③ 分析タブで KR・Objective 全体を AI 分析できます。\n\n会議ノート・週次セッション・タスク状況を束ねて整理し、レポート作成の素材になります。",
    },
    {
      id: "done",
      placement: "center",
      title: "🎉 AI機能ツアー完了",
      body: "全部一度に試さなくて大丈夫。困ったときに思い出してください。\n\n「困った」「整理したい」と思ったら、まず右下FABの 💬 ボタンで質問してみるのがおすすめです。",
    },
  ],
};
