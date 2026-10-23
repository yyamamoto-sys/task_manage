## 42. グランドルール：トリガー追従のポップオーバー（ドロップダウン・候補パネル）は画面外へのはみ出しをクランプする（必須・v3.85）

Section 21（中央寄せモーダル）とは別系統の不具合。`getBoundingClientRect()` → `position:"fixed"`
座標算出 → `createPortal(document.body)` という手法自体はSection 21対象外の正しい設計（`CustomSelect.tsx`
のコメント・`ProjectRowMenu.tsx`のコメント参照）だが、**画面外へのはみ出しクランプ・反転が無いと、
可視範囲の下端に近い場所でパネルを開いた瞬間、`position:"fixed"`のため下側が画面外に切れ、
スクロールしても絶対に到達できなくなる**（下方向は`overflow:"auto"`という保険が効くSection 21の
モーダルと異なり、これらのポップオーバーは背景側のスクロールという概念自体が無い）。

**2026-08-20に発生した実際の不具合（3件・横断監査で確定）**：
- `CustomSelect.tsx`（担当者・PJ・TF選択等で最頻出）：`calcPanelStyle`が`window.innerWidth`/
  `innerHeight`との比較を1つも持たず、はみ出しクランプが皆無だった。
- `InlineEditAssignee.tsx`（一覧・カンバン・ガント・ダッシュボードの担当者ドロップダウン）：
  そもそも`position:"absolute"`＋祖先の`overflow:"auto"`スクロール容器の内側にあり、可視範囲の
  下端から候補リストの高さ未満しか余白が無い行で開くと候補の下側がクリップされて選べなかった。
- `MentionTextarea.tsx`（コメント・メモ欄の`@`メンション候補）：`CustomSelect.tsx`と同型でクランプ皆無。

**対策**：`src/components/project/ProjectRowMenu.tsx`（サイドバーPJ行の「⋮」メニュー）が既に持って
いた「トリガーの`getBoundingClientRect()`→左右端クランプ→下に入らなければ上へ反転」という完成
済みの実装を、共通ユーティリティ`computeFloatingPanelPosition()`（`src/lib/layout/
floatingPanelPosition.ts`）に切り出した。`align:"left"`（パネル左端をトリガー左端に揃える。
`CustomSelect.tsx`／`MentionTextarea.tsx`／`InlineEditAssignee.tsx`向け）と`align:"right"`
（パネル右端をトリガー右端に揃える。`ProjectRowMenu.tsx`向け）の2方式を持つ。高さは実測不要で
呼び出し側が既知の`maxHeight`や行数から見積もる（`ProjectRowMenu.tsx`の既存方式を踏襲）。

- `InlineEditAssignee.tsx`は`position:"absolute"`から`createPortal(document.body)`＋
  `position:"fixed"`へ構造ごと変更した（`ProjectRowMenu.tsx`と同じ「外側クリック判定は
  トリガー・パネル両方のrefを個別に見る／Escapeで閉じる／スクロール・リサイズで閉じる」の
  一式も揃えた）。パネル幅が内容依存（メンバー名・アバターで可変）のため、クランプ計算は
  見積もり幅（220px）を使う（実際の描画幅がこれより大きい場合はクランプ精度が幾分下がるが、
  クランプが皆無だった旧実装からの改善であることに変わりはない）。
- `CustomSelect.tsx`／`MentionTextarea.tsx`は既存の`position:"fixed"`＋`createPortal`構造は
  変えず、座標計算だけを共通関数に置き換えた。

**重複コピペが今回の再発の温床だったため、共通ユーティリティへの集約自体が再発防止の本体**
（4箇所がそれぞれ似て非なるクランプ実装を持つと、次に同じ穴が1箇所だけ塞がれ他が残る、という
ことが起きる）。

### 併せて対応：`transform`祖先が`position:fixed`要素のcontaining blockをすり替える問題

`src/components/guide/GuideOverlay.tsx`（「？」ボタンから開くガイド表示。`ConsultationPanel.tsx`
のヘッダー等から`HelpButton.tsx`経由で呼ばれる）は`createPortal`を使わず`position:"fixed";
inset:0`のdivを直接描画していた。`ConsultationPanel.tsx`の非inline（モバイル）時のパネルは
`transform: isOpen ? "translateX(0)" : "translateX(100%)"`を持つため、CSSの仕様上この`transform`
がcontaining blockをすり替え、内側の`GuideOverlay`の`position:"fixed"`が「ビューポート基準」では
なく「`ConsultationPanel`のパネル基準」になってしまう（2026-08-20の横断監査で発覚。実際の視覚的な
破綻は未検証だが、原因はCSS仕様上確実なため先んじて塞いだ）。対策として`GuideOverlay.tsx`本体・
そのチャンク読込中フォールバック（`HelpButton.tsx`内の`GuideOverlayLoading`）の両方を
`createPortal(document.body)`に変更した（呼び出し先は本ファイル自身と`AdminView.tsx`（直接呼び出し）・
`HelpButton.tsx`（lazy）の2箇所のみであることを確認済み）。

### 機械チェック・テスト

`src/lib/layout/__tests__/floatingPanelPosition.test.ts`が`computeFloatingPanelPosition()`の
クランプ・反転ロジックを固定する（左右端クランプ・上下反転・`align`両方・`margin`カスタマイズ・
パネルがビューポートより広い極端なケース）。`align:"right"`のテストケースは`ProjectRowMenu.tsx`の
旧実装（切り出し前）と同じ入力で同じ出力になることを確認し、切り出しで挙動が変わっていないことを
担保した。

### 対象外（低優先度・見送り）

`QuickAddTaskModal.tsx`のToDoホバーツールチップ・`MainLayout.tsx`の`NavItem`ツールチップは、どちらも
`pointerEvents:"none"`（クリックできない純粋な表示専用）のため実害は見た目のみ。2026-08-20の横断
監査で見つかったクランプ漏れ（前者は反転後の左端クランプ漏れ、後者は左右クランプ自体が無い）は
どちらも軽微な一行修正のため今回あわせて直した（`Math.max(8, ...)`／`Math.min(...)`によるクランプ。
NavItemの見積もり幅は`NAV_TOOLTIP_WIDTH_ESTIMATE`/`NAV_TOOLTIP_EXPANDED_WIDTH`定数）。専用のテストは
追加していない（`pointerEvents:"none"`の装飾要素であり、Section 21・本Sectionの「操作不能」という
実害の定義には該当しないため）。

---
