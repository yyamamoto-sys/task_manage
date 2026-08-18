// src/components/__tests__/memberInGroupUsage.test.ts
//
// 【設計意図】v3.78 パートB③「memberInGroupの使用箇所」対応（CLAUDE.md Section 25
// Phase 4末尾「部署でスコープする画面を新設するたびに再発しうる構造」参照）。
//
// `memberInGroup()`（AdminView.tsx内のローカル関数。部署IDで絞り込む）は、招待受諾者
// （isGuestOnlyMember。ホーム部署が招待用部署のみ）を構造的に取りこぼす。パートAで
// 実際に3箇所（PJオーナー/メンバー選択・タグ付与・AI使用量）を踏んでいたことが分かった。
//
// このテストは「memberInGroup(」の呼び出し箇所を全て列挙し、各箇所が招待受諾者の扱いを
// 明示的に決めている（EXPECTED_CALL_SITESに理由付きで登録されている）ことを検査する。
// 新しい呼び出し箇所（＝新しい「部署で絞り込む画面」）が増えたのに一覧に追加されていなければ
// テストが落ちる。呼び出し箇所を追加・削除・変更（変数名リネーム等）した場合はこの一覧も
// 同時に更新すること（modalStyles.test.ts・labViewContainment.test.tsと同じ「宣言的な配列
// ＋ソース走査」方式。AST解析はしない）。
//
// 🔴 memberInGroup は AdminView.tsx 内のローカル関数（export されていない）ため、
// 呼び出し箇所は必然的にこの1ファイルに閉じている。他ファイルに同種の部署絞り込み
// ヘルパー（例：projectInGroup）が新設された場合は、この仕組みを複製せず、
// 同じ考え方で新しいテストファイルを追加すること。
//
// 【わざと壊して赤くなることを確認した記録（実装前）】
// AdminView.tsx に新しい呼び出し `members.filter(m => memberInGroup(m, selectedGroupId))`
// を一時的に追記（架空の新画面を模したダミー行）→ 実際の出現数（6件）が
// EXPECTED_CALL_SITES（5件）を上回り、「未登録の呼び出し箇所」としてoffendersにdiffが出て
// redになることを確認 → 削除して復元。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_VIEW_PATH = path.resolve(__dirname, "../admin/AdminView.tsx");

/**
 * 現在の `memberInGroup(` 呼び出し箇所（関数定義自体を除く）。
 * トリムした行テキストで一致判定する（変数名・整形が変わったら気づけるようにするため、
 * あえて緩い部分マッチにしない）。
 */
const EXPECTED_CALL_SITES: { line: string; reason: string }[] = [
  {
    line: "() => active(allMembers).filter(m => memberInGroup(m, selectedGroupId)).length,",
    reason:
      "カテゴリナビの「人」サマリー件数。MembersSectionのscopedMembers.length（招待受諾者は" +
      "別枠カードで数える設計）と一致させる目的の要約表示のため、意図的に招待受諾者を含めない。",
  },
  {
    line: "active(rawMembers).filter(m => memberInGroup(m, selectedGroupId)),",
    reason:
      "PJSection：オーナー/メンバー選択の候補一覧のベース。直後にwithGuestOnlyMembers()で" +
      "招待受諾者を混ぜ込むが、混ぜる対象は選択中の部署のPJに紐づく招待受諾者だけに" +
      "inviteGroupIdsInScope()で絞り込む（v3.78パートA・レビュー後の訂正）。",
  },
  {
    line: "() => members.filter(m => memberInGroup(m, selectedGroupId)),",
    reason:
      "MembersSection：部署絞り込み一覧（scopedMembers）。招待受諾者はここに混ぜず、" +
      "同セクション内の別枠カード（guestMembers）で常時表示する設計を維持（v3.60〜）。",
  },
  {
    line: "activeMembers.filter(m => memberInGroup(m, selectedGroupId)),",
    reason:
      "TagsSection：タグ付与チェックボックスの候補一覧のベース。直後にwithGuestOnlyMembers()で" +
      "招待受諾者を混ぜ込むが、混ぜる対象は選択中の部署のPJに紐づく招待受諾者だけに" +
      "inviteGroupIdsInScope()で絞り込む（v3.78パートA・レビュー後の訂正）。",
  },
  {
    line: "const deptMembers = members.filter(m => memberInGroup(m, selectedGroupId));",
    reason:
      "AIUsageSection：AI使用量の部署別集計対象メンバーIDのベース。直後に" +
      "withGuestOnlyMembers()で招待受諾者のログを混ぜ込むが、混ぜる対象は選択中の部署のPJに" +
      "紐づく招待受諾者だけにinviteGroupIdsInScope()で絞り込む（v3.75でmembersの可視性が" +
      "部署をまたいで広がったため。v3.78パートA・レビュー後の訂正）。",
  },
];

function extractMemberInGroupCallLines(source: string): string[] {
  return source
    .split("\n")
    .filter(line => line.includes("memberInGroup(") && !line.includes("function memberInGroup"))
    .map(line => line.trim());
}

describe("memberInGroup（部署絞り込み）の呼び出し箇所は全て招待受諾者の扱いを明示している（CLAUDE.md v3.78 パートB③）", () => {
  const source = fs.readFileSync(ADMIN_VIEW_PATH, "utf8");
  const actualLines = extractMemberInGroupCallLines(source);

  it("実際の呼び出し箇所は宣言済みのEXPECTED_CALL_SITESと1対1で一致する", () => {
    const expectedLines = EXPECTED_CALL_SITES.map(s => s.line);

    const undeclared = actualLines.filter(l => !expectedLines.includes(l));
    const missing = expectedLines.filter(l => !actualLines.includes(l));

    expect({ undeclared, missing }).toEqual({ undeclared: [], missing: [] });
  });

  it("EXPECTED_CALL_SITESの各項目は理由（招待受諾者をどう扱うか）を空でなく持っている", () => {
    const empty = EXPECTED_CALL_SITES.filter(s => s.reason.trim().length === 0);
    expect(empty).toEqual([]);
  });
});
