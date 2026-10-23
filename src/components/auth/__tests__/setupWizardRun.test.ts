import { describe, it, expect, vi } from "vitest";
import { pickSetupMembers, newSetupProgress, runSetup } from "../setupWizardRun";

const draft = (id: string, display_name: string, short_name: string) => ({ id, display_name, short_name });

describe("pickSetupMembers（登録対象は表示名と略称の両方が入った行）", () => {
  it("略称だけ空の行は拾わない＝先頭の行が略称なしでも、印の付いた人が最初の管理者になる", () => {
    const picked = pickSetupMembers([draft("a", "山田 太郎", ""), draft("b", "鈴木 花子", "鈴木")]);
    expect(picked.map(m => m.id)).toEqual(["b"]);
  });

  it("空白だけの値は未入力として扱う", () => {
    expect(pickSetupMembers([draft("a", "  ", "x"), draft("b", "x", " 　 ")])).toEqual([]);
  });
});

function makeDeps(opts: { saveFailsOnce?: string } = {}) {
  let failed = false;
  const calls: string[] = [];
  const deps = {
    bootstrap: vi.fn(async () => { calls.push("bootstrap"); return "g1"; }),
    setGroup: vi.fn((id: string) => { calls.push(`group:${id}`); }),
    saveMember: vi.fn(async (m: { id: string }) => {
      if (opts.saveFailsOnce === m.id && !failed) { failed = true; throw new Error("save failed"); }
      calls.push(`save:${m.id}`);
    }),
    reload: vi.fn(async () => { calls.push("reload"); }),
  };
  return { deps, calls };
}

describe("runSetup（途中で失敗しても再試行で二重に作らない）", () => {
  it("通常は部署作成→メンバー登録→再読み込みの順に1回ずつ", async () => {
    const { deps, calls } = makeDeps();
    await runSetup(deps, newSetupProgress(), [{ id: "m2" }, { id: "m3" }]);
    expect(calls).toEqual(["bootstrap", "group:g1", "save:m2", "save:m3", "reload"]);
  });

  it("2人目の登録で失敗→もう一度押しても、部署作成は呼び直さず、登録済みの人は飛ばす", async () => {
    const { deps } = makeDeps({ saveFailsOnce: "m3" });
    const progress = newSetupProgress();
    await expect(runSetup(deps, progress, [{ id: "m2" }, { id: "m3" }])).rejects.toThrow("save failed");
    await runSetup(deps, progress, [{ id: "m2" }, { id: "m3" }]);
    expect(deps.bootstrap).toHaveBeenCalledTimes(1);
    expect(deps.saveMember.mock.calls.map(c => c[0].id)).toEqual(["m2", "m3", "m3"]);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("部署作成そのものが失敗したときは、次の再試行で部署作成をやり直せる", async () => {
    const { deps } = makeDeps();
    deps.bootstrap.mockRejectedValueOnce(new Error("rpc failed"));
    const progress = newSetupProgress();
    await expect(runSetup(deps, progress, [])).rejects.toThrow("rpc failed");
    await runSetup(deps, progress, []);
    expect(deps.bootstrap).toHaveBeenCalledTimes(2);
  });
});
