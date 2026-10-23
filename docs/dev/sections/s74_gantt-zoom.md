## 74. ガントの拡大縮小：スライドバー（1日あたり8〜80px）・Ctrl/Cmd＋ホイール（v3.143・2026-10-14）

- **値の持ち方**：`GanttView` の `dayWidth`（整数・`ZOOM_MIN`=8〜`ZOOM_MAX`=80・既定 `DAY_WIDTH_DEFAULT`=28）。保存は従来どおり `KEYS.GANTT_ZOOM`（`displaySettingsReset.ts` の対象のまま）。復元は `parseSavedZoom`（範囲内の数値はそのまま＝旧5段階の値も有効・範囲外／非数値／未保存は28）。
- **計算は `ganttUtils.ts` の純関数に集約**：`clampDayWidth`・`stepZoom`（ボタンと +/- キー。×1.25／÷1.25・必ず1px以上動く）・`wheelZoomTarget`（ホイール1ノッチ=×1.25。小数で返す）・`computeZoomScrollLeft`（基準点の日付を動かさない scrollLeft）・`isDayTickLabelVisible`・`weekLabelForWidth`。旧 `clampZoom`・`ZOOM_LEVELS` は撤去（呼び出し元はない）。
- **再描画を抑える**：スライドバーとホイールは目標値を `zoomTargetRef` に溜め、`requestAnimationFrame` で1フレーム1回だけ `setDayWidth`（`scheduleZoom`）。**スライドバーは非制御（`defaultValue`＋`sliderRef` で外部変更に同期）**。制御 input にすると、rAF待ちの間につまみが元の位置へ戻ってガタつく。ホイールは小数の積算値から続ける（毎回整数から始めるとピンチの小さな delta が丸めで消える）。
- **基準点補正**：ホイール＝マウス位置、ボタン・スライドバー・キー＝表示領域の中央（`zoomAnchorXRef`）。`useLayoutEffect` で描画前に補正する（旧実装の `useEffect`＋整数日への丸めを置き換え）。
- **Ctrl/Cmd＋ホイール**：`scrollRef`（バー領域）に `addEventListener("wheel", …, {passive:false})`。ctrl/meta が無いホイールは素通し（通常のスクロール）。React の `onWheel` は passive なので使わない。プレビュー（`isPreview`）とモバイルでは登録しない。
- **狭い幅（8〜13px）**：日の目盛り数字は12px未満で月曜だけ（はみ出し可）、週ラベルは幅44px未満で「W2」・20px未満で空、バーの最小幅は6px（`calcTaskBar`）。バー上の日付文字は従来から幅52px超でのみ表示。
- **表示の単位は「px/日」**（％にしない）：設定ページの UI 拡大率（Section 49）の「％」と紛らわしいため。
- テスト：`ganttUtils.test.ts`（範囲・等比・保存値の復元・基準点補正・ホイール・間引き）。MIN_CLIENT_VERSION は上げない。マイグレーションなし。
- **レビュー指摘の修正（v3.144）**：縮小時にブラウザが scrollLeft を切り詰めて表示位置が跳ぶ問題は、切り詰め前の値を rAF 直前に控え `resolveZoomScrollLeft` で補正する。range 入力中もショートカット（＋／－）を有効にする。細いバーのつまみは `resizeHandleWidth`（2〜8px）。バーのドラッグ中は拡大縮小を無効にする。rAF 予約中はスライドバーの同期を飛ばす（つまみが戻るのを防ぐ）。ピンチ級の小さな delta は `wheelDeltaToPx` で ×5。

---
