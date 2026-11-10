// src/lib/ai/consultModels.ts
//
// 【設計意図・v3.209】AI相談で使うモデルの選択肢。
// 標準（Sonnet 5.5）は既定。思考が長いと感じたとき用に、一段軽い高速（Haiku 5.5）を選べる。
// 公式ドキュメントで確認済み：Haiku 5.5 も adaptive thinking・effort・構造化出力（output_config）に対応しており、
// 送るパラメータは Sonnet 5.5 と同一（モデルIDだけが変わる）。
// サーバー（Edge Function ai-consult）の ALLOWED_MODELS にも同じIDが必要（無いと既定モデルで実行される）。

import { KEYS } from "../localData/localStore";

export interface ConsultModelOption {
  id: string;
  label: string;
  hint: string;
}

export const DEFAULT_CONSULT_MODEL = "claude-sonnet-5-5";

export const CONSULT_MODEL_OPTIONS: ConsultModelOption[] = [
  { id: DEFAULT_CONSULT_MODEL, label: "標準（Sonnet 5.5）", hint: "じっくり考えて答える。通常はこちら" },
  { id: "claude-haiku-5-5", label: "高速（Haiku 5.5）", hint: "待ち時間が短い。複雑な相談では精度が下がることがある" },
];

/** 選択肢に無い値（古い保存値・未指定）は既定に戻す */
export function normalizeConsultModel(value: string | null | undefined): string {
  return CONSULT_MODEL_OPTIONS.some(o => o.id === value) ? (value as string) : DEFAULT_CONSULT_MODEL;
}

export function consultModelLabel(id: string): string {
  return CONSULT_MODEL_OPTIONS.find(o => o.id === id)?.label ?? id;
}

export function loadConsultModel(): string {
  try { return normalizeConsultModel(localStorage.getItem(KEYS.CONSULT_MODEL)); } catch { return DEFAULT_CONSULT_MODEL; }
}

export function saveConsultModel(id: string): void {
  try { localStorage.setItem(KEYS.CONSULT_MODEL, normalizeConsultModel(id)); } catch { /* 保存できなくても相談は続ける */ }
}
