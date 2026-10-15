// src/components/tour/tours/types.ts
//
// ツアー定義の型。データ駆動で UI コードと分離するための契約。

export interface TourStep {
  /** 任意 ID（デバッグ用） */
  id?: string;
  /** data-tour-id="..." 属性で指す DOM 要素。省略すると画面中央表示 */
  target?: string;
  /** 吹き出しタイトル */
  title: string;
  /** 吹き出し本文（改行 `\n` 可） */
  body: string;
  /** 吹き出しの表示位置（auto=ターゲットの上下空きで自動、center=画面中央） */
  placement?: "auto" | "top" | "bottom" | "left" | "right" | "center";
  /** ターゲット要素が DOM になければ次のステップへ自動進行（UI 変更耐性のため既定 true 推奨） */
  skipIfMissing?: boolean;
  /** ステップ表示時に発火するアクション名。TourProvider が window の "tour:action"
   *  CustomEvent（detail=action）で通知し、アプリ側がリッスンして実演（パネルを開く等）を行う。 */
  action?: string;
  /** false にすると暗幕（オーバーレイ）を描かず吹き出しのみ表示する。
   *  実演でアプリ画面（AIパネル等）をそのまま見せ・操作させたいステップで使う。既定 true。 */
  dim?: boolean;
  /** 「利用者が実際に操作したら進む」ステップ。指定した data-tour-id の要素が DOM に現れたら次へ進む
   *  （例：ベルを押す→パネル `notification-panel` が開く）。この種別では「次へ」「戻る」を出さず、
   *  Enter・矢印キーでも進まない（吹き出しの本文に「◯◯を押してください」と書く）。 */
  advanceOn?: { appears: string };
  /** このステップの間、指定した data-tour-id の要素が見えている必要がある。消えたら
   *  onLost に従う（back＝1つ前のステップへ戻る／end＝ツアーを終える）。advanceOn の判定が優先される。 */
  whileVisible?: { id: string; onLost: "back" | "end" };
  /** 「スキップ」ボタンの文言（既定「スキップ」。お知らせツアーの冒頭は「あとで」） */
  skipLabel?: string;
  /** 「次へ →」ボタンの文言 */
  nextLabel?: string;
  /** true にすると、ステップ表示時に吹き出しへフォーカスを奪わない（背後の入力欄の入力を妨げないため） */
  keepFocus?: boolean;
  /** true にすると、スポットライトの枠線を吹き出しと同じ重なり（z-index 10000。DOM 上は吹き出しの後ろ）へ上げる。
   *  ベルのパネル（z-index 9999）の中のように、暗幕・通常の枠線（9991）より手前にある対象を指すときだけ使う。 */
  raiseSpotlight?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  /** 推定所要秒数（オーバーレイ右上などに表示する想定） */
  estimatedSeconds?: number;
  steps: TourStep[];
}
