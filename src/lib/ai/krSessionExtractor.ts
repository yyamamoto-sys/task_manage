// src/lib/ai/krSessionExtractor.ts
//
// 【設計意図】
// 会議の文字起こしテキストからチェックイン・ウィンセッションの構造化データをAIで抽出する。
// 出力はJSONのみ。確認UIでユーザーが修正できるため、完璧な精度は求めない。

import { invokeAI, buildMessageContent, type FileAttachment } from "./invokeAI";

// ===== 抽出結果の型 =====

export interface ExtractedDeclaration {
  member_short_name: string;  // 「未特定」の場合もある
  content: string;
  due_date: string | null;    // YYYY-MM-DD or null
}

export interface ExtractedCheckin {
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  declarations: ExtractedDeclaration[];
}

export interface ExtractedDeclarationResult {
  declaration_index: number;  // 前回宣言リストのインデックス
  result_status: "achieved" | "partial" | "not_achieved" | null;
  result_note: string;
}

export interface ExtractedWinSession {
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  declaration_results: ExtractedDeclarationResult[];
  learnings: string;
  external_changes: string;
}

export interface ExtractedKrMention {
  kr_title_hint: string;   // 言及された KR タイトルのヒント（完全一致しなくてもよい）
  note: string;            // どんな言及だったか（短文）
}

export interface ExtractedFreeformSession {
  summary: string;                          // 議論サマリ（5〜10文）
  decisions: string[];                      // 決定事項のリスト
  kr_mentions: ExtractedKrMention[];        // 言及された KR
  follow_up_tasks: ExtractedDeclaration[];  // フォローアップタスク（既存型を再利用）
}

// ===== システムプロンプト =====

const CHECKIN_EXTRACT_PROMPT = `あなたはOKR会議の文字起こしを構造化JSONに変換するAIです。

入力データ:
- KR情報（対象のKey Result）
- メンバーリスト（short_name一覧）
- 文字起こしテキスト

抽出するもの:
1. signal: 進捗シグナル（"green"=60%以上達成見込み / "yellow"=50〜59% / "red"=49%以下）。言及がなければnull
2. signal_comment: シグナルの根拠・補足コメント
3. declarations: 各メンバーの宣言（誰が・何を・いつまでに）

出力形式（JSONのみ。マークダウンのコードブロック\`\`\`は絶対に使わない）:
{
  "signal": "green" | "yellow" | "red" | null,
  "signal_comment": "...",
  "declarations": [
    {
      "member_short_name": "メンバーのshort_nameまたは「未特定」",
      "content": "宣言内容（行動レベルで具体的に）",
      "due_date": "YYYY-MM-DD" | null
    }
  ]
}`;

const WIN_SESSION_EXTRACT_PROMPT = `あなたはOKR会議の文字起こしを構造化JSONに変換するAIです。

入力データ:
- KR情報（対象のKey Result）
- メンバーリスト（short_name一覧）
- 前回チェックインの宣言リスト（インデックス付き）
- 文字起こしテキスト

抽出するもの:
1. signal: 今週の進捗シグナル（"green"/"yellow"/"red"/null）
2. signal_comment: シグナルの根拠・補足
3. declaration_results: 前回宣言リストへの照合結果
4. learnings: 仮説検証の結果・学び
5. external_changes: 外部環境変化（言及がなければ空文字）

declaration_resultのresult_status:
- "achieved": 宣言通り達成
- "partial": 部分的に達成
- "not_achieved": 未達成
- null: 言及なし・判断不明

出力形式（JSONのみ。マークダウンのコードブロック\`\`\`は絶対に使わない）:
{
  "signal": "green" | "yellow" | "red" | null,
  "signal_comment": "...",
  "declaration_results": [
    {
      "declaration_index": 0,
      "result_status": "achieved" | "partial" | "not_achieved" | null,
      "result_note": "..."
    }
  ],
  "learnings": "...",
  "external_changes": "..."
}`;

// ===== freeform プロンプト =====
//
// 【ラボ機能例外（CLAUDE.md Section 2）】
// チェックイン・ウィンセッションと同じく KR/TF を AI に渡す機能のため、
// AIIntent タグ "kr-session-extract" の枠内で扱う（追加タグは不要）。
// freeform は「OKR/TF が議題中心の自由形式の会議」を想定する。

