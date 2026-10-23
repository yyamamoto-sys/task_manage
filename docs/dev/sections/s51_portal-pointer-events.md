## 51. グランドルール：`document.body`へのPortal要素は`pointerEvents:"auto"`を必ず明示する／トリガー追従のポップオーバーは`useFloatingPanel`に集約する（必須・v3.98・2026-08-26）

### クレーム（利用者の意見）

リストモードで担当者アイコンから担当者を変更しようとすると、ドロップダウンがスクロールできず、目的の人を選べない。

### 根本原因

`src/styles/globals.css`の`body { pointer-events: none }`（外周余白帯のクリックを`#root`へ通過させるための指定・Section本文中でも既出）は**継承プロパティ**であり、これを打ち消しているのは`#root`（`pointer-events: auto`）だけである。`createPortal(document.body)`で`#root`の外（body直下）に生えるパネルは、`pointerEvents:"auto"`を自分自身に明示しない限り、この継承を打ち消せず**ヒットテストの対象外**になる。

Section 42（v3.85）で`CustomSelect.tsx`／`ProjectRowMenu.tsx`／`MentionTextarea.tsx`の3つを`position:absolute`から`createPortal(document.body)`へ移した際、3つには`pointerEvents:"auto"`を付けていたが、**同時に移した`InlineEditAssignee.tsx`だけ付け忘れていた**（commit `aedb241`）。4箇所が同じ構造をそれぞれコピペで持っていたため、1箇所だけの付け忘れが13ヶ月近く気づかれずに残った。

症状の連鎖：パネルがヒットテストを素通り → ホイールが背後の`ListView.tsx`のスクロール容器に当たる → リストがスクロール → capture の scroll リスナが「パネル外のスクロール」と判定してパネルを閉じる（旧実装。後述） → パネルは一度もスクロールできないまま閉じる。ホバーのハイライトも効かない。

### 対応

1. **新規`src/hooks/useFloatingPanel.ts`に、4ファイル（`InlineEditAssignee.tsx`／`CustomSelect.tsx`／`ProjectRowMenu.tsx`／`MentionTextarea.tsx`）がそれぞれコピペで持っていた「座標計算・スクロール追従・スクロール連鎖の遮断・`pointerEvents`」を集約した。** `panelStyle`（`position:fixed`の座標＋`pointerEvents:"auto"`＋`maxHeight`）と`scrollAreaStyle`（`overflowY:"auto"`＋`overscrollBehavior:"contain"`）を返す。座標算出の純粋関数自体（`computeFloatingPanelPosition`）はSection 42のものを継続利用し、`src/lib/layout/floatingPanelPosition.ts`に新たな純粋関数2つを追加した：
   - `computeFloatingPanelCloseOnScroll()`：祖先スクロールでは閉じず、**トリガーが可視範囲から出たときだけ閉じる**（旧実装は「パネル外で起きたスクロールなら閉じる」だったため、目的の項目に手を伸ばしている最中に表本体が1px動いただけで閉じていた）。
   - `computeFloatingPanelMaxHeight()`：`maxHeight`のハードコード（200/220/260px）を廃止し、トリガー上下の実余白から算出する（v3.95「固定値の見積もりは実物とズレる」方針の延長）。担当者ドロップダウンの希望高さは200→340pxに拡大（部署メンバーが7人以上いると必ずスクロールが要った）。
2. **`overscrollBehavior:"contain"`をパネルのスクロール要素に付与**し、パネル内スクロールが端に達しても祖先へ連鎖しないようにした。
3. **副次修正**：`GuideOverlay.tsx`／`HelpButton.tsx`（`GuideOverlayLoading`）も同じ`pointerEvents`欠落を横断検査で検出し、1行追加した（`HelpButton`側は全画面スケルトンで背景クリックも効かない状態だった）。

### 機械チェック（新設）

- `src/components/common/__tests__/floatingPanelContract.test.ts`：①`createPortal`＋`document.body`を持つ全`.tsx`ファイルが`pointerEvents:"auto"`を明示していることをソース走査で検査する（対象外にするファイルは`POINTER_EVENTS_EXCLUDED`に理由付きで登録。現状`ConsultationPanel.tsx`のみ＝Portal直下が別コンポーネントでそちら側が`pointerEvents:auto`を持つため）。②トリガー追従の4ファイルが自前で`scroll`を購読していない（＝`useFloatingPanel`に集約されている）こと、`useFloatingPanel`を使っていること、`computeFloatingPanelPosition`を直接呼んでいないことを検査する。
- `src/lib/layout/__tests__/floatingPanelBehavior.test.ts`：`computeFloatingPanelCloseOnScroll()`・`computeFloatingPanelMaxHeight()`の判断を純粋関数として固定する（境界での点滅防止・上下反転・minHeight下限・実測再クランプ等、18件）。

### 再発防止：新しいグランドルール

1. **`createPortal(document.body)`で描画する要素は、`pointerEvents:"auto"`を必ず自分自身のstyleに明示すること。** `globals.css`の`body { pointer-events: none }`は継承プロパティであり、`#root`（`pointer-events: auto`）の外に出た要素はこれを打ち消さない限りクリック・ホバー・ホイールを一切受け取れない。
2. **トリガーに追従する小さいポップオーバー（ドロップダウン・候補パネル・メニュー）を新設・改修するときは、座標計算・スクロール追従・`maxHeight`の決め方を個別ファイルにコピペしないこと。** 必ず`src/hooks/useFloatingPanel.ts`を使う。今回の不具合は「4箇所が同じコードをコピペで持っていたため、1箇所だけの直し忘れ・付け忘れが長期間気づかれなかった」ことがそのまま原因であり、集約自体が再発防止の本体（Section 42と同じ教訓の再発）。

---
