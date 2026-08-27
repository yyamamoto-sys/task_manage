// src/lib/ai/actualWorkNotice.ts
//
// 【設計意図】
// 「実施記録」欄（山本さんの依頼・2026-08-27・v3.105）を渡しても、既存のプロンプトの
// 評価軸が「当月末の狙いに対して計画どおり進んだか」のままでは、計画外の対応・方針転換・
// 追加業務が「逸脱」として扱われてしまい、依頼の核心（事後の記録を正当な成果として
// 振り返りに含める）を満たせない。weeklyOptionalNotice.tsと同じ流儀で、共通条項を
// 1箇所に定数化する（文言を分散させると片方だけ直されて取り残される。CLAUDE.mdの
// 「コピペ実装は1つだけ改良される」の教訓）。
//
// 🔴 仕様書§W5では「4つのプロンプト（personalOkrAiContext.ts／
// personalOkrReviewDraftExtractor.ts／planDraftContext.ts／periodReviewDraftContext.ts）」に
// 埋め込む指示だったが、実装にあたりweeklyOptionalNotice.tsの実際の埋め込み先
// （SYSTEM_PROMPTを持つ5つのAI呼び出しファイル：personalOkrChatPrompt.ts／
// personalOkrOutlookExtractor.ts／personalOkrPeriodReviewDraftExtractor.ts／
// personalOkrPlanDraftExtractor.ts／personalOkrReviewDraftExtractor.ts）と揃える形に変更した。
// 「これから」の見立て（outlookExtractor）とAIパネルのチャット（chatPrompt）は
// personalOkrAiContext.tsの文脈テキストを末尾に埋め込むだけで自身のSYSTEM_PROMPTを持たない
// ため、この条項自体をそこに埋めても実際にAIへ届く。ただし評価軸の指示は「本文（データ）」
// ではなく「指示（システムプロンプト）」に置く方が意図が伝わりやすく、5ファイルとも
// SYSTEM_PROMPT側に直接埋め込む方が一貫する。この変更は統括に報告済み。
export const ACTUAL_WORK_COUNTS_NOTICE = `【実施記録の扱い】
月の途中で生じた緊急対応・方針転換・計画になかった追加業務は、計画からの逸脱ではなく、
その月に実際に生まれた成果である。
- 実施記録に書かれた計画外の取り組みを、正当な成果として評価・記述に含めること。
- 「計画どおりに進んだか」だけを評価軸にしないこと。計画が変わったこと自体を否定的に扱わない。
- 計画と実績がずれている場合は、ずれを咎めるのではなく、何が起きて何を優先したのかを記述すること。
- 実施記録に記入が無い場合、記入が無いこと自体には言及しない。`;
