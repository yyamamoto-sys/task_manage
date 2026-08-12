// src/components/tour/tours/okr-intro.ts
//
// ⚠ 文面・絵文字・番号・ステップ構成を変える前に必ず読む：docs/dev/tour-guidelines.md
//
// OKRモード（個人OKR）を初めて選んだときに自動で始まるガイドツアー（CLAUDE.md Section 24）。
// 起動条件・サンプル差し込み・再生導線の実装は src/components/okr/personal/PersonalOkrView.tsx
// （tour.start() の呼び出し元）を参照。ターゲットは data-tour-id 属性で指定。
//
// 対象のうち okr-month-plan／okr-week-cards／okr-ahead は「当月のタブを開いているとき」
// にしか存在しない（過去月・未来月では出ない）。skipIfMissing:true にしているため、
// 該当が無い場合は自動で次のステップへ進む。

import type { Tour } from "./types";

export const okrIntroTour: Tour = {
  id: "okr-intro",
  title: "OKRモード ガイドツアー",
  estimatedSeconds: 90,
  steps: [
    {
      id: "okr-welcome",
      placement: "center",
      title: "🎯 OKRモードとは",
      body: "Kintoneが正本のOKRに、このアプリだけの「週」の層を足すモードです。月末に計画を思い出すだけの運用を、週ごとに前進を確かめる運用に変えるのが狙いです。\n\n所要1分ほど。いつでも✕で終了でき、「📖 ガイド」からまた再生できます。",
    },
    {
      id: "okr-period",
      target: "okr-period",
      placement: "bottom",
      skipIfMissing: true,
      title: "📅 対象期を選ぶ",
      body: "年・四半期・月を選びます。\n\n月を切り替えても、選んでいるKRのタブはそのまま保持されます。",
    },
    {
      id: "okr-kr-tabs",
      target: "okr-kr-tabs",
      placement: "bottom",
      skipIfMissing: true,
      title: "📑 KRタブ",
      body: "ここに、あなたの個人の四半期KRがタブで並びます。\n\nタブにはウェイト（%）も表示されます。",
    },
    {
      id: "okr-month-plan",
      target: "okr-month-plan",
      placement: "auto",
      skipIfMissing: true,
      title: "🗒️ 今月の計画",
      body: "位置づけ・当月に取り組む内容・当月末の達成目標と証拠・リスクを記録します。\n\nKintoneから取り込むか、手で書きます。達成度バンドは「狙いの水準」です。",
    },
    {
      id: "okr-week-cards",
      target: "okr-week-cards",
      placement: "auto",
      skipIfMissing: true,
      title: "★ 週の目標状態",
      body: "このアプリだけが持つ層です。\n\n週ごとに「この週どうなっていればよいか」を書き、◯（達成）／△（一部）／✕（未達）で自分で評価します。",
    },
    {
      id: "okr-week-tasks",
      target: "okr-week-cards",
      placement: "auto",
      skipIfMissing: true,
      title: "🔗 タスクとの紐づけ",
      body: "計画モードのタスクを週に紐づけると、遅れ・停滞・先行待ちがその週カードに表示されます。\n\n表示されている例では、遅延と先行待ちのタスクが1件ずつ紐づいています。",
    },
    {
      id: "okr-ahead",
      target: "okr-ahead",
      placement: "auto",
      skipIfMissing: true,
      title: "🔮 これから",
      body: "残りの週数と、これまでの自己評価の積み上げを機械的に表示します。\n\nAIの見立ては「✦ 見立てを出す」を押したときだけ動きます。押さない限りトークンは使いません。",
    },
    {
      id: "okr-registration",
      target: "okr-registration-actions",
      placement: "bottom",
      skipIfMissing: true,
      title: "📥 登録して始める",
      body: "「📥 Kintoneから取込」または「＋ KRを追加」から、実際のKRを登録できます。グループOKRなど、今後も機能を追加していく予定です。\n\n以上でツアーは完了です。困ったときは「📖 ガイド」からいつでも見直せます。",
    },
  ],
};
