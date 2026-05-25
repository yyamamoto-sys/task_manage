// src/components/tour/tours/first-time.ts
//
// 初回ツアー（90 秒・7 ステップ）。
// ターゲットは data-tour-id 属性で指定。skipIfMissing で UI 変更に強く。

import type { Tour } from "./types";

export const firstTimeTour: Tour = {
  id: "first-time",
  title: "アミタ計画管理アプリ ツアー",
  estimatedSeconds: 90,
  steps: [
    {
      id: "welcome",
      placement: "center",
      title: "👋 ようこそ",
      body: "このアプリは OKR（目標）× プロジェクト × タスク を 1 箇所で運用するためのツールです。\n\n90秒で主要画面と AI 機能の入口をご案内します。",
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
      id: "fab",
      target: "fab",
      placement: "left",
      skipIfMissing: true,
      title: "✨ 右下：AI 機能の入口（最重点）",
      body: "右下の＋ボタンをクリックすると 3 つのメニューが開きます。\n\n・💬 AI に相談する：自由に質問（影響整理・診断など）\n・✨ AI で PJ を作る：議事メモから PJ を自動生成\n・＋ タスクを追加：通常のクイック追加\n\nAI には現在の OKR・PJ・タスク・担当者・期日が渡るので、文脈を踏まえた助言が返ります。",
    },
    {
      id: "okr-mode",
      target: "app-mode",
      placement: "bottom",
      skipIfMissing: true,
      title: "🎯 OKR管理モード",
      body: "上部の「OKR 管理」に切り替えると、目標管理画面に入ります。\n\nKR を選ぶと ①会議ノート → ②セッション記録 → ③分析 → ④レポート の 4 ステップで運用が回ります。週次の進捗と AI 分析がここで完結します。",
    },
    {
      id: "guide",
      target: "guide-btn",
      placement: "right",
      skipIfMissing: true,
      title: "📖 困ったらガイドへ",
      body: "左下の「📖 ガイド」に詳しいマニュアルがあります。\n\nこのツアーもガイドの最上部「👋 オンボーディングを見直す」からいつでも再生できます。",
    },
    {
      id: "done",
      placement: "center",
      title: "🎉 基本ツアー完了",
      body: "以上で 1 周です。あとは触りながら覚えていけば大丈夫。\n\n迷ったら：\n・各画面の「？」ボタン（その画面の使い方）\n・左下「📖 ガイド」（詳細マニュアル＋ツアー再生）\n\n楽しく運用していきましょう。",
    },
  ],
};
