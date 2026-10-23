## 59. 🔴 グランドルール：ソース走査型の機械チェックは「コメントに書いた文字列」で無力化される（必須・v3.114・2026-09-18）

### 何が起きたか

`ListToolbar.tsx`（v3.114で新設）の冒頭に、設計意図コメントとして
`` Portal する要素には `pointerEvents:"auto"` を明示する（Section 51） `` と書いた。

`src/components/common/__tests__/floatingPanelContract.test.ts` は、`createPortal` と
`document.body` を含む `.tsx` を**ソース文字列として走査**し、`/pointerEvents:\s*"auto"/`
にマッチするかを見る。**コメント行もソース文字列**なので、このコメントだけでマッチが成立し、
**実コードから `pointerEvents: "auto"` を削除してもテストは緑のまま**だった。

実装者が「意図的に壊して赤くなるか」を確認したことで発覚した。コメントを言い換えて修正し、
再度わざと壊して赤くなること／戻すと緑になることを確認済み。

### なぜ危険か

この検査は Section 51 の業務停止級の不具合（担当者ドロップダウンがクリックもホイールも
受け取らない）の再発防止そのものである。**検査が緑であることを根拠に「守られている」と
判断する運用**なので、無力化に気づけないと再発防止の本体が失われる。

しかも**無力化する側に悪意も不注意も要らない**。「ルールを守ったことをコメントで説明する」
という良い習慣がそのまま検査を殺す。Section 22（マイグレ追加時は検査項目も1行足す）と同じで、
検査そのものの健全性は誰も検査していなかった。

### グランドルール

1. **ソース走査型の機械チェックを新設・変更したとき、および走査対象のファイルを新設したときは、
   必ず「意図的に壊して赤くなること」「戻すと緑になること」を1回確認すること。**
   `feedback_regression_test_must_fail_before_fix`（再発防止テストは修正前のコードで落ちることを
   確認させる）と同じ原則を、走査型テストにも適用する。**緑であることは何の根拠にもならない。**
2. **走査型の検査が探すパターンそのものを、コメント・文字列リテラル・テストの説明文に書かないこと。**
   書く必要があるときは言い換える（例：`pointerEvents` を「ポインタイベントの明示」と書く）。
3. **新しい走査型テストを書くときは、可能なら行頭の `//` `/*` `*` で始まる行を除外してから
   マッチさせること。** 既存テストを一斉に書き換える必要はないが、新設するものはこの形にする。

### 同型の落とし穴がある既存テスト（2026-09-18時点の棚卸し）

いずれも「ソースを読んで文字列/正規表現で検査する」方式であり、同じ手口で無力化されうる。
**該当ファイルにコメントを書くときは、検査が探す語をそのまま書かないこと。**

- `src/components/common/__tests__/floatingPanelContract.test.ts`（今回の発生元）
- `src/components/common/__tests__/modalStyles.test.ts`
- `src/components/common/__tests__/modalKeyframeTransform.test.ts`
- `src/components/__tests__/adminActionBoundary.test.ts`
- `src/components/__tests__/labViewChokePoint.test.ts`
- `src/components/__tests__/labViewContainment.test.ts`
- `src/components/__tests__/memberInGroupUsage.test.ts`
- `src/lib/__tests__/changelogVersion.test.ts` / `version.test.ts` / `computeFormDirtyFieldCoverage.test.ts`

---
