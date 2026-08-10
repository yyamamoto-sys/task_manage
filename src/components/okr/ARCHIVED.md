# OKRモード：グループ側機能のアーカイブ台帳

**日付**：2026-08-10（v3.40）
**理由**：山本さんの判断（2026-08-10）。「元々あったグループモードの機能は一旦白紙にしたい。個人のモードだけにしたい。グループ側の機能は、一旦アーカイブとしてコードのみ保管する形にしましょう」。
**方針**：ファイルは移動・削除しない。**描画経路（import・呼び出し・ラボの導線・ガイド目次）を切るだけ**で、コード自体は将来の再設計のためそのまま残す。DBテーブル・ストア層（`krSessionStore`/`krMeetingNoteStore`/`okrAnalysisStore`/`krReportStore`/`quarterPlanStore`）も削除しない（データは保全）。
**再設計の方針**：将来グループ側を作るときは、この保管コードをそのまま復帰させることを前提にしない。`docs/dev/okr-redesign-plan.md` §8 Phase 6参照（ゼロベースで再設計する）。

---

## アーカイブ対象ファイル

| ファイル | 旧・役割 | 状態 |
|---|---|---|
| `src/components/okr/GroupOkrDashboardArchived.tsx` | 旧`OkrDashboardView.tsx`本体そのもの（〜v3.39）。上位タブ（OKR管理／なぜなぜ／計画）・サブタブ（①会議ノート／②セッション記録&分析／③レポート作成）・サイクル進捗バー・OKR概要オーバーレイ・セッション履歴オーバーレイ（`KrSessionHistory`/`SessionDetailBlock`）・「グループ／自分」切替seg（`okrScope`） | どこからもimportされていない（新しい`OkrDashboardView.tsx`は`PersonalOkrView`だけを描画する薄いラッパーに縮小） |
| `src/components/okr/KrMeetingNotePanel.tsx` | ① 会議ノート（KR×週、TFごとのセクション） | どこからもimportされていない |
| `src/components/lab/KrJointSessionFlow.tsx` | ② セッション記録（チェックイン／ウィンセッション／自由形式の合同フロー。宣言抽出・AI分析） | どこからもimportされていない |
| `src/components/okr/OkrKrAnalysisPanel.tsx` | 旧③分析（②に統合される前の互換保持コンポーネント。旧`activeTool==="analysis"`用） | どこからもimportされていない |
| `src/components/lab/KrReportPanel.tsx` | ③ レポート作成（KR週次レポートのAI生成・確定） | どこからもimportされていない |
| `src/components/lab/KrWhyPanel.tsx` | なぜなぜ分析（AI対話で根本原因を5Whys形式で掘り下げ） | どこからもimportされていない |
| `src/components/lab/KrQuarterPlanPanel.tsx` | クォーター計画（翌クォーターのTF計画をAI対話で立案。`kr_quarter_plans`保存） | どこからもimportされていない |

各ファイルの冒頭には次の注記コメントを入れてある：

```
【アーカイブ・2026-08-10】OKRモードのグループ側を白紙にする方針により、現在どこからも
描画されない。コードは将来の再設計のため保管。復帰手順は src/components/okr/ARCHIVED.md 参照。
```

（`GroupOkrDashboardArchived.tsx`のみ、新規ファイルであるため文言を少し変えた冒頭コメントにしている。）

## 切った描画経路（ファイルは残るがコード側の呼び出し口を撤去した箇所）

- `src/components/okr/OkrDashboardView.tsx` — 旧内容を`GroupOkrDashboardArchived.tsx`に退避し、`PersonalOkrView`のみを描画する新しい内容に置き換えた。`export type OkrActiveTool`・`okrScope` state・グループ側タブ/オーバーレイのJSXは全て撤去。
- `src/components/layout/MainLayout.tsx` — `LabViewId`から`"kr-report"`/`"kr-why"`/`"kr-session"`を撤去（`"graph" | "calendar" | "structure" | "mypage"`の4値に縮小）。`labOverlay`のswitch文・モバイルの`MobileFullscreenOverlay`分岐・モバイルのラボボトムシート項目（KRセッション記録／KRレポート生成／KRなぜなぜ分析の3項目）から該当ケースを削除。`KrReportPanel`/`KrJointSessionFlow`/`KrWhyPanel`の`lazyWithRetry`宣言を削除。`OkrDashboardView`呼び出し箇所から`selectedKrId`/`onSelectKr`/`activeTool`/`onSetActiveTool`の4propsを撤去（新しい`OkrDashboardView`は`currentUser`のみを受け取る）。`okrActiveTool`/`setOkrActiveToolPersisted`state・`OkrActiveTool`型importも撤去。モバイルのOKRモード用ボトムナビ（管理／なぜなぜ／計画の3ボタン）を撤去し、OKRモードでは`appMode==="plan"`の時だけボトムナビを表示するよう変更。サイドバーの「OKR管理：KR一覧」（OKRモード中に表示していたKR選択リスト。選択してもどこにも反映されなくなったため）を撤去。

