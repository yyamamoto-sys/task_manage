## 14.6. マイページ用ウィジェット改修の必読ルール（必須）

ラボ機能「マイページ」のウィジェット（`src/components/lab/widgets/` 配下）には、契約・作法・
禁止事項をまとめた専用の仕様書があります。

```
docs/dev/widget-authoring.md  ← WidgetContextの完全リファレンス・configSchemaの全type一覧・
                                  禁止事項・choke pointを通す理由・提出前チェックリスト
```

**マイページ用ウィジェットを追加・変更する前に、必ず `docs/dev/widget-authoring.md` を読み、
その契約（`useAppStore`/`supabase` の直接使用禁止・`WidgetContext` だけを唯一の入口とする・
`configSchema` 駆動の設定フォーム等）に従うこと。** この契約は
`src/components/lab/widgets/__tests__/widgetContract.test.ts` で機械的にも強制されている
（違反すると `npx vitest run` が落ちる）。

**セッション中の合言葉**：「ウィジェットを作りたい／マイページに機能を足したい」と言われたら、
まず `docs/dev/widget-authoring.md` を読んでから着手・提案すること。

---
