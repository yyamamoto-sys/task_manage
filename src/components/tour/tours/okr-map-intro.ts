// src/components/tour/tours/okr-map-intro.ts
//
// お知らせツアー「OKRモードが地図になりました」（v3.216）。
// 登録は tours/announcements.ts。基準は docs/dev/tour-guidelines.md（§13 お知らせツアー）。
// 地図の画面は data-tour-id を持たないため、画面中央の3段だけで説明する（OKRモードを開いていなくても出せる）。

import type { Tour } from "./types";

export const OKR_MAP_INTRO_TOUR_ID = "okr-map-intro";

export const okrMapIntroTour: Tour = {
  id: OKR_MAP_INTRO_TOUR_ID,
  title: "新機能：OKRモードの地図",
  estimatedSeconds: 40,
  steps: [
    {
      id: "intro",
      placement: "center",
      title: "🗺️ OKRモードが「地図」になりました",
      body: "KR・Task Force・プロジェクト・日々の仕事のつながりを、一枚で見渡せるようになりました。チームがいまどの段にいるか、どの仕事がどのKRに役立っているかが分かります。\n\n30秒でご案内します。今でなくてもよければ「あとで」を押してください（ガイドからいつでも見直せます）。",
      skipLabel: "あとで",
      nextLabel: "見てみる →",
    },
    {
      id: "docs",
      placement: "center",
      title: "📄 資料を読ませて下書きを作る",
      body: "OKRモードのサイドバーにある「資料を読ませる」で、チェックインの資料（PowerPoint・PDF・Word・テキスト）を読ませると、KRの見立てと決定事項・宿題の下書きが出ます。\n\n内容を確かめて「まとめて確定」を押すと、地図に反映されます。",
    },
    {
      id: "self",
      placement: "center",
      title: "👤 個人OKRの記録は「わたし」から",
      body: "これまでの個人OKRの記録（月の計画・実施記録・振り返り）は、地図の「わたし」にある「個人OKRの記録を開く」から開けます。",
      nextLabel: "完了",
    },
  ],
};
