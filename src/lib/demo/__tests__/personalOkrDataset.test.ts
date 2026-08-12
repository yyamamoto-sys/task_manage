// src/lib/demo/__tests__/personalOkrDataset.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）モードのOKR「自分」タブ用サンプルデータの機械的な検証。
// dataset.test.ts と同じ流儀（id接頭辞・group_id・静的import禁止）に加え、
// dataset.ts（グループOKR側）の実在タスクidを参照している箇所の整合性を検証する。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoPersonalOkrDataset } from "../personalOkrDataset";
import { buildDemoDataset } from "../dataset";
import { DEMO_GROUP_ID } from "../constants";
import { GUEST_MEMBER_ID } from "../../guestMode";

describe("buildDemoPersonalOkrDataset", () => {
  const data = buildDemoPersonalOkrDataset();

  it("個人KRが2〜3本ある", () => {
    expect(data.krs.length).toBeGreaterThanOrEqual(2);
    expect(data.krs.length).toBeLessThanOrEqual(3);
  });

  it("全KRのidがdemo-接頭辞・member_idがGUEST_MEMBER_ID・group_idがDEMO_GROUP_IDである", () => {
    for (const kr of data.krs) {
      expect(kr.id.startsWith("demo-")).toBe(true);
      expect(kr.member_id).toBe(GUEST_MEMBER_ID);
      expect(kr.group_id).toBe(DEMO_GROUP_ID);
    }
  });

  it("ウェイトの合計が100%である", () => {
    const total = data.krs.reduce((sum, kr) => sum + kr.weight_pct, 0);
    expect(total).toBe(100);
  });

  it("各KRに当月分の月次計画が少なくとも1件ある", () => {
    for (const kr of data.krs) {
      const months = data.monthsByKr[kr.id] ?? [];
      expect(months.length).toBeGreaterThanOrEqual(1);
      for (const m of months) {
        expect(m.id.startsWith("demo-")).toBe(true);
        expect(m.personal_kr_id).toBe(kr.id);
      }
    }
  });

  it("各KRに週の目標状態が1件以上あり、少なくとも1件は未評価（self_rating=null）を含む", () => {
    for (const kr of data.krs) {
      const weeks = data.weeksByKr[kr.id] ?? [];
      expect(weeks.length).toBeGreaterThan(0);
      for (const w of weeks) {
        expect(w.id.startsWith("demo-")).toBe(true);
        expect(w.personal_kr_id).toBe(kr.id);
      }
    }
    const allWeeks = Object.values(data.weeksByKr).flat();
    expect(allWeeks.some(w => w.self_rating === null)).toBe(true);
    expect(allWeeks.some(w => w.self_rating !== null)).toBe(true);
  });

  it("メモが複数件ある", () => {
    const allMemos = Object.values(data.memosByKr).flat();
    expect(allMemos.length).toBeGreaterThanOrEqual(3);
    for (const m of allMemos) {
      expect(m.id.startsWith("demo-")).toBe(true);
      expect(m.member_id).toBe(GUEST_MEMBER_ID);
    }
  });

  it("週とタスクの紐づけが1件以上ある（AheadBlockの遅延・先行待ちの表示が空にならないため）", () => {
    const allLinks = Object.values(data.weekTasksByWeek).flat();
    expect(allLinks.length).toBeGreaterThan(0);
  });

  it("週タスクの紐づけ先idはdataset.ts（グループOKR側）に実在するタスクを指す", () => {
    const taskIds = new Set(buildDemoDataset().tasks.map(t => t.id));
    const allLinks = Object.values(data.weekTasksByWeek).flat();
    for (const link of allLinks) {
      expect(taskIds.has(link.task_id)).toBe(true);
    }
  });

  it("実在の顧客名・PJ名・人名を含まない（アルファベット3文字のイニシャル等、既存demoの規約を踏襲）", () => {
    const allText = JSON.stringify(data);
    // 個人情報・実名は入れない方針の簡易検査：GUEST_MEMBER_ID以外の氏名パターンを含まないこと
    expect(allText).not.toMatch(/株式会社|アミタ/);
  });
});

// ===== 静的importの禁止（Section 19：ダウンロード量の最小化） =====

describe("personalOkrDataset.ts は動的importでのみ読み込まれる（静的import禁止）", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const SRC_DIR = path.resolve(__dirname, "../../../");

  function collectStaticImportSites(dir: string, results: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectStaticImportSites(full, results);
      } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
        const content = fs.readFileSync(full, "utf-8");
        const staticImportRe = /import\s+(?:type\s+)?[^;]*?\bfrom\s+["'][^"']*\/demo\/personalOkrDataset["']/g;
        if (staticImportRe.test(content)) {
          results.push(path.relative(SRC_DIR, full).replace(/\\/g, "/"));
        }
      }
    }
    return results;
  }

  it("personalOkrDataset.ts を静的importしているのはテストファイル以外に存在しない", () => {
    const sites = collectStaticImportSites(SRC_DIR, []);
    expect(sites).toEqual([]);
  });
});
