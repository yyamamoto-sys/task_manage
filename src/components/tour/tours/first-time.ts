// src/components/tour/tours/first-time.ts
//
// ⚠ 文面・絵文字・番号・ステップ構成を変える前に必ず読む：docs/dev/tour-guidelines.md
//
// 統合ツアー（主要画面 + AI機能を1本で案内）。ログイン時に自動起動し、ガイドからも再生できる。
// ターゲットは data-tour-id 属性で指定。skipIfMissing で UI 変更に強く。
// （旧「AI機能ツアー(ai-intro)」はこのツアーに統合済み）

import type { Tour } from "./types";

export const firstTimeTour: Tour = {
  id: "first-time",
  title: "アミタ計画管理アプリ ツアー",
  estimatedSeconds: 150,
  steps: [
    {
      id: "welcome",
      placement: "center",
      title: "👋 ようこそ",
      body: "このアプリは OKR（目標）× プロジェクト × タスク を 1 箇所で運用するためのツールです。\n\nこのツアーでは、主要画面と AI 機能を順にご案内します。AI には実際に相談を実演してもらいます。\n\n所要 2〜3 分。いつでも ✕ で終了でき、左下「📖 ガイド」からまた再生できます。",
    },
    {
      id: "sidebar",
      target: "sidebar",
      placement: "right",
      skipIfMissing: true,
      title: "左：メニューとプロジェクト一覧",
      body: "上のメニューでビューを切替、下にプロジェクト一覧が並びます。\n\n「全件 / 自分」トグルで、自分が担当のタスクを持つ PJ だけに絞れます。",
    },
    {
      id: "nav",
      target: "nav-items",
      placement: "right",
      skipIfMissing: true,
      title: "4 つのビュー",
      body: "・ダッシュボード：全体把握とリマインダー\n・カンバン：タスクを「未着手／進行中／完了」に振り分け（ドラッグ&ドロップで状態変更）\n・ガント：PJ別ガントチャート（タスクの期間を時系列で表示）\n・リスト：絞り込み・CSV 出力\n\n切り替えても同じタスクを別角度で見ているだけです。",
    },
    {
      id: "ai-tool-btn",
      target: "ai-tool-btn",
      placement: "right",
      skipIfMissing: true,
      title: "✨ AIの入口：「AIツールを開く」",
      body: "左サイドバーの「✨ AIツールを開く」（紫のボタン）を押すと、画面の右側に AI パネルが開きます。\n\nこの中で 3 つのモードを切り替えて使えます：\n① 💬 AI に相談（自由質問）\n② ✨ AI で PJ を作る（議事メモから自動生成）\n③ 🎙️ 会議メモから タスク登録（文字起こしを貼ると新規タスクとステータス更新を自動提案）\n\n「腰を据えて AI と作業する」ときはこちらが基本です。",
    },
    {
      id: "ai-consult-demo",
      target: "ai-panel",    // 右側のAIパネルをスポットライト（周囲は暗くなる）
      placement: "left",
      skipIfMissing: true,
      action: "demo-ai-consult",
      title: "💬 AIに相談してみましょう（実演）",
      body: "右側に開いた AI パネル（明るく強調されている部分）に、相談を1つ自動で入力・送信します。\n\n例文：「来週3日間不在になる。担当タスクで遅れそうなもの・前倒しできるものを整理して」\n\nAI が現在の PJ・タスク・期日を踏まえて提案します（生成に数秒かかります）。\n\n※これはデモです。提案は「反映する」を押さない限り、実際のデータには影響しません。",
    },
    {
      id: "ai-mode-meeting",
      placement: "center",
      title: "🎙️ 会議メモからタスク登録",
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
      title: "📊 PJ単体の AI 分析",
      body: "左サイドバーの「プロジェクト」一覧からひとつの PJ を選ぶと、ダッシュボードに「プロジェクトカルテ」が表示されます。\n\nそこの「✨ AI分析」ボタンを押すと、その PJ 単体の進捗・リスク・担当者偏り・次の一手を AI が分析します。",
    },
    {
      id: "okr-mode",
      target: "app-mode",
      placement: "bottom",
      skipIfMissing: true,
      title: "🎯 OKR管理モード",
      body: "上部の「OKR 管理」に切り替えると、目標管理画面に入ります。\n\nKR を選ぶと ①会議ノート → ②セッション記録 → ③分析 → ④レポート の 4 ステップで運用が回ります。\n\n「③ 分析」では、会議ノート・週次セッション・タスクを束ねて AI が分析し、レポート作成の素材になります。",
    },
    {
      id: "guide",
      target: "guide-btn",
      placement: "right",
      skipIfMissing: true,
      title: "📖 困ったらガイドへ",
      body: "左下の「📖 ガイド」に詳しいマニュアルがあります。\n\nガイドのトップページから、このツアーの再生や、各マニュアルへのジャンプができます。",
    },
    {
      id: "done",
      placement: "center",
      title: "🎉 ツアー完了",
      body: "以上で 1 周です。あとは触りながら覚えていけば大丈夫。\n\n迷ったときの目安：\n・サッと聞きたい → 右下「＋」→「💬 AI に相談する」\n・会議後の入力を一気に → 左「AIツールを開く」→「会議メモ」\n・PJ単体の健全性 → ダッシュボードで PJ を選ぶ\n・KR/OKR 全体 → OKRモード「③ 分析」\n\n困ったら各画面の「？」ボタンか、左下「📖 ガイド」へ。楽しく運用していきましょう。",
    },
  ],
};
