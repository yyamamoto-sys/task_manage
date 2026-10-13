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
  estimatedSeconds: 120,
  steps: [
    {
      id: "okr-welcome",
      placement: "center",
      title: "🎯 OKRモードとは",
      body: "Kintoneが正本のOKRを、月ごとに「計画 → 実施記録 → 振り返り」で記録するモードです。週ごとの目標・自己評価は、使いたい人だけが使う任意の機能です。\n\n所要2分ほど。いつでも✕で終了でき、サイドバー最下部「⋯」→「📖 ガイド」からまた再生できます。",
    },
    {
      id: "okr-period",
      target: "okr-period",
      placement: "bottom",
      skipIfMissing: true,
      title: "📅 対象期を選ぶ",
      body: "年・四半期・月を選びます。\n\n月を切り替えても、選んでいるKRのタブはそのまま保持されます。過去月も編集できます（未来月は編集できません）。",
    },
    {
      id: "okr-kr-tabs",
      target: "okr-kr-tabs",
      placement: "bottom",
      skipIfMissing: true,
      title: "📑 KRタブ",
      body: "ここに、あなたの個人の四半期KRがタブで並びます。先頭の「全体」タブでは、月全体・四半期全体の振り返りを記録できます。\n\nタブにはその月のウェイト（%）も表示されます。",
    },
    {
      id: "okr-month-plan",
      target: "okr-month-plan",
      placement: "auto",
      skipIfMissing: true,
      title: "🗒️ 今月の計画",
      body: "位置づけ・当月に取り組む内容・当月末の達成目標と証拠・リスクを記録します。\n\nKintoneから取り込むか、手で書きます。「✦ 前月をふまえて下書き」で下書きを作れ、「📋 全文をコピー」でKintoneへ貼り付けられます。",
    },
    {
      id: "okr-week-cards",
      target: "okr-week-cards",
      placement: "auto",
      skipIfMissing: true,
      title: "★ 週の目標状態（任意）",
      body: "このアプリだけが持つ補助の層で、使うかどうかは自由です。\n\n使う場合は、週ごとに「この週どうなっていればよいか」を書き、◯（達成）／△（一部）／✕（未達）で自分で評価します。",
    },
    {
      id: "okr-week-tasks",
      target: "okr-week-cards",
      placement: "auto",
      skipIfMissing: true,
      title: "🔗 タスクとの紐づけ",
      body: "計画モードのタスクを週に紐づけると、遅れ・停滞・先行待ちがその週カードに表示されます。\n\nサンプル表示のときは、例として遅延と先行待ちのタスクが1件ずつ紐づいています。",
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
      id: "okr-actual",
      target: "okr-actual",
      placement: "auto",
      skipIfMissing: true,
      title: "📝 実施記録",
      body: "計画外の対応や方針転換など、実際に起きたことを自由に書き残します。\n\n振り返りの下書きをAIが作るときの材料にもなります。",
    },
    {
      id: "okr-review",
      target: "okr-month-review",
      placement: "auto",
      skipIfMissing: true,
      title: "🔁 月の振り返り",
      body: "振り返り本文・自己評価%・GM評価%・GMコメントを記録します。「📝 振り返りの下書き」でAIが下書きを作り、「📋 全文をコピー」でKintoneへ貼り付けられます。",
    },
    {
      id: "okr-registration",
      target: "okr-registration-actions",
      placement: "bottom",
      skipIfMissing: true,
      title: "📥 登録して始める",
      body: "「📥 Kintoneから取込」または「＋ KRを追加」から、実際のKRを登録できます。\n\n以上でツアーは完了です。困ったときはサイドバー最下部「⋯」→「📖 ガイド」からいつでも見直せます。",
    },
  ],
};
