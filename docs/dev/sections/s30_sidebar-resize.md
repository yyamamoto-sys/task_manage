## 30. サイドバーの境界をドラッグで幅変更（v3.66・2026-08-12）

山本さんの依頼「サイドメニューとメインエリアの境界をドラッグで移動できるようにしてください」への対応。

- **範囲は140px〜420px**（v3.115で下限160→140・既定196→160に変更。160pxは「プロジェクト見出し＋＋＋自分/全件」の行が1行に収まる下限の見積もり）（`src/lib/layout/sidebarWidth.ts` の `SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH`。根拠はファイル内コメント参照：最小はナビ項目のラベル文字が折り返さず収まる下限、最大はメインエリアが極端に狭くならない上限）。既定幅は`SIDEBAR_DEFAULT_WIDTH`（160px。v3.114までは196px。旧`SIDEBAR_WIDTH_EXPANDED`定数の値を継承）。
- **localStorageに記憶**：`KEYS.SIDEBAR_WIDTH`（`src/lib/localData/localStore.ts`）。折りたたみ時の48pxとは別に「展開時の幅」だけを記憶するため、折りたたみ→展開で必ず記憶した幅に戻る（折りたたみ中は`isSidebarCollapsed`で48px固定表示になるだけで、`sidebarWidth`のstate自体は変わらない）。
- **ダブルクリックで既定幅（160px）に復帰**。
- **折りたたみ中（48px）はドラッグ不可**：ハンドル自体を`!collapsed`のときだけ描画する（`MainLayout.tsx`の`Sidebar`コンポーネント内）。
- **キーボード操作**：ハンドルに`role="separator"` `aria-orientation="vertical"` `aria-label` `aria-valuemin/max/now`を付与し、`tabIndex={0}`でフォーカス可能にする。左右矢印キーで`SIDEBAR_WIDTH_KEY_STEP`（12px）ずつ変更する。jsx-a11yの既定ルールは`role="separator"`を「非インタラクティブロール」として扱うため`no-noninteractive-element-interactions`/`no-noninteractive-tabindex`の警告が出るが、ARIAの仕様上separator（window-splitter相当）はfocusable＋キー操作可能にしてよいため、理由コメント付きで`eslint-disable-next-line`している。
- **純粋関数への切り出し**：`src/lib/layout/sidebarWidth.ts`の`clampSidebarWidth(width)`（最小・最大への丸め。NaN/Infinityは既定幅にフォールバック）と`parseStoredSidebarWidth(raw)`（localStorageの生文字列を検証・復元。null・空文字列・数値変換不能な文字列は既定幅、範囲外の数値は範囲内にクランプ）。テストは`__tests__/sidebarWidth.test.ts`。
- 🔴 **v3.115でサイドバー側のみ pointer capture 方式（`setPointerCapture`・`pointercancel`での後片付け・`touch-action:none`）へ変更し、境界に2pxの帯（ホバー・フォーカス・ドラッグ中に光る）を追加した。以下の「mousemove流儀」の記述はAIパネル側の実装として読むこと。**
- **ドラッグの実装はConsultationPanel.tsx / PersonalOkrAiPanel.tsxの「左端ドラッグでリサイズ」と同じ流儀**（`position:absolute`の細い帯・`window`の`mousemove`/`mouseup`・refで最新値を保持し`mouseup`時にlocalStorageへ確定保存・ドラッグ中は`document.body.style.cursor`/`userSelect`を変更してテキスト選択を防ぐ）だが、**共通化はしていない**（判断理由）：
  1. 既存2箇所はキーボード操作に対応していない（マウス専用・`no-static-element-interactions`をdisableして済ませている）。サイドバーは要件上キーボード対応が必須で、実装が構造的に異なる。
  2. ドラッグの方向が逆（AIパネルは左端を掴んで左に伸ばすと幅が増える＝画面右側に固定された パネル。サイドバーは右端を掴んで右に伸ばすと幅が増える＝画面左側に固定されたパネル）。
  3. 既存2箇所は安定稼働中でテスト済みのため、今回のスコープ外の理由で触ってリグレッションを増やすリスクを取らない判断をした。
  重複しているのは「mousemove/mouseup配線・クランプ・localStorage確定保存」という短い手続きのみで、共通化してもコード量の削減効果は小さい。将来3箇所目の要件が増えたときに改めてhook化を検討する。
- **既存の全画面ラボビュー（Section 20）・ガント（Section 3-6 B2）との整合**：サイドバー幅は`var(--app-sidebar-w)`のようなCSS変数配布ではなく通常のflexboxレイアウト（Sidebarとメインエリアが`display:flex`の兄弟要素）で決まるため、サイドバー幅が変わるとメインエリアは自動的に追従する（Section 20のcontainmentテストが検査する「CSS変数配布方式に戻っていないこと」は今回も保たれている）。ガントのタスクバーは`ganttBodyRef`を`ResizeObserver`で監視し要素サイズが変わるたびに`remeasureDeps()`（依存関係の矢印・バッジの再計算）を呼ぶ設計になっており、サイドバーの幅変更（＝ガントのコンテナ幅の変化）でも自動的に再測定される。ドラッグ中の連続的な幅変更でも同じ経路で追従する（コード読解により確認。ブラウザでの実機確認は山本さんに依頼）。

---