const FREEFORM_EXTRACT_PROMPT = `あなたはOKR文脈の会議文字起こしを構造化JSONに変換するAIです。
チェックイン・ウィンセッションのような決まったフォーマットではなく、
戦略会議・四半期計画・KRレビュー会議などの自由形式の議論から要点を抽出します。

入力データ:
- KR情報（議論の中心となっている可能性が高い対象KR）
- 全KRリスト（言及されたKRの照合用・タイトルのみ）
- メンバーリスト（short_name一覧）
- 文字起こしテキスト

抽出するもの:
1. summary: 議論全体のサマリ（5〜10文・敬体不要）
2. decisions: 会議で決まったこと・合意事項のリスト（各項目は短く端的に）
3. kr_mentions: 議論中で言及された KR のリスト（タイトルのヒント＋言及内容の短文）
   - 対象KR以外の KR にも言及があれば全て拾う
   - 言及がなければ空配列
4. follow_up_tasks: 議論から派生したフォローアップタスク候補（誰が・何を・いつまでに）
   - 「次回までに〜する」「〜さんが調べる」などの発言から拾う
   - チェックイン宣言と違い、構造化レベルは弱くてよい
   - メンバーが特定できなければ "未特定"
   - 期日が言及されていなければ null

出力形式（JSONのみ。マークダウンのコードブロック\`\`\`は絶対に使わない）:
{
  "summary": "...",
  "decisions": ["決定1", "決定2"],
  "kr_mentions": [
    { "kr_title_hint": "KRのタイトル", "note": "どんな言及か（短文）" }
  ],
  "follow_up_tasks": [
    {
      "member_short_name": "メンバーのshort_nameまたは「未特定」",
      "content": "タスク内容（行動レベルで具体的に）",
      "due_date": "YYYY-MM-DD" | null
    }
  ]
}`;

// ===== 呼び出し共通処理 =====

async function callExtractAI(system: string, userMessage: string, attachment?: FileAttachment): Promise<string> {
  const content = buildMessageContent(userMessage, attachment ?? null);
  const res = await invokeAI(system, [{ role: "user", content }], 4096, "kr-session-extract");
  return res.content[0].text;
}

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

function validateCheckin(data: unknown): ExtractedCheckin {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスがオブジェクトではありません。");
  const d = data as Record<string, unknown>;
  const validSignals = ["green", "yellow", "red", null];
  if (!validSignals.includes(d.signal as string | null)) {
    throw new Error(`不正なsignal値: ${d.signal}`);
  }
  if (!Array.isArray(d.declarations)) {
    throw new Error("declarationsが配列ではありません。");
  }
  for (const decl of d.declarations as unknown[]) {
    if (!decl || typeof decl !== "object") throw new Error("declaration要素がオブジェクトではありません。");
    const dec = decl as Record<string, unknown>;
    if (typeof dec.member_short_name !== "string") throw new Error("member_short_nameがstringではありません。");
    if (typeof dec.content !== "string") throw new Error("contentがstringではありません。");
    if (dec.due_date !== null && typeof dec.due_date !== "string") throw new Error("due_dateの型が不正です。");
  }
  return d as unknown as ExtractedCheckin;
}

function validateWinSession(data: unknown): ExtractedWinSession {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスがオブジェクトではありません。");
  const d = data as Record<string, unknown>;
  const validSignals = ["green", "yellow", "red", null];
  if (!validSignals.includes(d.signal as string | null)) {
    throw new Error(`不正なsignal値: ${d.signal}`);
  }
  if (!Array.isArray(d.declaration_results)) {
    throw new Error("declaration_resultsが配列ではありません。");
  }
  const validStatuses = ["achieved", "partial", "not_achieved", null];
  for (const res of d.declaration_results as unknown[]) {
    if (!res || typeof res !== "object") throw new Error("declaration_results要素がオブジェクトではありません。");
    const r = res as Record<string, unknown>;
    if (typeof r.declaration_index !== "number") throw new Error("declaration_indexがnumberではありません。");
    if (!validStatuses.includes(r.result_status as string | null)) throw new Error(`不正なresult_status: ${r.result_status}`);
    if (typeof r.result_note !== "string") throw new Error("result_noteがstringではありません。");
  }
  if (typeof d.learnings !== "string") throw new Error("learningsがstringではありません。");
  if (typeof d.external_changes !== "string") throw new Error("external_changesがstringではありません。");
  return d as unknown as ExtractedWinSession;
}

