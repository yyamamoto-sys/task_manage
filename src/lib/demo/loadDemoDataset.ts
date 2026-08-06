// src/lib/demo/loadDemoDataset.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）モードの唯一の入口。App.tsx から静的importされるが、この
// ファイル自体はデータを一切持たない薄いラッパーのため、通常利用者のバンドルに
// サンプルデータ本体が混ざることはない。
//
// データ本体（./dataset.ts）と、ゲスト自身の担当付け替え（./guestPersona.ts）は
// どちらも動的 import() で読み込む（CLAUDE.md Section 19：ダウンロード量の最小化。
// 「サンプルを見る」を押した人だけがこの2ファイルをダウンロードする）。

import type { DemoDataset } from "./types";

export async function loadDemoDataset(): Promise<DemoDataset> {
  const [{ buildDemoDataset }, { applyGuestPersona }] = await Promise.all([
    import("./dataset"),
    import("./guestPersona"),
  ]);
  return applyGuestPersona(buildDemoDataset());
}
