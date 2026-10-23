## 84. ガイドツアー：クリックで開いたUIに吹き出しが隠れて続行不能になる不具合（v3.161・2026-10-15）

- **症状**：お知らせツアー feedback-intro の「ベルを押してください」でベルを押すと、開いた通知パネルの下に吹き出しが隠れ、「次へ／やめる」が押せなかった（スクリーンショットで確認。吹き出しの左端だけがパネルからはみ出して見えた）。
- **原因**：`TourOverlay`（暗幕・枠線・吹き出し）が `#root`（`isolation:isolate`＝独立した重なりの文脈）の内側に描かれていた。ベルのパネル等は `createPortal(document.body)`（`useFloatingPanel` の z=9999）で `#root` の外に出るため、吹き出しが z=10000 でも**文脈ごと負けて**常に下になる。z-index の数値を上げても直らない。
- **修正**：`TourProvider` が `TourOverlay` を `document.body` へ Portal（`pointerEvents:"auto"` を明示＝Section 51）。重なり順は `tour/tourLayout.ts` の `TOUR_Z`（暗幕 9990＜枠線 9991＜吹き出し 10000。ポップオーバー 9999 より吹き出しが上）。ステップ中は対象位置を250msごとに測り直し（`sameRect` で無駄な再描画を避ける）、対象が消えたら中央表示に戻す（操作ボタンが必ず画面内に残る）。Esc・✕・スキップは gated の段でも常に使える。
- **他のクリック指示ステップ**：feedback-intro 以外（first-time・okr-intro）は「次へ」で進む説明が中心で、本物の「押してください」（advanceOn）は feedback-intro の2〜3段目のみ。first-time の `ai-panel`・`pj-ai-analyze-btn` 等は `#root` 内の対象で、今回の Portal 化で重なり順の規約が全ツアーに揃う。
- 🔴 **新しいルール**：body 直下へ Portal される要素（ポップオーバー・モーダル）を足すときは、ツアーの吹き出し（`TOUR_Z.bubble`）より下の z-index にする。ツアーの UI を `#root` の中へ戻さない。
- テスト：`tour/__tests__/tourLayering.test.ts`（z-index の大小・Portal 先・測り直し・Esc／✕。jsdom では実際の重なりを判定できないため規約のソース走査＋純関数）。修正前の TourProvider に対して3件が赤になることを確認済み。
- MIN_CLIENT_VERSION は上げない。マイグレーションなし。

---
