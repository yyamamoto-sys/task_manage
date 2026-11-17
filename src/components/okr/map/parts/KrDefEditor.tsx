// KRの段の基準文・証拠として見るもの・手がかりの数字の定めを、手で入れる・直す欄（段階2）。
// 段階3では資料（AI の取り込み）からも同じ表（okr_kr_defs）に書く。保存は明示（保存ボタン）で、
// 書きかけのまま画面を離れるときは未保存の警告に載せる（Section 46）。
import { useState } from "react";
import { useUnsavedEditor } from "../../../../hooks/useUnsavedEditor";
import type { HintDef } from "../repository";
import { useMock } from "../state";
import type { KrBands } from "../types";

const STEPS = [60, 70, 80, 90, 100] as const;

interface Form {
  bands: Record<(typeof STEPS)[number], string>;
  evidence: string;
  unit: string;
  start: string;
  target: string;
  direction: "up" | "down";
}

function formOf(bands: KrBands, evidence: string, hint: HintDef | undefined): Form {
  return {
    bands: { 60: bands[60] ?? "", 70: bands[70] ?? "", 80: bands[80] ?? "", 90: bands[90] ?? "", 100: bands[100] ?? "" },
    evidence,
    unit: hint?.unit ?? "",
    start: hint ? String(hint.start) : "",
    target: hint ? String(hint.target) : "",
    direction: hint?.direction ?? "up",
  };
}

/** 入力から保存する形を作る。手がかりは単位が空なら「持たない」。数でない値は理由を返す */
export function parseKrDefForm(f: Form): { bands: KrBands; evidence: string; hint: HintDef | null } | { error: string } {
  const bands: KrBands = { 60: f.bands[60].trim(), 70: f.bands[70].trim(), 80: f.bands[80].trim() };
  if (f.bands[90].trim()) bands[90] = f.bands[90].trim();
  if (f.bands[100].trim()) bands[100] = f.bands[100].trim();
  if (!f.unit.trim()) return { bands, evidence: f.evidence.trim(), hint: null };
  const start = Number(f.start);
  const target = Number(f.target);
  if (f.start.trim() === "" || f.target.trim() === "" || !Number.isFinite(start) || !Number.isFinite(target)) {
    return { error: "手がかりの数字の期首と目標は数で入れてください（単位を空にすると、手がかりの数字を持たないKRになります）" };
  }
  return { bands, evidence: f.evidence.trim(), hint: { unit: f.unit.trim(), start, target, direction: f.direction } };
}

export function KrDefEditor({ krId }: { krId: string }) {
  const { krDefs, records, saveKrDef } = useMock();
  const def = krDefs[krId];
  const hint = records[krId]?.hint;
  const initial = formOf(def?.bands ?? { 60: "", 70: "", 80: "" }, def?.evidence ?? "", hint);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = open && JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedEditor(dirty);

  const save = async () => {
    const parsed = parseKrDefForm(form);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await saveKrDef(krId, { bands: parsed.bands, evidence: parsed.evidence }, parsed.hint);
    setSaving(false);
    if (ok) setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="mk-btn mk-btn-sm"
        onClick={() => {
          setForm(initial);
          setError(null);
          setOpen(true);
        }}
      >
        段の基準・証拠・手がかりを入れる／直す
      </button>
    );
  }
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <form
      className="mk-krdef-form"
      aria-label="段の基準・証拠・手がかりの編集"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="mk-fieldset">
        <legend className="mk-small">段の基準文（60 が出発点。90・100 は無ければ空のまま）</legend>
        {STEPS.map((st) => (
          <label key={st} className="mk-krdef-row">
            <strong>{st}</strong>
            <input className="mk-input" value={form.bands[st]} onChange={(e) => set({ bands: { ...form.bands, [st]: e.target.value } })} />
          </label>
        ))}
      </fieldset>
      <label className="mk-krdef-row">
        <span className="mk-small">Oに近づいた証拠として見るもの</span>
        <textarea className="mk-input" rows={2} value={form.evidence} onChange={(e) => set({ evidence: e.target.value })} />
      </label>
      <fieldset className="mk-fieldset">
        <legend className="mk-small">手がかりの数字（数で測れるKRだけ。単位を空にすると持たない）</legend>
        <div className="mk-krdef-hint">
          <label>
            単位 <input className="mk-input" value={form.unit} onChange={(e) => set({ unit: e.target.value })} />
          </label>
          <label>
            期首 <input className="mk-input" inputMode="decimal" value={form.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label>
            目標 <input className="mk-input" inputMode="decimal" value={form.target} onChange={(e) => set({ target: e.target.value })} />
          </label>
          <label>
            向き{" "}
            <select className="mk-select" value={form.direction} onChange={(e) => set({ direction: e.target.value === "down" ? "down" : "up" })}>
              <option value="up">増やす</option>
              <option value="down">減らす</option>
            </select>
          </label>
        </div>
      </fieldset>
      {error && (
        <p className="mk-small" role="alert">
          {error}
        </p>
      )}
      <div className="mk-krdef-actions">
        <button type="submit" className="mk-btn mk-btn-sm mk-btn-primary" disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => setOpen(false)} disabled={saving}>
          やめる
        </button>
      </div>
    </form>
  );
}
