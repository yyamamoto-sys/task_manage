# モジュール D：OKR

> 🔴 **2026-08-10・グループ側アーカイブ済み**。旧・週次OKRサイクル（①会議ノート→②セッション&分析→
> ③レポート）＋なぜなぜ＋クォーター計画は、山本さんの判断で一旦白紙にし、コードのみ保管している
> （`ARCHIVED.md`参照。ファイルは削除していない）。**現在のOKRモードは個人OKR（`personal/`配下）のみ**。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「D OKR」。設計は `docs/okr-cycle-design.md`。
> アーカイブの詳細・復帰手順は [`ARCHIVED.md`](./ARCHIVED.md)。

## 現在使われているもの
| 場所 | 役割 |
|---|---|
| `components/okr/OkrDashboardView.tsx` | OKRモードの土台。現在は`personal/PersonalOkrView.tsx`のみを描画する薄いラッパー |
| `components/okr/personal/` | 個人OKR（KRごとの月次計画・週の目標状態・自己評価◯△✕・メモ）。Phase 1（v3.36〜v3.39）実装済み |

## アーカイブ済み（コードは残るが、どこからも描画されない。`ARCHIVED.md`参照）
| 場所 | 旧・役割 |
|---|---|
| `components/okr/GroupOkrDashboardArchived.tsx` | 旧`OkrDashboardView.tsx`本体。上位タブ（OKR管理/なぜなぜ/計画）＋サブタブ（①会議ノート/②セッション記録&分析/③レポート作成）＋OKR概要・セッション履歴オーバーレイ＋「グループ／自分」切替seg |
| `components/okr/KrMeetingNotePanel.tsx` | ① 会議ノート（KR×週で1件・引き継ぎメモ） |
| `components/okr/OkrKrAnalysisPanel.tsx` | 旧③分析（KR/Objectiveスコープ。②へ統合される前の互換保持コンポーネント） |
| `components/lab/KrJointSessionFlow.tsx` | ② セッション記録&分析（合同・freeform・文字起こし抽出。単一KRパネルは`d547b69`で廃止済み） |
| `components/lab/KrReportPanel.tsx` / `KrWhyPanel.tsx` / `KrQuarterPlanPanel.tsx` | レポート / なぜなぜ / クォーター計画 |

**AI・永続化層は無改修**（アーカイブ対象外。将来グループ側を再設計するときに使えるが、再設計はゼロベースを推奨。`docs/dev/okr-redesign-plan.md` §8参照）：
| 場所 | 役割 |
|---|---|
| `lib/ai/kr*`・`okr*Client` | 各AI（抽出・分析・レポート・なぜなぜ・計画）。AI基盤 `invokeAI` 経由 |
| `lib/supabase/kr*Store`・`okrAnalysisStore`・`quarterPlanStore` | 永続化 |
| `lib/okr/{tfQuarter,eligibleTaskForces}.ts` | TFの四半期判定・対象TF絞り込み |

## 改修・バグ探しの注意点
- 用語・サイクルの定義は `docs/guides/02_modes/okr/` と `docs/okr-cycle-design.md`（ただしガイド記事はfrontmatterの`archived: true`により目次からは除外済み。ファイルは残っている）。
- DBスキーマ変更（kr_sessions等）は **手動マイグレ**（`supabase/migrations/`）。適用忘れに注意。
- 「②に分析を統合済み（旧③分析は②へ）」など番号の変遷あり。旧タブ構成は `GroupOkrDashboardArchived.tsx`（アーカイブ済み）。
