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
  estimatedSeconds: 120,
  steps: [
    {
      id: "welcome",
      placement: "center",
      title: "👋 ようこそ",
      body: "このアプリは OKR（目標）× プロジェクト × タスク を 1 箇所で運用するためのツールです。\n\nこのツアーでは、主要画面と AI 機能を順にご案内します。AI には実際に相談を実演してもらいます。\n\n所要 2 分ほど。いつでも ✕ で終了でき、左下「📖 ガイド」からまた再生できます。",
    },
    {
      id: "sidebar",
      target: "sidebar",
      placement: "right",
      skipIfMissing: true,
      title: "🗂️ 左：メニューとプロジェクト一覧",
      body: "・上のメニューで5つのビューを切替：ダッシュボード（全体把握）／カンバン（未着手・進行中・完了）／ガント（期間表示）／リスト（絞り込み・CSV）／ワークロード（メンバー別の負荷）\n・下にプロジェクト一覧。「全件／自分」で自分が担当のタスクを持つPJだけに絞れます\n\n切り替えても同じタスクを別角度で見ているだけです。",
    },
    {
      id: "ai-tool-btn",
      target: "ai-tool-btn",
      placement: "right",
      skipIfMissing: true,
      title: "✨ AIの入口：「AIツールを開く」",
      body: "左サイドバーの「✨ AIツールを開く」（紫のボタン）を押すと、画面の右側に AI パネルが開きます。\n\n2 つのモードを切り替えて使えます：\n・💬 相談：相談しながら新しい PJ・タスクの登録もできます\n・📄 資料インプット：議事録や資料を貼ると新規タスクとステータス更新を自動提案\n\n「腰を据えて AI と作業する」ときはこちらが基本です。",
    },
    {
      id: "ai-consult-demo",
      target: "ai-panel",    // 右側のAIパネルをスポットライト（周囲は暗くなる）
      placement: "left",
      skipIfMissing: true,
      action: "demo-ai-consult",
      title: "💬 AIに相談してみましょう（実演）",
      body: "右側に開いた AI パネル（明るく強調されている部分）に、相談を1つ自動で入力・送信します。\n\nすでに登録済みのプロジェクト・タスクがあれば、その内容を踏まえた分析（優先度・遅延の見立て・次の一手）を返します。まだ何も無ければ、始め方のコツを答えてくれます（生成に数秒）。\n\n※これはデモです。気軽に眺めてください。",
    },
    {
      id: "fab",
      dim: false,
      placement: "center",
      skipIfMissing: true,
      title: "👉 もう一つの入口：右下の＋ボタン（FAB）",
      body: "画面右下の丸いボタン「＋」が FAB です。\n\n押すと 3 つのショートカットが展開されます：\n・💬 AIに相談する\n・◆ マイルストーン追加（PJの節目を登録）\n・＋ タスクを追加（AI不要のクイック追加）\n\n「思いついた瞬間に1クリックで登録」したいときはこちら。",
    },
    {
      id: "pj-karte-nav",
      placement: "center",
      action: "open-dashboard-pj-analysis",
      title: "📊 PJ単体の AI 分析",
      body: "左サイドバーのプロジェクト一覧から PJ を1つ選ぶと、ダッシュボードに「プロジェクトカルテ」が表示されます。\n\nそこにある「✨ AI分析」ボタンを押すと、その PJ の進捗・リスク・担当者の偏り・次の一手を AI が分析します。\n\n▶ 「次へ」を押すと自動的にダッシュボードへ移動し、そのボタンを確認できます。",
    },
    {
      id: "pj-karte-btn",
      target: "pj-ai-analyze-btn",
      placement: "left",
      skipIfMissing: true,
      title: "📊 ここが「AI分析」ボタンです",
      body: "このボタンを押すと、PJ 単体の健全性を AI が分析します。\n\n進捗・リスク・担当者の偏り・次の一手を一気に洗い出せます。",
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
      body: "以上で 1 周です。あとは触りながら覚えていけば大丈夫。\n\n迷ったときの目安：\n・サッと聞きたい → 右下「＋」→「💬 AIに相談する」\n・議事録・資料の読み込みを一気に → 左「AIツールを開く」→「📄 資料インプット」\n・PJ単体の健全性 → ダッシュボードで PJ を選ぶ\n\n困ったら各画面の「？」ボタンか、左下「📖 ガイド」へ。楽しく運用していきましょう。",
    },
  ],
};