## 復帰させるときに何を戻せばよいか

1. **グループ側UI本体を戻す**：`src/components/okr/GroupOkrDashboardArchived.tsx`の内容を`src/components/okr/OkrDashboardView.tsx`に丸ごと上書きする（エクスポート名を`GroupOkrDashboardArchived`→`OkrDashboardView`に戻す）。このファイルには「グループ／自分」の切替seg（`okrScope`）が既に入っているため、個人OKR（`PersonalOkrView`）と両方復活する。
2. **MainLayout.tsx側**：
   - `LabViewId`に`"kr-report"` / `"kr-why"` / `"kr-session"`を戻す。
   - `KrReportPanel`/`KrJointSessionFlow`/`KrWhyPanel`の`lazyWithRetry`宣言を戻す。
   - `labOverlay`のswitch文とモバイルの`MobileFullscreenOverlay`分岐に該当ケースを戻す。
   - モバイルのラボボトムシートに3項目を戻す（`t("layout.lab.krSession.*")`等のi18nキーも`src/i18n/layout.ja.ts`/`layout.en.ts`に戻す必要がある）。
   - `OkrDashboardView`呼び出し箇所に`selectedKrId`/`onSelectKr`/`activeTool`/`onSetActiveTool`の4propsを戻す。
   - `okrActiveTool`/`setOkrActiveToolPersisted`stateと`OkrActiveTool`型importを戻す。
   - モバイルのOKRモード用ボトムナビ（管理／なぜなぜ／計画）を戻す。
   - サイドバーの「OKR管理：KR一覧」ブロックを戻す（`layout.sidebar.allKrLabel`/`allKrTooltip`/`noKr`のi18nキーも戻す）。
3. **ガイド記事**：`docs/guides/02_modes/okr/00_cycle.md`〜`03_report.md`・`03_roles/kr-rep.md`・`03_roles/facilitator.md`・`04_workflows/weekly-rhythm.md`のfrontmatterから`archived: true`を外す。
4. **AIの機能認識**：`src/lib/ai/uiGuide.ts`の`FEATURE_LIST_SECTION`にグループ側の機能説明を書き戻す。
5. **初回ゲートの文言**：`src/i18n/common.ja.ts`/`common.en.ts`の`common.okrModeGate.feature1〜4`をグループ側の内容に戻す（あるいは個人・グループ両方を書く）。
6. アーカイブ対象ファイル冒頭の注記コメント（上記）を削除する。
7. `src/components/common/__tests__/modalStyles.test.ts`の`EXCLUDED_FILES`に`"components/okr/OkrDashboardView.tsx"`を戻す（右ドロワーのオーバーレイが復活するため）。

## 復帰させなくてよいもの（そのまま使える）

- DBテーブル（`kr_sessions`/`kr_declarations`/`kr_meeting_notes`/`kr_note_tf_entries`/`okr_analyses`/`kr_reports`/`kr_quarter_plans`等）とそのRLS。データは保全されている。
- ストア層（`src/lib/supabase/krSessionStore.ts`/`krMeetingNoteStore.ts`/`okrAnalysisStore.ts`/`krReportStore.ts`/`quarterPlanStore.ts`）。今回一切変更していない。
- AI関連（`invokeAI`の`"kr-report"`等のintent種別、`krSessionExtractor.ts`等）。今回一切変更していない。

## 実装時に判明した既存の設計との相違（次に読む人向けの注記）

- **クォーター計画（`KrQuarterPlanPanel`）に「サイドバーのラボからの独立導線（standalone）」は元から存在しなかった。** 実装前の想定では inline（OKRモードの「計画」タブ）とstandaloneの2経路があるとされていたが、コードを確認した限り`KrQuarterPlanPanel`の呼び出し元は旧`OkrDashboardView.tsx`の inline 1箇所のみで、`MainLayout.tsx`の`LabViewId`にもクォーター計画用のidは存在しなかった。よって今回撤去したのは inline 経路のみ（=当初想定の「両方」を満たしている。standalone経路自体が無かったため何もしていない、が正しい経緯）。
- **サイドバーのPC版ラボサブメニュー（`labOpen`ブロック）には、そもそも KRセッション記録／KRレポート生成／KRなぜなぜ分析の3項目が無かった。** これら3機能への導線は「モバイルのラボボトムシート」にしか存在しなかった（PC側は`labOverlay`のswitchケース自体は持っていたが、開くボタンがどこにも配線されていなかった＝到達不能コードだった可能性が高い）。今回はモバイル側の3項目とPC/モバイル共通の`labOverlay`switchケースの両方を削除した。
