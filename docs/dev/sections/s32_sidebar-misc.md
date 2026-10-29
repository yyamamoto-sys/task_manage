## 32. サイドバー下部「その他」（ガイド／設定／招待コードを入力）の折りたたみ（v3.74・2026-08-17）

山本さんの依頼：「📖 ガイド」「⚙ 設定」「🎫 招待コードを入力」の3ボタンが縦に並んでサイドバーの面積を占領しているため、折りたたみ式にして必要なときだけ展開したい（見せたいのは「メニュー」と「プロジェクト」）。

- **既存の確立済みパターンをそのまま踏襲**：`Sidebar`コンポーネント（`MainLayout.tsx`）の`pjOpen`/`togglePjOpen`（`KEYS.SIDEBAR_PJ_OPEN`）と同じ形で`miscOpen`/`toggleMiscOpen`（`KEYS.SIDEBAR_MISC_OPEN`）を新設した。**向きが逆**：`SIDEBAR_PJ_OPEN`は既定ON（`!== "0"`）だが、`SIDEBAR_MISC_OPEN`は既定OFF（起動時は折りたたみ。`=== "1"`のときだけ開く）。
- **見出し行**：折りたたみ時は`▸ その他`の1行のみ（クリックで`▾ その他`に変わり展開）。スタイルは「プロジェクト」セクション見出し（`togglePjOpen`のボタン）と同じトークン（font-size 10px・font-weight 600・letter-spacing 0.05em・color `var(--color-text-tertiary)`・text-transform uppercase・矢印`▶`の回転アニメ）を流用した（新しい見た目は作っていない）。
- **項目数が2件以上のときだけ見出し＋折りたたみにする**：「設定」「招待コードを入力」は`!isGuest`条件付きのため、ゲストは「ガイド」1つだけになる。1件以下のときに見出しで包むと、見出し行が増える分だけかえって縦の占有面積が増えて逆効果になるため、判定を`src/lib/layout/sidebarMiscSection.ts`の`shouldGroupSidebarMiscButtons(visibleItemCount)`（純粋関数・`visibleItemCount >= 2`）に切り出した（テストは`__tests__/sidebarMiscSection.test.ts`）。JSX側は`showMiscGroup = !c && shouldGroupSidebarMiscButtons(miscItemCount)`の1箇所で判定し、条件式を散らさない。
- **サイドバー自体が折りたたまれている（`c === true`・幅48px）ときは見出しを出さない**：`showMiscGroup`が`!c`を含むため自動的にfalseになり、従来どおり3つのアイコンボタンをそのまま並べる（アイコン1個ぶんの高さしか無くそもそも面積を圧迫していないため。ここで見出しを足すと逆に1行増える）。
- **既存の3ボタンの`onClick`／`title`／`data-tour-id`は無改修**。位置が見出しの内側に入れ子になるだけ。
- **初回ツアーの`guide-btn`参照が壊れる問題への対応**：`first-time.ts`の「guide」ステップ（`target: "guide-btn"`・`skipIfMissing: true`）は、「その他」が折りたたまれているとDOM上に存在せず黙って飛ばされてしまう。対応は**(a) ツアー開始時に自動的に「その他」を開く**を採用した。具体的には、同ツアーの最初のステップ（`id: "welcome"`。ターゲット無し＝毎回必ず表示される）に`action: "open-sidebar-misc"`を追加し、`Sidebar`コンポーネント側で`"tour:action"`イベント（既存の`demo-ai-consult`/`open-dashboard-pj-analysis`と同じ配線方式。`TourProvider.tsx`が`window.dispatchEvent`する）をリッスンして`setMiscOpen(true)`する。**localStorageは書き換えない**（一時的な展開に留め、ユーザーが選んだ既定の開閉状態を変えない）。
  - **タイミングの注意**：`TourProvider.tsx`はステップ変更時に「ターゲット測位（`skipIfMissing`判定を含む）」と「action発火」を同じ`activeStep`変更に対する別々の`useEffect`で行う。もし`action`を「guide」ステップ自身に付けても、ターゲット測位の効果（宣言順で先）がその場でターゲット不在と判定し即座に次のステップへ進めてしまい、action発火（宣言順で後）が「その他」を開いた頃には既に手遅れ（該当ステップの表示自体がスキップ済み）になる。そのため**「guide」より前のステップ（このツアーでは冒頭の`welcome`）でアクションを発火させ、猶予（`guide`到達までの間の複数ステップ分）を確保する**設計にした。
  - `okr-intro.ts`（OKRモードのツアー）は`guide-btn`を参照していないため対象外（確認済み）。
- **DBスキーマ変更なし**（`schemaChecks.ts`への追記も不要）。

---

## v3.193（2026-10-29）：外側クリック・Esc で閉じる／開閉を保存しない

- 利用者から「⋯を開いたままで表示されっぱなしになり、サイドバーが圧迫される」との報告。
- `miscOpen`（⋯）と `labOpen`（🧪）は、開いている間、**項目群とそのトグルボタンの外側**の pointerdown、または Esc で閉じる（`src/hooks/useOutsideDismiss.ts`・判定の純関数は `src/lib/layout/outsideDismiss.ts`）。項目をクリックしたときも、その動作のあとで閉じる（テーマ切替も）。
- `miscOpen` は保存しない（起動時は閉）。`KEYS.SIDEBAR_MISC_OPEN` の読み書きを撤去。キー定義は、過去の保存値の識別と表示設定リセット（`displaySettingsReset`）での削除用に残す。古い値が残っていても読まないので無害。
- ツアー実行中（`useTour().isRunning`）は外側クリック・Esc・項目クリックのいずれでも閉じない。ツアーの `open-sidebar-misc` で開いた場合も同じ。ツアー終了後は通常どおり。
- サイドバー折りたたみ時（`showMiscGroup=false`＝アイコン常時表示）は項目クリックでも閉じない（従来どおり）。モバイルは Sidebar を使わず、専用のラボシートが外側タップで閉じる既存の作りのため対象外。
- テスト：`src/lib/layout/__tests__/outsideDismiss.test.ts`（純関数・配線の走査）。DB変更なし。

