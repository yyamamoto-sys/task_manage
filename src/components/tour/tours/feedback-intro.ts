// src/components/tour/tours/feedback-intro.ts
//
// お知らせツアー「アプリ内から要望を送れるようになりました」（v3.159）。
// 登録は tours/announcements.ts。基準は docs/dev/tour-guidelines.md（§13 お知らせツアー）。
// 2〜3段目は「利用者が実際に押したら進む」（advanceOn）。パネル・モーダルを閉じたときの扱いは whileVisible。

import type { Tour } from "./types";

export const FEEDBACK_INTRO_TOUR_ID = "feedback-intro";

export const feedbackIntroTour: Tour = {
  id: FEEDBACK_INTRO_TOUR_ID,
  title: "新機能：アプリ内から要望を送る",
  estimatedSeconds: 45,
  steps: [
    {
      id: "intro",
      placement: "center",
      title: "💬 要望を送れるようになりました",
      body: "「ここが使いにくい」「こうなってほしい」を、アプリの中からそのまま送れるようになりました。\n\nやり方を30秒でご案内します。今でなくてもよければ「あとで」を押してください（ガイドからいつでも見直せます）。",
      skipLabel: "あとで",
      nextLabel: "見てみる →",
    },
    {
      id: "bell",
      target: "notification-bell",
      placement: "bottom",
      skipIfMissing: true,
      title: "🔔 ベルを押してください",
      body: "画面の右上にあるベルを押してください。押すと次へ進みます。",
      skipLabel: "やめる",
      advanceOn: { appears: "notification-panel" },
    },
    {
      id: "entry",
      target: "bell-feedback-entry",
      placement: "bottom",
      skipIfMissing: true,
      title: "💬 ご意見を送るを押す",
      raiseSpotlight: true,
      body: "光っている「💬 ご意見を送る」を押してください。押すと送信画面が開きます。",
      skipLabel: "やめる",
      advanceOn: { appears: "feedback-modal" },
      whileVisible: { id: "notification-panel", onLost: "back" },
    },
    {
      id: "write",
      target: "feedback-textarea",
      placement: "auto",
      skipIfMissing: true,
      title: "✍ 一言書いて送れます",
      body: "一言書いて Ctrl+Enter（Mac は Cmd+Enter）で送れます。画面の状況も自動で付くので、うまく説明できなくても大丈夫です。\n\n今回は送らずに終わっても構いません。",
      nextLabel: "完了",
      keepFocus: true,
      whileVisible: { id: "feedback-modal", onLost: "end" },
    },
  ],
};
