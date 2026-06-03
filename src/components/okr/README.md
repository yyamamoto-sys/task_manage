# モジュール D：OKR

> 週次OKRサイクル（①会議ノート→②セッション&分析→③レポート）＋なぜなぜ＋クォーター計画。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「D OKR」。設計は `docs/okr-cycle-design.md`。

## このモジュールは複数フォルダにまたがる
| 場所 | 役割 |
|---|---|
| `components/okr/OkrDashboardView.tsx` | OKRモードの土台。上位タブ（OKR管理/なぜなぜ/計画）＋サブタブ（①会議ノート/②セッション記録&分析/③レポート作成） |
| `components/okr/KrMeetingNotePanel.tsx` | ① 会議ノート（KR×週で1件・引き継ぎメモ） |
| `components/okr/OkrKrAnalysisPanel.tsx` | ③ 分析（KR/Objectiveスコープ） |
| `components/lab/KrJointSessionFlow.tsx` | ② セッション記録&分析（合同/単一KR・文字起こし抽出） |
| `components/lab/KrReportPanel.tsx` / `KrWhyPanel.tsx` / `KrQuarterPlanPanel.tsx` | レポート / なぜなぜ / クォーター計画 |
| `lib/ai/kr*`・`okr*Client` | 各AI（抽出・分析・レポート・なぜなぜ・計画）。AI基盤 `invokeAI` 経由 |
| `lib/supabase/kr*Store`・`okrAnalysisStore`・`quarterPlanStore` | 永続化 |
| `lib/okr/{tfQuarter,eligibleTaskForces}.ts` | TFの四半期判定・対象TF絞り込み |

## 改修・バグ探しの注意点
- 用語・サイクルの定義は `docs/guides/02_modes/okr/` と `docs/okr-cycle-design.md`。
- DBスキーマ変更（kr_sessions等）は **手動マイグレ**（`supabase/migrations/`）。適用忘れに注意。
- 「②に分析を統合済み（旧③分析は②へ）」など番号の変遷あり。最新タブ構成は `OkrDashboardView.tsx`。