// ===== チェックイン抽出 =====

export async function extractCheckinData(params: {
  krTitle: string;
  memberShortNames: string[];
  transcript: string;
  attachment?: FileAttachment;
}): Promise<ExtractedCheckin> {
  const userMessage = JSON.stringify({
    kr_title: params.krTitle,
    members: params.memberShortNames,
    transcript: params.transcript,
  });

  const text = await callExtractAI(CHECKIN_EXTRACT_PROMPT, userMessage, params.attachment);
  const parsed = parseJsonSafe<unknown>(text);
  return validateCheckin(parsed);
}

// ===== ウィンセッション抽出 =====

export async function extractWinSessionData(params: {
  krTitle: string;
  memberShortNames: string[];
  previousDeclarations: { index: number; member: string; content: string; due_date: string | null }[];
  transcript: string;
  attachment?: FileAttachment;
}): Promise<ExtractedWinSession> {
  const userMessage = JSON.stringify({
    kr_title: params.krTitle,
    members: params.memberShortNames,
    previous_declarations: params.previousDeclarations,
    transcript: params.transcript,
  });

  const text = await callExtractAI(WIN_SESSION_EXTRACT_PROMPT, userMessage, params.attachment);
  const parsed = parseJsonSafe<unknown>(text);
  return validateWinSession(parsed);
}

// ===== freeform セッション抽出 =====

function validateFreeform(data: unknown): ExtractedFreeformSession {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスがオブジェクトではありません。");
  const d = data as Record<string, unknown>;
  if (typeof d.summary !== "string") throw new Error("summaryがstringではありません。");
  if (!Array.isArray(d.decisions)) throw new Error("decisionsが配列ではありません。");
  for (const x of d.decisions as unknown[]) {
    if (typeof x !== "string") throw new Error("decisions要素がstringではありません。");
  }
  if (!Array.isArray(d.kr_mentions)) throw new Error("kr_mentionsが配列ではありません。");
  for (const m of d.kr_mentions as unknown[]) {
    if (!m || typeof m !== "object") throw new Error("kr_mentions要素がオブジェクトではありません。");
    const mm = m as Record<string, unknown>;
    if (typeof mm.kr_title_hint !== "string") throw new Error("kr_title_hintがstringではありません。");
    if (typeof mm.note !== "string") throw new Error("noteがstringではありません。");
  }
  if (!Array.isArray(d.follow_up_tasks)) throw new Error("follow_up_tasksが配列ではありません。");
  for (const t of d.follow_up_tasks as unknown[]) {
    if (!t || typeof t !== "object") throw new Error("follow_up_tasks要素がオブジェクトではありません。");
    const tt = t as Record<string, unknown>;
    if (typeof tt.member_short_name !== "string") throw new Error("member_short_nameがstringではありません。");
    if (typeof tt.content !== "string") throw new Error("contentがstringではありません。");
    if (tt.due_date !== null && typeof tt.due_date !== "string") throw new Error("due_dateの型が不正です。");
  }
  return d as unknown as ExtractedFreeformSession;
}

export async function extractFreeformSession(params: {
  krTitle: string;
  allKrTitles: string[];
  memberShortNames: string[];
  transcript: string;
  attachment?: FileAttachment;
}): Promise<ExtractedFreeformSession> {
  const userMessage = JSON.stringify({
    kr_title: params.krTitle,
    all_kr_titles: params.allKrTitles,
    members: params.memberShortNames,
    transcript: params.transcript,
  });

  const text = await callExtractAI(FREEFORM_EXTRACT_PROMPT, userMessage, params.attachment);
  const parsed = parseJsonSafe<unknown>(text);
  return validateFreeform(parsed);
}
