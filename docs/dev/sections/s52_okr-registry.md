## 52. 個人OKR「今月の計画」欄・「振り返り」欄をunsavedEditorRegistryの対象に追加＋KR/月/四半期切替のガード（必須・v3.100・2026-08-26）

Section 46（v3.89）・47（v3.90）で作った未保存編集レジストリ／`guardedNavigate`の仕組みは、`TaskEditModal`/`TaskSidePanel`と、`MainLayout.tsx`が起こす画面遷移（viewMode/appMode/部署/ラボ/管理画面/ガイド）だけを対象にしていた。**個人OKRビュー（`PersonalKrPanel.tsx`の「今月の計画」欄・`MonthReviewBlock.tsx`の「振り返り」欄）はこの仕組みの対象外**であることがv3.99実装時に判明し、既知の穴として記録されていた（Section 24 Step P参照）。

### 実害が出やすくなった経緯

- v3.96で過去月が編集可になった（従来は当月のみ＝編集機会が限られていた）。
- v3.99でAIが生成した計画ドラフトを4欄へ一括で流し込めるようになった（＝一度に大量の未保存テキストが載る）。

「下書きを生成→計画欄に反映→保存を押す前にKR／月／ビューを切り替える→無言で消える」という、v3.89／v3.90が塞いだのと同種の事故が起きやすい状態になっていた。

### Step 0で確認した現状（実装前）

- `unsavedEditorRegistry.ts`の登録APIは`registerUnsavedEditor(id, getter)`/`unregisterUnsavedEditor(id)`のpull型（`useId()`で払い出したidをマウント時に登録・アンマウント時に解除）。`TaskEditModal.tsx`/`TaskSidePanel.tsx`は`isDirtyRef`をレンダーごとに更新し、effectはidが変わらない限り再実行しない、という既存作法を踏襲した。
- `MainLayout.tsx`の`guardedNavigate`は`viewMode`/`appMode`/部署/ラボ/管理画面/ガイドの切替のみを対象にしており、`PersonalOkrView.tsx`のKR切替（`setSelectedKrId`）・月切替（`setMonthIndex`）・四半期切替（`setQuarter`）は**MainLayoutを経由しない内部状態の変更のため未ガードだった**（実際に確認：guardedNavigateの呼び出しはMainLayout.tsx内のみで、PersonalOkrView.tsxからの参照はゼロ）。KR切替・月切替はv3.55で`key={selectedKr.id}`を外した設計（KR切替時にPersonalKrPanelが再マウントされず中身だけ差し替わる）のため、切替前に未保存確認を挟まない限り無警告で消える。
- `guardedNavigateCoverage.test.ts`（v3.90）はMainLayoutInner専用のソース走査（`setViewMode(`等の全出現がguardedNavigate内にあるか）で、他ファイルは対象外だった。

### 対応

1. **`src/lib/personalOkr/monthPlanForm.ts`（新規）**：「今月の計画」欄（positioning/activities/target_and_evidence/risks/band_target）のdirty判定を純粋関数`computeMonthPlanDirty()`に切り出した（`monthReviewForm.ts`と同じ設計方針）。**この関数が計画欄のdirty判定の唯一の実装**（保存ハンドラ`handleSaveMonthPlan`が組み立てるpatchと同じフィールドを比較する）。
2. **`PersonalKrPanel.tsx`**：`computeMonthPlanDirty()`の結果を`useId()`で払い出したidで`registerUnsavedEditor`/`unregisterUnsavedEditor`に登録する（`TaskEditModal.tsx`と同じ`isDirtyRef`パターン）。KR・月を切り替えると既存のuseEffectがpositioning等をmonthRecordへ同期し直すため、切替後は自然にdirty=falseへ戻る（切替前にガードが確認を挟む前提）。
3. **`MonthReviewBlock.tsx`**：既存の`computeMonthReviewDirty()`（v3.96で保存ボタンの活性判定に既に使われている`dirty`変数）を**そのまま**registryのgetterに渡す。新しい判定ロジックを書き直していない。
4. **`PersonalOkrView.tsx`**：MainLayoutの`guardedNavigate`と同じ考え方の`guardedSwitch(action)`（このコンポーネント専用の薄い関数。入れ子呼び出しが無いため`navigationConfirmedRef`のような再入防止は持たない）を新設し、以下3箇所を包んだ：
   - KRタブのクリック（`setSelectedKrId(kr.id)`）
   - 新規作成・編集後にPersonalKrFormModalの保存完了で行われる自動選択（`onSave`コールバック内の`setSelectedKrId(kr.id)`）
   - 月セレクト（`setMonthIndex(...)`）・四半期セレクト（`setQuarter(...)`）
   
   四半期・年の切替でKR一覧全体が変わり選択中KRが自動補正される（既存のuseEffect）ため、四半期の切替もガード対象に含めた。**年（fiscalYear）の入力欄は対象外**：1文字入力ごとにonChangeが発火する自由入力のため、キー入力のたびに確認ダイアログを出すのは現実的でない（実際に年を変えて別の期のKRへ切り替える操作は稀という判断）。KR一覧の自動補正useEffect自体（`setSelectedKrId(displayKrs[0].id)`等）・削除後の選択解除（`setSelectedKrId(null)`）はガード対象外（前者は既にガードされた操作の派生的な状態同期でuseEffect内では確認を待てない、後者はKR自体を削除する破壊的操作でTaskEditModal/TaskSidePanelの削除と同じ扱い）。
