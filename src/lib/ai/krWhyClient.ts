// src/lib/ai/krWhyClient.ts
//
// 【設計意図】
// 5Whys（なぜなぜ分析）を対話形式で進めるAI機能。
// ダイアログターン（短い問い返し）とサマリー生成の2種類の呼び出しを持つ。
// KR/TF/ToDo/Task/メンバーデータをAIに渡す（ラボ機能例外ルール適用）。

import { invokeAI } from "./invokeAI";

export type WhyMessage = { role: "user" | "assistant"; content: string };

const DIALOGUE_SYSTEM_PROMPT = `あなたはOKR推進チームのソクラテス式コーチAIです。
5Whys手法を使って、担当者が抱える課題の根本原因を一緒に探ります。

【与えられるコンテキスト】
ユーザーの最初のメッセージには以下が含まれています：
- 現在クォーター・Objective・全KR一覧
- 対象KRのTF/ToDo/タスク状況（担当者・期日・進捗ステータス）
- 週次シグナル推移（🟢/🟡/🔴 の連続パターン）
- ウィンセッションの学び・外部環境変化の記録
タスクが止まっている・シグナルが連続して悪化している・担当者が偏っているなど、
コンテキストの具体的な事実を根拠として問いを深めてください。

【対話のルール】
- 返答は必ず「問い返し」1文だけにする（説明・評価・アドバイスは一切しない）
- ユーザーの回答の核心を短く言い換えてから、その一歩奥を尋ねる
  例：「○○ということですね。では、なぜ○○が起きているのでしょうか？」
- シグナルが複数週連続で同じ色の場合は言及する
  例：「4週連続🔴でした。なぜその状態が続いているのでしょうか？」
- 表面的・曖昧な答えには「もう少し具体的に教えてください。例えば…？」と深掘り
- バリエーションを使う：「なぜ」「背景には」「そうなっている原因は」「その判断をした理由は」

【禁止】
- 解決策・アドバイスの提案
- 「なるほど」「おっしゃる通り」などの評価コメント
- 一度に複数の質問`;

const SUMMARY_SYSTEM_PROMPT = `あなたはOKR推進チームの分析AIです。
5Whys対話の全記録と、OKR・タスク・シグナル推移のコンテキストを受け取り、
根本原因の分析サマリーを生成します。

出力形式（マークダウン。コードブロックは使わない）：

## 根本原因（仮説）
対話とコンテキストから浮かび上がった核心的な原因を1〜2文で。
シグナルの連続パターンや、ウィンセッションで言及された外部変化なども根拠として使う。

## この問題の構造
表面的な課題の背後にある構造・パターンを2〜3文で説明。
タスク状況・担当者・期日・シグナル推移など具体的な事実を根拠として使う。

## 再発防止のために見直すべき点
- 見直し点1（プロセス・役割・習慣・外部要因の観点から）
- 見直し点2（同上）

## 今週動けるアクション
- アクション1：【担当】誰が・何を・いつまでに（名前が特定できる場合は明記）
- アクション2：同上（最大3件）`;

async function callAI(system: string, messages: WhyMessage[], maxTokens: number): Promise<string> {
  const res = await invokeAI(system, messages, maxTokens);
  return res.content[0].text;
}

export async function callWhyDialogue(messages: WhyMessage[]): Promise<string> {
  return callAI(DIALOGUE_SYSTEM_PROMPT, messages, 350);
}

export async function callWhySummary(context: string, conversation: WhyMessage[]): Promise<string> {
  const dialogueLog = conversation
    .filter(m => m.role !== "user" || !m.content.includes("この課題について、なぜなぜ分析を進めてください"))
    .map(m => `${m.role === "user" ? "担当者" : "AI"}: ${m.content}`)
    .join("\n");

  const summaryMessage: WhyMessage = {
    role: "user",
    content: `【コンテキスト】\n${context}\n\n【なぜなぜ対話記録】\n${dialogueLog}\n\n以上の対話とコンテキストから根本原因分析サマリーを生成してください。`,
  };
  return callAI(SUMMARY_SYSTEM_PROMPT, [summaryMessage], 2000);
}
