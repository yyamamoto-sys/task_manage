// src/components/okr/personal/__tests__/personalOkrViewLayout.test.ts
//
// 【設計意図】
// 2026-08-12・実機で発生した不具合の再発防止テスト：PersonalOkrView.tsx の「対象期」行と
// 「KRタブ」の帯は、選択中KRの中身（PersonalKrPanel）が縦に長いとフレックスコンテナの中で
// 高さ0まで潰れて消えることがあった（overflowXを持つフレックスアイテムは、明示的な
// flexShrinkが無いと自動最小サイズが0になり、squeeze時に真っ先に潰れるCSSの規則。
// CLAUDE.md Section 21が本文にminHeight:0を要求するのと対になる規則）。
//
// 【広い静的検査を見送った理由】
// modalStyles.test.ts / labViewChokePoint.test.ts と同じ「ソース走査」方式を、
// 「overflowX/overflowYを持つ要素は必ずflexShrinkを持つべき」という一般ルールとして
// src/全体に適用することは見送った。このアプリのメインのスクロールコンテナ群
// （例：本ファイルのすぐ外側にある`overflow:"auto", flex:1`のコンテナ自体）は、
// 意図的に「利用可能な残り領域に合わせて伸縮する」ことを目的にoverflowを持っており、
// flexShrinkを禁止すると設計そのものと矛盾する。今回のバグは「伸縮していい領域」と
// 「常に全体が見えているべき固定の帯（タブ・ヘッダー）」の取り違えという設計判断の誤りで
// あり、機械的な一般ルールで安全に検出できないため、実際に事故が起きたこの2箇所を
// 具体的にピン止めする狭いテストにする。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(__dirname, "../PersonalOkrView.tsx");
const content = fs.readFileSync(SOURCE_PATH, "utf-8");

describe("PersonalOkrView：対象期行・KRタブの帯はflexShrink:0で潰れないよう固定する", () => {
  it("「対象期」行のstyleにflexShrink:0がある", () => {
    // 🔴 v3.70でdata-tour-id属性（OKRツアーのターゲット）を追加したため、
    // `<div ... style={{` の間に任意の属性が挟まっていてもマッチするようにしてある。
    const periodRowMatch = content.match(/\{\/\* 期の選択 \*\/\}[\s\S]{0,600}?<div(?:\s+[\w-]+=(?:"[^"]*"|\{[^}]*\}))*\s+style=\{\{([\s\S]*?)\}\}>/);
    expect(periodRowMatch, "「期の選択」コメントの直後のdivが見つからない（構造が変わった場合はこのテストの正規表現も更新すること）").not.toBeNull();
    expect(periodRowMatch![1]).toMatch(/flexShrink:\s*0/);
  });

  it("「KRタブ」の帯のstyleにflexShrink:0がある（overflowX:autoを持つため必須）", () => {
    const tabRowMatch = content.match(/\{\/\* KRタブ \*\/\}[\s\S]{0,900}?<div(?:\s+[\w-]+=(?:"[^"]*"|\{[^}]*\}))*\s+style=\{\{([\s\S]*?)\}\}>/);
    expect(tabRowMatch, "「KRタブ」コメントの直後のdivが見つからない（構造が変わった場合はこのテストの正規表現も更新すること）").not.toBeNull();
    const style = tabRowMatch![1];
    expect(style).toMatch(/overflowX:\s*"auto"/);
    expect(style).toMatch(/flexShrink:\s*0/);
  });
});
