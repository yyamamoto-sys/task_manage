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
}

export interface Tour {
  id: string;
  title: string;
  /** 推定所要秒数（オーバーレイ右上などに表示する想定） */
  estimatedSeconds?: number;
  steps: TourStep[];
}
