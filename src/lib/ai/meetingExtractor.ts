// src/lib/ai/meetingExtractor.ts
//
// 【設計意図】
// 会議の文字起こし（VTT/SRT/テキスト）から新規タスク・ステータス更新候補を
// AIで抽出する。ラボ機能例外ルール適用：PJ・タスク・メンバー情報をAIに渡す。

import { invokeAI, buildMessageContent, type FileAttachment } from "./invokeAI";
import { getMondayAnchors } from "../date";

// ===== 型定義 =====

export interface MeetingTask {
  name: string;
  assignee_short_name: string | null;
  start_date: string | null;     // YYYY-MM-DD or null（着手予定日。ガント表示の起点）
  due_date: string | null;       // YYYY-MM-DD or null
  project_hint: string | null;   // プロジェクト名のヒント（AIが推測）
  priority: "high" | "mid" | "low" | null;
  source_quote: string;          // 根拠となる発言の引用（30文字以内）
}

export interface MeetingStatusUpdate {
  task_name_hint: string;        // 既存タスク名のヒント
  suggested_task_id: string | null;
  new_status: "todo" | "in_progress" | "done";
  reason: string;
  source_quote: string;
}

export interface MeetingAnalysis {
  summary: string;
  new_tasks: MeetingTask[];
  status_updates: MeetingStatusUpdate[];
  decisions: string[];
  risks: string[];
}

// ===== VTT / SRT / テキストパーサー =====

export function parseTranscript(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const result: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  let skipBlock = false;

  const flush = () => {
    const text = currentText.join(" ").trim();
    if (!text) return;
    result.push(currentSpeaker ? `${currentSpeaker}: ${text}` : text);
    currentText = [];
    currentSpeaker = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "WEBVTT" || line.startsWith("WEBVTT ")) continue;
    if (line.startsWith("NOTE")) { skipBlock = true; continue; }
    if (skipBlock) { if (line === "") skipBlock = false; continue; }

    // SRT シーケンス番号（数字のみの行）
    if (/^\d+$/.test(line)) continue;

    // タイムスタンプ行（VTT / SRT）
    if (/^\d{2}:\d{2}[:.,]\d{2,3}\s*-->\s*/.test(line)) continue;

    if (line === "") { flush(); continue; }

    // VTT <v Speaker> タグ
    const vTag = line.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/);
    if (vTag) {
      const speaker = vTag[1].trim();
      const text = stripHtml(vTag[2]).trim();
      if (currentSpeaker !== speaker) { flush(); currentSpeaker = speaker; }
      if (text) currentText.push(text);
      continue;
    }

    // "発言者: テキスト" パターン
    const colonPattern = line.match(/^([^:：]{1,30})[：:](.+)/);
    if (colonPattern) {
      const speaker = colonPattern[1].trim();
      const text = stripHtml(colonPattern[2]).trim();
      if (currentSpeaker !== speaker) { flush(); currentSpeaker = speaker; }
      if (text) currentText.push(text);
      continue;
    }

    // プレーンテキスト
    const text = stripHtml(line).trim();
    if (text) currentText.push(text);
  }

  flush();
  return result.join("\n");
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, "");
}

// ===== システムプロンプト =====

