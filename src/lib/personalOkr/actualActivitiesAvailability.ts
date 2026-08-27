// src/lib/personalOkr/actualActivitiesAvailability.ts
//
// 【設計意図】
// 「実施記録」欄（山本さんの依頼・2026-08-27・v3.105）の入力欄を、actual_activities列
// （migrations/20260827_add_actual_activities.sql）が未適用の間は出さないための状態。
//
// 【Step 0で確認した事実：なぜ check_schema_health RPC を使わないか】
// schemaChecks.ts の検査結果は check_schema_health RPC 経由だが、このRPC自体が
// 「部署管理者・全社スーパー管理者以外には常に空配列を返す」設計（SECURITY DEFINER・
// 20260806_add_schema_health_check.sql）。実施記録は一般メンバーも使う機能のため、
// このRPCの結果をUI表示のゲートに使うことはできない（一般メンバーには常に「未適用」
// または「不明」にしか見えてしまう）。SchemaHealthBanner（管理者向け警告）には従来どおり
// schemaChecks.ts の検査項目として別途登録し、こちらは「一般メンバーでも判定できる代替
// プローブ」として独立に用意する（src/lib/supabase/personalOkrStore.ts の
// probeActualActivitiesColumn）。
//
// "unknown"（未確認）の間は入力欄を出さない（案内も出さない。プローブは高速なので
// 一瞬で解決する想定）。"unavailable" と判明したときだけ「データベースへの適用がまだ」の
// 案内を出す。"available" になったら通常のUIを描画する。
export type ActualActivitiesAvailability = "unknown" | "available" | "unavailable";
