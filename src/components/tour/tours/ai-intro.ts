// src/components/tour/tours/ai-intro.ts
//
// AI機能ツアー（約90秒・7ステップ）。
// このアプリの最重要機能である AI 入口を、各ステップで「どこを押すか」を明示しながら案内する。
//
// 入口は2系統：
// ① 左サイドバー「AIツールを開く」 → 右側パネルで3モード（相談 / PJ作成 / 会議メモ）
// ② 右下FAB ＋ボタン              → 同じ3モードのショートカット + クイックタスク追加

import type { Tour } from "./types";

export const aiIntroTour: Tour = {
  id: "ai-intro",
  title: "AI機能ツアー",
  estimatedSeconds: 90,
  steps: [
    {
      id: "intro",
      placement: "center",
      title: "✨ AI機能ツアーへようこそ",
      body: "このアプリの AI は、現在の OKR・PJ・タスク・担当者・期日を全て見たうえで回答します。\n\n入口は2系統あります：\n①「AIツールを開く」（左サイドバー）\n② 右下の＋ボタン（FAB）\n\nそれぞれの使いどころを順にご案内します。",
    },
    {
      id: "ai-tool-btn",
      target: "ai-tool-btn",
      placement: "right",
      skipIfMissing: true,
      title: "👈 まずはここ：左サイドバー「AIツールを開く」",
      body: "左サイドバーの「✨ AIツールを開く」（紫のボタン）を押すと、画面の右側に AI パネルが開きます。\n\nこの中で 3 つのモードを切り替えて使えます：\n① 💬 AI に相談（自由質問）\n② ✨ AI で PJ を作る（議事メモから自動生成）\n③ 🎙️ 会議メモから タスク登録（文字起こしを貼ると新規タスクとステータス更新を自動提案）\n\n「腰を据えて AI と作業する」ときはこちらを使うのが基本です。",
    },
    {
      id: "ai-mode-meeting",
      placement: "center",
      title: "🎙️ ③ 会議メモから タスク登録（重要）",
      body: "AIツール内の「会議メモ」モードに切り替えて、議事録や Teams の文字起こしをそのまま貼り付けると、\n\n・新規タスクの候補（誰が・何を・いつまでに）\n・既存タスクのステータス変更候補（完了/進行中など）\n\nを AI が自動で提案します。確認画面で取捨選択して登録。会議後の入力作業がほぼゼロになります。",
    },
    {
      id: "fab",
      target: "fab",
      placement: "left",
      skipIfMissing: true,
      title: "👉 もう一つの入口：右下の＋ボタン（FAB）",
      body: "右下の「＋」を押すと 3 つのショートカットが出ます：\n\n・💬 AI に相談する\n・✨ AI で PJ を作る\n・＋ タスクを追加（AI不要のクイック追加）\n\n「思いついた瞬間に1クリックで AI 入力」したいときはこちら。「AIツール」と中身は同じですが、サッと開けるのが利点です。",
    },
    {
      id: "pj-karte",
      placement: "center",
      title: "📊 PJ単体の AI 分析（左サイドバーから PJ を選ぶと出る）",
      body: "左サイドバーの「プロジェクト」一覧からひとつの PJ を選ぶと、ダッシュボードに「プロジェクトカルテ」が表示されます。\n\nそこの「✨ AI分析」ボタンを押すと、その PJ 単体の進捗・リスク・担当者偏り・次の一手を AI が分析します。",
    },
    {
      id: "okr-analysis",
      target: "app-mode",
      placement: "bottom",
      skipIfMissing: true,
      title: "🎯 OKR モードの AI 分析",
      body: "上部の「🎯 OKR」に切り替えると、OKR管理モードに入ります。\n\nKR を選んで「③ 分析」タブを押すと、会議ノート・週次セッション・タスクを束ねて AI が分析し、レポート作成の素材になります。",
    },
    {
      id: "done",
      placement: "center",
      title: "🎉 AI機能ツアー完了",
      body: "迷ったときの目安：\n\n・サッと聞きたい → 右下「＋」→「💬 AI に相談する」\n・会議後の入力を一気に → 左「AIツールを開く」→「会議メモ」\n・PJを最初から立ち上げる → どちらからでも「✨ AI で PJ を作る」\n・PJ単体の健全性 → ダッシュボードで PJ を選ぶ\n・KR/OKR 全体 → OKRモード「③ 分析」\n\n全部試さなくて大丈夫。困ったときに思い出してください。",
    },
  ],
};
