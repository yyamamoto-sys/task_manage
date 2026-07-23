// appStore の「現在Objective」部署別導出（2026-07-23）の統合テスト。
// pickCurrentObjectiveForGroup 自体の網羅テストは lib/okr/__tests__/deptScope.test.ts。
// ここでは「実際に setCurrentGroupId / saveObjective 経由で state.objective が正しく
// 部署スコープされ、is_current フリップが他部署を巻き込まないか」を、Supabase クライアントを
// モックして確認する（stores/__tests__/cascadeReschedule.test.ts と同じモック方式）。

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown> & { id: string };

const db = {
  tables: new Map<string, Map<string, Row>>(),
};

function table(name: string): Map<string, Row> {
  if (!db.tables.has(name)) db.tables.set(name, new Map());
  return db.tables.get(name)!;
}

function seed(tableName: string, row: Row) {
  table(tableName).set(row.id, { ...row });
}

function resetDb() {
  db.tables.clear();
}

vi.mock("../../lib/supabase/client", () => {
  function selectBuilder(tableName: string) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const builder = {
      eq(field: string, value: unknown) {
        filters.push({ field, value });
        return builder;
      },
      maybeSingle() {
        const match = [...table(tableName).values()].find(r =>
          filters.every(f => r[f.field] === f.value),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      single() {
        const match = [...table(tableName).values()].find(r =>
          filters.every(f => r[f.field] === f.value),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
    return builder;
  }

  function updateBuilder(tableName: string, payload: Record<string, unknown>) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const builder = {
      eq(field: string, value: unknown) {
        filters.push({ field, value });
        return builder;
      },
      select() {
        const t = table(tableName);
        const matches = [...t.values()].filter(r => filters.every(f => r[f.field] === f.value));
        const updated = matches.map(r => {
          const merged = { ...r, ...payload };
          t.set(r.id, merged);
          return merged;
        });
        return {
          single() {
            return Promise.resolve({ data: updated[0] ?? null, error: null });
          },
        };
      },
    };
    return builder;
  }

  const supabase = {
    from(tableName: string) {
      return {
        select: () => selectBuilder(tableName),
        insert: (payload: Record<string, unknown>) => {
          const row = { ...payload, id: (payload.id as string) ?? `gen-${Math.random()}` } as Row;
          table(tableName).set(row.id, row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => updateBuilder(tableName, payload),
      };
    },
  };
  return { supabase, isMisconfigured: false };
});

vi.mock("../../lib/guestMode", () => ({
  isGuestMode: () => false,
  GUEST_READONLY_MESSAGE: "guest",
}));

// モック後に SUT を import
import { useAppStore } from "../appStore";
import type { Objective } from "../../lib/localData/types";

function makeObjective(overrides: Partial<Objective> & { id: string }): Objective {
  return {
    title: "t", period: "2026年度", is_current: true, updated_by: "u1",
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
  useAppStore.setState({ objectives: [], currentGroupId: null });
});

describe("setCurrentGroupId：表示部署の切替に objective が追従する", () => {
  it("部署ごとに異なる現在Objectiveへ切り替わる（他部署が混ざらない）", () => {
    const eggObj = makeObjective({ id: "o-egg", group_id: "grp-egg" });
    const aidObj = makeObjective({ id: "o-aid", group_id: "grp-aid" });
    useAppStore.setState({ objectives: [eggObj, aidObj] });

    useAppStore.getState().setCurrentGroupId("grp-egg");
    expect(useAppStore.getState().objective?.id).toBe("o-egg");

    useAppStore.getState().setCurrentGroupId("grp-aid");
    expect(useAppStore.getState().objective?.id).toBe("o-aid");
  });

  it("該当部署にObjectiveが無ければ null（他部署のis_currentが漏れ出さない）", () => {
    useAppStore.setState({ objectives: [makeObjective({ id: "o-egg", group_id: "grp-egg" })] });
    useAppStore.getState().setCurrentGroupId("grp-new");
    expect(useAppStore.getState().objective).toBeNull();
  });
});

describe("saveObjective：is_current フリップは部署内に限定される", () => {
  it("A部署に新しい現在Objectiveを保存しても、B部署の現在Objectiveのis_currentは変わらない", async () => {
    const bObj = makeObjective({ id: "o-b-old", group_id: "grp-b" });
    seed("objectives", bObj as unknown as Row);
    useAppStore.setState({ objectives: [bObj], currentGroupId: "grp-a" });

    const aObj = makeObjective({ id: "o-a-new", group_id: "grp-a" });
    await useAppStore.getState().saveObjective(aObj);

    const objectives = useAppStore.getState().objectives;
    expect(objectives.find(o => o.id === "o-b-old")?.is_current).toBe(true);
    expect(objectives.find(o => o.id === "o-a-new")?.is_current).toBe(true);
    // currentGroupId=grp-a なので、新しく作ったA部署のObjectiveがobjectiveとして見える
    expect(useAppStore.getState().objective?.id).toBe("o-a-new");
  });

  it("OkrImportModalと同じ手順（新規作成→旧を is_current:false）でも他部署は無傷", async () => {
    const bObj = makeObjective({ id: "o-b-old", group_id: "grp-b" });
    const aOldObj = makeObjective({ id: "o-a-old", group_id: "grp-a" });
    seed("objectives", bObj as unknown as Row);
    seed("objectives", aOldObj as unknown as Row);
    useAppStore.setState({ objectives: [bObj, aOldObj], currentGroupId: "grp-a" });

    const aNewObj = makeObjective({ id: "o-a-new", group_id: "grp-a" });
    await useAppStore.getState().saveObjective(aNewObj);
    await useAppStore.getState().saveObjective({ ...aOldObj, is_current: false });

    const objectives = useAppStore.getState().objectives;
    expect(objectives.find(o => o.id === "o-a-old")?.is_current).toBe(false);
    expect(objectives.find(o => o.id === "o-a-new")?.is_current).toBe(true);
    expect(objectives.find(o => o.id === "o-b-old")?.is_current).toBe(true);
    expect(useAppStore.getState().objective?.id).toBe("o-a-new");
  });
});
