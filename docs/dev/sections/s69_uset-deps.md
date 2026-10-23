## 69. 🔴 グランドルール：翻訳関数（useT の戻り値）を取得の effect・callback の依存に入れない（必須・v3.135・2026-10-02）

### 何が起きたか

v3.133 のベルで、一覧の取得関数（useCallback）の依存に `t` を入れ、「パネルを開いたら取得」の effect がその関数を依存に持っていた。
当時の `useT` は描画ごとに別の関数を返していたため、取得完了の setState → 再描画 → 新しい `t` → effect の再実行（一覧を空にして取得をもう1本）→ …
と止まらなくなり、ブラウザが打ち切った取得が「Failed to fetch」として点滅した。同じ型は v3.129 から `AdminMessageDialog`（開いている間取得し続ける）と
`App.tsx` の招待URLの確認（描画のたびに確認ダイアログを出し直しうる）にもあった。

### グランドルール

1. **`useT` は `useCallback(…, [lang])` で、言語を切り替えたときだけ別の関数になる。** 戻す・書き換えるときは `src/hooks/__tests__/useT.test.ts` を通すこと。
2. **`useEffect`／`useLayoutEffect`／`useCallback` の依存配列に `useT()` の戻り値を入れない。** 文言が要るときは `const tRef = useRef(t); tRef.current = t;` として `tRef.current(...)` で読む。
   `useMemo`（表示用の値の組み立て）は言語切替で作り直す必要があるので対象外。
   `src/components/__tests__/translatorDeps.test.ts` が構文木で検査する（コメントは構文木に入らないので Section 59 の無力化は起きない）。
3. **取得を伴う effect は「開いたとき（false→true）・対象（タブ・ID）が変わったとき」だけ走らせる。** 取得は世代番号で古い応答を捨て、
   同じ対象の取得が走っている間は重ねない（ベルは終わってから1回だけ取り直す）。`src/components/notifications/__tests__/bellFetchLoop.test.ts` が
   実際に描画して取得の回数を数える（テスト用の最小 DOM は `src/__tests__/miniDom.ts`。依存ライブラリは足していない）。

---