const SYSTEM_PROMPT = `あなたは会議の文字起こしを解析して、タスク管理情報を抽出するAIです。
現在のプロジェクト・タスク・メンバー情報と文字起こしテキストを受け取り、
以下を構造化JSONで返してください。

【抽出する項目】
1. summary: 会議の要約（2〜3文。何が話され、何が決まったか）
2. new_tasks: 「やること」「確認する」「対応する」など新しいアクションとして言及されたもの
3. status_updates: 既存タスクの「完了した」「着手した」「詰まっている」などの進捗言及
4. decisions: 会議で決定・合意されたこと
5. risks: 言及されたリスク・懸念・問題

【new_tasks 抽出ルール】
- assignee_short_nameは受け取ったメンバーリストのshort_nameからマッチするものを選ぶ（不明はnull）
- start_dateは「明日から」「来週月曜から」「すぐ着手」などをYYYY-MM-DD形式に変換（推測できなければnull）。明示が無くてもタスクの性質と期日から逆算して妥当な着手日を推定して構わない（ガント表示のため）
- due_dateは「今週中」「〇日まで」などをYYYY-MM-DD形式に変換（推測できなければnull）
- start_dateとdue_dateが両方ある場合、start_date <= due_date を必ず守ること
- **【曜日の確認必須】** 日付を決める際は context.monday_anchors（月曜日リスト）を参照すること。リスト内は全て月曜日。+1=火、+2=水、+3=木、+4=金、+5=土（稼働日外）、+6=日（稼働日外）。start_date・due_dateに土日を充てないこと
- project_hintはプロジェクトリストから関連しそうな名前を選ぶ（不明はnull）
- priorityは文脈から「急ぎ」「重要」「できれば」などを high/mid/low に変換（不明はnull）
- source_quoteは根拠となる発言を30文字以内で

【status_updates 抽出ルール】
- suggested_task_idはタスクリストから最もマッチするタスクのID（不明はnull）
- new_statusは"todo"/"in_progress"/"done"のいずれか

出力はJSONのみ。コードブロック\`\`\`は絶対に使わない。

{
  "summary": "...",
  "new_tasks": [
    {
      "name": "タスク名",
      "assignee_short_name": "山田" | null,
      "start_date": "2026-04-20" | null,
      "due_date": "2026-05-01" | null,
      "project_hint": "プロジェクト名" | null,
      "priority": "high" | "mid" | "low" | null,
      "source_quote": "根拠となる発言"
    }
  ],
  "status_updates": [
    {
      "task_name_hint": "タスク名のヒント",
      "suggested_task_id": "uuid" | null,
      "new_status": "done",
      "reason": "理由",
      "source_quote": "根拠となる発言"
    }
  ],
  "decisions": ["決定事項1"],
  "risks": ["リスク1"]
}`;

// ===== AI 抽出 =====

export interface ExtractMeetingParams {
  transcript: string;
  projects: { id: string; name: string }[];
  tasks: { id: string; name: string; assignee: string; status: string; due_date: string | null }[];
  members: { short_name: string }[];
  today: string;
  /** PDF等の添付（テキスト起こしが無く添付ファイルで渡す場合）。Word(.docx)はクライアント側でテキスト化してから transcript に入れる */
  attachment?: FileAttachment | null;
}

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

function validateAnalysis(data: unknown): MeetingAnalysis {
  if (!data || typeof data !== "object") throw new Error("AIレスポンスが不正な形式です。");
  const d = data as Record<string, unknown>;
  if (typeof d.summary !== "string") throw new Error("summaryが取得できませんでした。");
  if (!Array.isArray(d.new_tasks)) throw new Error("new_tasksが取得できませんでした。");
  if (!Array.isArray(d.status_updates)) throw new Error("status_updatesが取得できませんでした。");
  if (!Array.isArray(d.decisions)) throw new Error("decisionsが取得できませんでした。");
  if (!Array.isArray(d.risks)) throw new Error("risksが取得できませんでした。");
  return d as unknown as MeetingAnalysis;
}

export async function extractMeetingData(params: ExtractMeetingParams): Promise<MeetingAnalysis> {
  const userMessage = JSON.stringify({
    today: params.today,
    monday_anchors: getMondayAnchors(),
    members: params.members.map(m => m.short_name),
    projects: params.projects.map(p => ({ id: p.id, name: p.name })),
    tasks: params.tasks.map(t => ({
      id: t.id,
      name: t.name,
      assignee: t.assignee,
      status: t.status,
      due_date: t.due_date,
    })),
    transcript: params.transcript || (params.attachment ? `（添付ファイル「${params.attachment.fileName}」を会議の文字起こし／議事メモとして参照してください）` : ""),
  });

  // 添付（PDF等）がある場合は document/image ブロックとして同梱（テキスト添付なら本文に追記される）
  const content = buildMessageContent(userMessage, params.attachment ?? null);
  const res = await invokeAI(SYSTEM_PROMPT, [{ role: "user", content }], 4096, "meeting-extract");
  const text = res.content[0].text;
  return validateAnalysis(parseJsonSafe<unknown>(text));
}
