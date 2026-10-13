import { describe, expect, it, vi, beforeEach } from "vitest";

const { deleteTask, restoreTask, showToast } = vi.hoisted(() => ({
  deleteTask: vi.fn(async () => {}),
  restoreTask: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("../../../stores/appStore", () => ({
  useAppStore: { getState: () => ({ deleteTask, restoreTask }) },
}));
vi.mock("../../../components/common/Toast", () => ({ showToast }));

import { deleteTaskWithUndo } from "../deleteTaskWithUndo";

beforeEach(() => { vi.clearAllMocks(); });

describe("deleteTaskWithUndo", () => {
  it("削除し、元に戻す付きトースト(isUndo)を出し、押すと復元する", async () => {
    await deleteTaskWithUndo("t1", "名前", "u1");
    expect(deleteTask).toHaveBeenCalledWith("t1", "u1");
    const [msg, , action] = showToast.mock.calls[0];
    expect(msg).toContain("名前");
    expect(action.isUndo).toBe(true);
    action.onClick();
    expect(restoreTask).toHaveBeenCalledWith("t1", "u1");
  });

  it("削除に失敗したらトーストを出さず例外を伝える", async () => {
    deleteTask.mockRejectedValueOnce(new Error("x"));
    await expect(deleteTaskWithUndo("t1", "名前", "u1")).rejects.toThrow();
    expect(showToast).not.toHaveBeenCalled();
  });
});

