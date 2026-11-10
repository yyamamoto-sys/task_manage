import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { kintoneTexts, LOCKED_AT, okrItems as okrInit, pjsInit } from "./fixtures";
import { compareOkr, type Resolution } from "./logic";
import type { OkrItem, Pj } from "./types";

export type ScreenId = "home" | "import" | "map" | "kr" | "checkin" | "review" | "plan";

interface MockState {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  items: OkrItem[];
  locked: boolean;
  lockedAt: string;
  imported: boolean;
  setImported: (v: boolean) => void;
  resolutions: Record<string, Resolution>;
  setResolution: (id: string, r: Resolution) => void;
  lock: (finalTexts: Record<string, string>) => void;
  unlockDemo: () => void;
  pjs: Pj[];
  linkPj: (pjId: string, tfId: string) => void;
  unlinkPj: (pjId: string, tfId: string) => void;
  selectedKr: string;
  setSelectedKr: (id: string) => void;
  openKr: (id: string) => void;
  teamId: string;
  setTeamId: (id: string) => void;
  reminded: Set<string>;
  markReminded: (ids: string[]) => void;
  toast: string | null;
  showToast: (msg: string) => void;
  kintone: Record<string, string>;
}

const Ctx = createContext<MockState | null>(null);

export function useMock(): MockState {
  const v = useContext(Ctx);
  if (!v) throw new Error("MockProvider の外です");
  return v;
}

export function MockProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenId>("home");
  const [items, setItems] = useState<OkrItem[]>(okrInit);
  const [locked, setLocked] = useState(true);
  const [imported, setImported] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [pjs, setPjs] = useState<Pj[]>(pjsInit);
  const [selectedKr, setSelectedKr] = useState("kr1");
  const [teamId, setTeamId] = useState("ta");
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const value = useMemo<MockState>(
    () => ({
      screen,
      setScreen,
      items,
      locked,
      lockedAt: LOCKED_AT,
      imported,
      setImported,
      resolutions,
      setResolution: (id, r) => setResolutions((p) => ({ ...p, [id]: r })),
      lock: (finalTexts) => {
        setItems((prev) => prev.map((i) => ({ ...i, text: finalTexts[i.id] ?? i.text })));
        setLocked(true);
      },
      unlockDemo: () => {
        setItems(okrInit);
        setLocked(false);
        setImported(false);
        setResolutions({});
      },
      pjs,
      linkPj: (pjId, tfId) =>
        setPjs((p) => p.map((x) => (x.id === pjId && !x.tfIds.includes(tfId) ? { ...x, tfIds: [...x.tfIds, tfId] } : x))),
      unlinkPj: (pjId, tfId) =>
        setPjs((p) => p.map((x) => (x.id === pjId ? { ...x, tfIds: x.tfIds.filter((t) => t !== tfId) } : x))),
      selectedKr,
      setSelectedKr,
      openKr: (id) => {
        setSelectedKr(id);
        setScreen("kr");
      },
      teamId,
      setTeamId,
      reminded,
      markReminded: (ids) => setReminded((p) => new Set([...p, ...ids])),
      toast,
      showToast,
      kintone: kintoneTexts,
    }),
    [screen, items, locked, imported, resolutions, pjs, selectedKr, teamId, reminded, toast, showToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompareRows() {
  const { items, kintone } = useMock();
  return useMemo(() => compareOkr(items, kintone), [items, kintone]);
}