5. **`guardedNavigateCoverage.test.ts`を複数ファイル対応に一般化**：従来はMainLayout.tsx専用のハードコードだったソース走査ロジックを`TARGETS: CoverageTarget[]`の設定配列に切り出し、`PersonalOkrView.tsx`（ガード関数名`guardedSwitch`・対象パターンは`setSelectedKrId(kr.id)`/`setMonthIndex(Number(v) as 1 | 2 | 3)`/`setQuarter(v as Quarter)`という具体的な呼び出し文字列）を2つ目のターゲットとして追加した。関数名ではなく「呼び出し＋実引数」の具体的な文字列をパターンにしている理由：`setSelectedKrId`等は自動補正useEffectからも呼ばれるため、関数名だけで数えると意図的に未ガードのままにしている呼び出しまで巻き込んでしまう（既存のMainLayout側`setIsAdminOpen(true)`と同じ「具体的な引数まで含めた文字列」の流儀）。

### 文言・安全側デフォルト

新しい文言は追加していない。既存の`confirmDiscardUnsavedEdits()`（Section 46）の文言・安全側デフォルト（`ConfirmModal`の背景クリック＝cancel＝「編集に戻る」＝切り替えない）をそのまま使う。

### テスト

- `src/lib/personalOkr/__tests__/monthPlanForm.test.ts`（8件）：`computeMonthPlanDirty()`の各フィールド・null/undefined正規化。
- `src/components/okr/personal/__tests__/personalOkrRegistryWiring.test.ts`（4件・新規）：`PersonalKrPanel.tsx`/`MonthReviewBlock.tsx`が実際に`registerUnsavedEditor`/`unregisterUnsavedEditor`を呼んでいること、判定ロジックを二重化していないことをソース走査で固定する。**修正前（v3.99時点）のソースに対して実行し、3件が実際に赤くなることを確認済み**（`registerUnsavedEditor`のimport・呼び出しが1つも無いため）。
- `src/components/okr/personal/__tests__/personalOkrUnsavedEditors.test.ts`（5件・新規）：`unsavedEditorRegistry`に計画欄・振り返り欄相当のgetterを登録し、`hasUnsavedEditors()`の集計（片方dirty／両方dirty／両方クリーン／解除後）を検証する。
- `src/components/layout/__tests__/guardedNavigateCoverage.test.ts`（一般化・11件）：**修正前（PersonalOkrView.tsxに`guardedSwitch`が存在しない状態）に対して実行し、4件が実際に赤くなることを確認済み**（`guardedSwitch(`の呼び出し自体が0件・3つのリスクパターンがいずれも未ガード）。

### やらないこと

- 「今月の計画」欄の保存ボタンをdirty状態で活性/非活性にする改修（v3.93のMonthReviewBlockと同様のUI改善）は、今回の依頼（無言で消える経路を塞ぐこと）のスコープ外のため行っていない。`computeMonthPlanDirty()`はレジストリ登録のためだけに使用している。
- ラボ系ビュー（グラフ/カレンダー/マイページ/体制図）や設定画面等、Section 47で既にguardedNavigate対象に含まれている遷移は変更していない。

---
