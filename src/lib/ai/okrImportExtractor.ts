// src/lib/ai/okrImportExtractor.ts
//
// 【設計意図】
// Kintone で記録した OKR（Objective/KR/TF）の PDF・テキストを AI に読ませ、
// 現行アプリのエンティティ（Objective 1件／KeyResult 複数／TaskForce 複数）の
// 構造に抽出する。meetingExtractor.ts と同じ作法（PDFはdocumentブロックで添付・
// 抽出結果はJSONで受け取り手書きバリデーション・確認/編集は呼び出し元UIが担う）。
//
// 【スコープ】評価基準バンド・ロジックモデル・5W1H・月次タスク／ToDoは抽出しない
// （OKRモード全面刷新時に別途設計。docs は project memory 参照）。

import { invokeAI, buildMessageContent, type FileAttachment } from "./invokeAI";

// ===== 型定義 =====

export interface OkrImportTaskForce {
  /** Kintoneの「KR1-TF1」等の番号部分（例："1"）。不明はnull */
  tf_number: string | null;
  name: string;
  /** TFの目的・詳細（検証プロセスの要約程度） */
  description: string | null;
  /** 設定した意図・背景 */
  background: string | null;
  /** 担当OM・リーダーの氏名ヒント（既存メンバーとの突合に使う。不明はnull） */
  leader_name_hint: string | null;
  source_quote: string;
}

export interface OkrImportKeyResult {
  title: string;
  task_forces: OkrImportTaskForce[];
}

export interface OkrImportObjective {
  title: string;
  purpose: string | null;
  background: string | null;
  /** 年度・範囲（例："2026年度下期"）。不明はnull */
  period: string | null;
}

export interface OkrImportAnalysis {
  objective: OkrImportObjective;
  key_results: OkrImportKeyResult[];
}

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたはKintoneで記録されたOKR（Objective・KeyResult・TaskForce）の
画面PDF・テキストを解析して、タスク管理アプリのOKR構造に変換するAIです。

【Kintoneの器（フィールド）→ 抽出先のマッピング】
- 年度・範囲・Purpose・設定の意図/背景 → objective（1件のみ）
- KR1, KR2, KR3... の各ブロック → key_results配列の各要素
- KR1-TF1, TF2... の各ブロック（KRの配下） → そのKRのtask_forces配列の各要素
- 担当OM・リーダーの氏名 → leader_name_hint

【抽出しないもの（無視してよい）】
- 評価基準バンド（60/70/80/90/100等の達成度指標）
- ロジックモデル図
- 5W1H等の詳細フォーム項目
- 月次のタスク1/2/3・ToDoレベルの実行計画（TFの説明文に要約を含める程度は可。個別タスクとしては抽出しない）

【抽出ルール】
- objective.title: そのOKR全体のタイトル・主題
- objective.purpose: 何を達成するか（Purposeフィールドがあればそれを使う。無ければ本文から要約）
- objective.background: 設定の意図・背景（経営確認事項やメッセージがあれば要約に反映してよいが、原文の丸写しは避け趣旨を抽出する）
- objective.period: 「2026年度」「2026年度下期」等、年度・対象範囲の表記（不明はnull）
- key_results[].title: KRのタイトル文（「KR1：」等の番号プレフィックスは除去し本文のみ）
- task_forces[].tf_number: 「TF1」「KR1-TF2」等から番号部分のみ抽出（例："1"「"2"）。不明はnull
- task_forces[].name: TFの名称
- task_forces[].description: TFの目的・検証プロセスの要約（1〜3文程度。長い場合は要約する）
- task_forces[].background: なぜこのTFを設定したかの背景（あれば）
- task_forces[].leader_name_hint: 担当OM・リーダーとして記載された氏名（フルネームまたは表示名のまま。不明はnull）
- source_quoteは根拠となる原文の一部（30文字以内）

出力はJSONのみ。コードブロック\`\`\`は絶対に使わない。

{
  "objective": {
    "title": "...",
    "purpose": "..." | null,
    "background": "..." | null,
    "period": "..." | null
  },
  "key_results": [
    {
      "title": "...",
      "task_forces": [
        {
          "tf_number": "1" | null,
          "name": "...",
          "description": "..." | null,
          "background": "..." | null,
          "leader_name_hint": "山田太郎" | null,
          "source_quote": "根拠となる原文の一部"
        }
      ]
    }
  ]
}`;

// ===== AI 抽出 =====

export interface ExtractOkrImportParams {
  /** テキスト貼り付け（PDF添付のみの場合は空文字） */
  transcript: string;
  /** PDF等の添付。テキストが無くても添付があれば解析可 */
  attachment?: FileAttachment | null;
}

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

function validateTaskForce(data: unknown, path: string): OkrImportTaskForce {
  if (!data || typeof data !== "object") throw new Error(`${path}が不正な形式です。`);
  const d = data as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim()) throw new Error(`${path}.nameが取得できませんでした。`);
  return {
    tf_number: typeof d.tf_number === "string" ? d.tf_number : null,
    name: d.name,
    description: typeof d.description === "string" ? d.description : null,
    background: typeof d.background === "string" ? d.background : null,
    leader_name_hint: typeof d.leader_name_hint === "string" ? d.leader_name_hint : null,
    source_quote: typeof d.source_quote === "string" ? d.source_quote : "",
  };
}

function validateKeyResult(data: unknown, path: string): OkrImportKeyResult {
  if (!data || typeof data !== "object") throw new Error(`${path}が不正な形式です。`);
  const d = data as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) throw new Error(`${path}.titleが取得できませんでした。`);
  if (!Array.isArray(d.task_forces)) throw new Error(`${path}.task_forcesが取得できませんでした。`);
  return {
    title: d.title,
    task_forces: d.task_forces.map((tf, i) => validateTaskForce(tf, `${path}.task_forces[${i}]`)),
  };
}

export function validateOkrImportAnalysis(data: unknown): OkrImportAnalysis {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;
  if (!d.objective || typeof d.objective !== "object") throw new Error("objectiveが取得できませんでした。");
  const obj = d.objective as Record<string, unknown>;
  if (typeof obj.title !== "string" || !obj.title.trim()) throw new Error("objective.titleが取得できませんでした。");
  if (!Array.isArray(d.key_results)) throw new Error("key_resultsが取得できませんでした。");

  return {
    objective: {
      title: obj.title,
      purpose: typeof obj.purpose === "string" ? obj.purpose : null,
      background: typeof obj.background === "string" ? obj.background : null,
      period: typeof obj.period === "string" ? obj.period : null,
    },
    key_results: d.key_results.map((kr, i) => validateKeyResult(kr, `key_results[${i}]`)),
  };
}

export async function extractOkrImportData(params: ExtractOkrImportParams): Promise<OkrImportAnalysis> {
  const userMessage = params.transcript
    || (params.attachment ? `（添付ファイル「${params.attachment.fileName}」をKintoneのOKR画面PDFとして参照してください）` : "");

  // 添付（PDF等）がある場合は document ブロックとして同梱
  const content = buildMessageContent(userMessage, params.attachment ?? null);
  const res = await invokeAI(SYSTEM_PROMPT, [{ role: "user", content }], 4096, "okr-import");
  const text = res.content[0].text;
  return validateOkrImportAnalysis(parseJsonSafe<unknown>(text));
}
