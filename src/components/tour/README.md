# モジュール G：オンボーディング（tour ＋ guide）

> 初回ツアー・📖ガイド・各画面の `?` ヘルプ。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「G オンボーディング」。

## このモジュールに含まれるもの
| 場所 | 役割 |
|---|---|
| `components/tour/TourProvider.tsx` | ツアー実行エンジン（暗幕・吹き出し・完了フラグ `tour_completed_v1`） |
| `components/tour/tours/first-time.ts` | ツアー本文（ステップ定義） |
| `components/guide/GuideModeView.tsx` | 📖ガイド本体（`docs/guides/**` を描画） |
| `components/guide/HelpButton.tsx` / `GuideOverlay.tsx` | 各画面の `?` ボタン |
| `src/lib/docs/{manifest,types}.ts` | `docs/guides/**/*.md` をビルド時取込・frontmatterパース |
| `docs/guides/**` | ガイド本文（編集すれば即アプリに反映） |

## 改修・バグ探しの注意点
- **ツアーの見た目・文面を変える前に必ず `docs/dev/tour-guidelines.md` を読む**（トンマナ統一基準）。
- ガイド文面はコードではなく `docs/guides/**` の Markdown を編集する。
- ターゲットは `data-tour-id` 属性で指定（UI変更に強い・`skipIfMissing` で要素が無ければスキップ）。
