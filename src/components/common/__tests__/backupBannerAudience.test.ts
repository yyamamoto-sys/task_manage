// BackupHealthBanner は super_admin にだけ出す（backup_runs の RLS が super_admin 限定のため、
// 部署の管理者に出すと記録が読めず「一度も成功していない」と誤って赤になる。2026-10-15 実際に発生）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(resolve(__dirname, "../BackupHealthBanner.tsx"), "utf-8")
  .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("BackupHealthBanner の表示対象", () => {
  it("判定に is_admin を使わず is_super_admin だけを見る", () => {
    expect(src).toMatch(/const isAdmin = currentUser\.is_super_admin === true;/);
    expect(src).not.toMatch(/currentUser\.is_admin/);
  });
});
