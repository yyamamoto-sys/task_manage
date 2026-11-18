// src/components/tour/tours/okr-map.ts
//
// ⚠ 文面・絵文字・番号・ステップ構成を変える前に必ず読む：docs/dev/tour-guidelines.md
//
// OKRモードの「地図」の画面のガイドツアー（v3.217）。起動は src/components/okr/map/OkrMapView.tsx の
// OkrMapTourStarter（地図が表示されたとき1回・ガイドからの再生）。ターゲットは地図の部品の data-tour-id。
// 「チーム」ページだけにある部品（okr-map-band）と「わたし」ページだけにある部品（okr-map-personal・okr-map-reflect）、
// サイドバーが無い狭い画面の部品は、無ければ skipIfMissing で次へ進む。
// 個人OKRの記録の画面のツアーは okr-intro.ts（別ツアー）。

import type { Tour } from "./types";

export const OKR_MAP_TOUR_ID = "okr-map";

export const okrMapTour: Tour = {
  id: OKR_MAP_TOUR_ID,
  title: "OKRモード（地図）ガイドツアー",
  estimatedSeconds: 100,
  steps: [
    {
      id: "map-welcome",
      placement: "center",
      title: "🗺️ OKRモードは「地図」です",
      body: "KR・Task Force・プロジェクト・日々の仕事のつながりを一枚で見渡す画面です。チームがいまどの段にいるか、どの仕事がどのKRに役立っているかが分かります。\n\n所要2分ほど。いつでも✕で終了でき、サイドバー最下部「⋯」→「📖 ガイド」からまた再生できます。",
    },
    {
      id: "map-menu",
      target: "okr-map-menu",
      placement: "right",
      skipIfMissing: true,
      title: "👥 チームと、わたし",
      body: "「チーム」は全員に見えるページ、「わたし」は本人だけのページです。\n\n「わたし」には、今週やる仕事・今週の振り返り・個人OKRの記録への入口があります。",
    },
    {
      id: "map-band",
      target: "okr-map-band",
      placement: "auto",
      skipIfMissing: true,
      title: "📶 チームはいま、どの段にいるか",
      body: "KRごとに、AIの見立てを段の目盛り（60・70・80…。60が出発点）で表示します。\n\n見立てはチェックイン資料の記述から出たもので、数字だけでは決まりません。",
    },
    {
      id: "map-flow",
      target: "okr-map-flow",
      placement: "auto",
      skipIfMissing: true,
      title: "🔀 仕事がどこへ流れているか",
      body: "プロジェクトの仕事が、Task Force、KRへとどうつながっているかを帯で示す図です。帯は仕事の件数で、完了と残りが分かります。\n\n右上の「全体」で、チームとあなたの見え方を見比べられます。",
    },
    {
      id: "map-kr-list",
      target: "okr-map-kr-list",
      placement: "right",
      skipIfMissing: true,
      title: "📑 KRを選んで詳しく見る",
      body: "サイドバーのKRを押すと、そのKRの詳細が地図の横に開きます。\n\n各KRのAIの見立てと、前回からの動きも一覧できます。",
    },
    {
      id: "map-docs",
      target: "okr-map-docs",
      placement: "right",
      skipIfMissing: true,
      title: "📄 資料を読ませる",
      body: "チェックインの後に使います。資料（PowerPoint・PDF・Word・テキスト）をAIに読ませると、見立て・学び・決定事項・宿題の下書きが出ます。\n\n内容を確かめて「まとめて確定」を押すと、地図に反映されます。",
    },
    {
      id: "map-goals",
      target: "okr-map-goals",
      placement: "bottom",
      skipIfMissing: true,
      title: "⚙️ O・KRの取り込み",
      body: "Kintoneで管理しているO・KRと、このアプリの内容の違いを確かめ、合わせたいものを選んで反映します。\n\nO・KRを更新したいときに開きます。",
    },
    {
      id: "map-personal",
      target: "okr-map-personal",
      placement: "bottom",
      skipIfMissing: true,
      title: "📘 個人OKRの記録を開く",
      body: "「わたし」のページから、KRごとの月次の計画・週の目標と自己評価・メモを記録する画面を開けます。\n\nその画面にも専用のガイドツアーがあります。",
    },
    {
      id: "map-reflect",
      target: "okr-map-reflect",
      placement: "auto",
      skipIfMissing: true,
      title: "🔁 今週の振り返り",
      body: "「わたし」のページで、今週の仕事がKRの役に立ったかを振り返れます。本人だけに見え、ほかの人にもGMにも見えません。",
    },
    {
      id: "map-finish",
      placement: "center",
      title: "✅ 以上でツアーは完了です",
      body: "チーム全体は「チーム」、自分の仕事は「わたし」で確かめられます。\n\n困ったときはサイドバー最下部「⋯」→「📖 ガイド」からいつでも見直せます。",
      nextLabel: "完了",
    },
  ],
};
