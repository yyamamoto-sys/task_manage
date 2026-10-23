## 86. 縮小表示時のフォント切替（v3.164・2026-10-19）

- 症状：Chrome でブラウザの拡大率を下げると、文字がギザギザに見えるという報告が複数の利用者から出た。
- 原因（推定。実機未確認）：本文の M PLUS Rounded 1c はヒンティングが乏しく、実寸が 8〜9px まで縮むと輪郭が崩れる。Meiryo UI / Yu Gothic UI はヒンティングがある。
- 対策：globals.css に `@media (max-resolution: 0.99dppx)` を追加し、`:root` の `--font-sans` をOS標準フォント（Meiryo UI 等）へ差し替える。`--font-display` は変えない。
- Chrome ではブラウザのズームで devicePixelRatio が変わるため、この resolution メディアクエリもズームに連動して切り替わる。
- 100% 以上の表示と高DPI（dppx ≥ 1）は不変。
- これで直らなければフォントとは別原因として再調査する。
