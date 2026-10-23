## 28. 個人OKR取込のAI呼び出しを2回に分割（実行時間起因の546再発対策・v3.46・2026-08-10）

**症状（Section 27の続き）**：v3.45でPDFのクライアント側テキスト抽出とmax_tokens=8192への引き下げを行った後も、山本さんが実データで取込を試したところ「テキストだけで抽出は行われた」（テキスト抽出自体は成功）が、**しばらく時間が経った後に同じ546 WORKER_RESOURCE_LIMIT**になった。ペイロードのサイズではなく、個人四半期KR（最大8本×6本文欄）と月次計画・振り返り（最大8本×3か月×計画/振り返り両方）を**1回の呼び出しで抽出していたことによる生成時間の積み重ね**が原因（Section 19 ⑧）。

**対応：抽出を2回の呼び出しに分割した**（`src/lib/ai/personalOkrImportExtractor.ts`）。

- **呼び出し1（`extractPersonalOkrQuarterlyData`）**：資料の種類の判定（`detected_doc_type`）＋KR単位の基本情報（KR種別・ラベル・ウェイト・6本文欄）。**常に実行する**（月次振返り記録でも6本文欄は「KR_四半期OKRから転記」列に同じ内容が転記されているため、この呼び出しだけで拾える）。
- **呼び出し2（`extractPersonalOkrMonthlyData`）**：月次の計画・振り返り。呼び出し1の`detected_doc_type`が`"monthly_review"`のときだけ実行する（四半期OKRのみの資料には月次情報が無いため呼ぶ意味が無く、呼び出しを1回減らせる）。呼び出し1自体が失敗したときは種別が分からないため保険的に実行する。
- **マージは純粋関数に分離**：`mergePersonalOkrImportResults(quarterly, monthly)`が、`source_label`→`label`→同一インデックスの順でKRと月次データを対応づける（両呼び出しは同じKintone画面を同じ順序で読むため、ラベルが一致しなくても位置で対応づけられる可能性が高い）。対応が見つからないmonthly側のグループはデータを失わないよう末尾に追加する。
- **片方が失敗しても、成功した方をそのまま確認画面に出す**（全部やり直しにしない）。`extractPersonalOkrImportData()`のオーケストレーターが呼び出しごとにtry/catchし、失敗した方は`warnings: string[]`に理由を積んで返す（両方失敗したときだけ例外を投げる）。`PersonalOkrImportModal.tsx`のレビュー画面に⚠️の警告ボックスとして表示する。
- **max_tokensは8192のまま**（分割で1回あたりの生成量が減るため足りる見込み。Section 6-1c）。
- **進捗表示**：`onProgress`コールバックで`{current, total, label}`（"1/2 個人KRを抽出中"→"2/2 月次計画を抽出中"→完了）を呼び出し元へ伝える。従来の時間ベースの演出（`AIProgressLoader`）から、実際の呼び出し完了状況を表すもの（`SaveProgressLoader`を流用）に差し替えた（無言で長時間待たせないため）。
- **モデル切替の余地を残した（既定は変えない）**：`invokeAI()`に`model`引数（省略可）を追加し、Edge Function側の`ALLOWED_MODELS`（`claude-sonnet-4-6`/`claude-haiku-4-5`）から指定できるようにした。`personalOkrImportExtractor.ts`の`PERSONAL_OKR_IMPORT_MODEL`定数（1箇所）が既定値（`claude-sonnet-4-6`）を持つ。呼び出し分割でも546が続く場合は、この定数を`"claude-haiku-4-5"`に変えると生成が速くなる（コメントに明記済み）。
- **抽出文字数を画面に出す（診断・事前警告）**：`src/lib/personalOkr/importCharWarning.ts`の`isPersonalOkrImportTextTooLong()`（純粋関数）が、入力欄・添付から抽出した文字数（`MAX_TEXT_CHARS=40000`で切り詰めた後の実際に送信する文字数）が20000字を超えるかを判定する。20000字は「40000字の上限内でも546が再発した」という事実から安全側に倒した値（既存上限の半分。根拠は同ファイル冒頭コメント）。解析実行前（入力欄）・解析成功後（レビュー画面）の両方に表示し続ける（今後の切り分けに使うため、コンソールログではなく画面に出す）。閾値超えは「量が多いため、四半期OKRと月次振返りを別々に取り込むことをお勧めします」という行動が分かる警告文を添える。
- **テスト**：`personalOkrImportExtractor.test.ts`を分割後の構成に合わせて再構成（呼び出し1・2をそれぞれ独立にテスト＋`mergePersonalOkrImportResults`の純粋関数テスト＋オーケストレーターの呼び出し省略・進捗・部分失敗・全滅を検証）。新規`importCharWarning.test.ts`（閾値の境界値）。
- **やらないこと**：Edge Function自体のストリーミング化（対象外）。`OkrImportModal.tsx`／`MeetingImportPanel.tsx`の独自PDF送信経路（Section 19 ⑦の既知リスクのまま・別途）。

---
