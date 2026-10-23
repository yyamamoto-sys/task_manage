## 9. 未解決の設計論点

| 番号 | 論点 | 優先度 | 備考 |
|---|---|---|---|
| A | KRの進捗率の計算ロジック（手動 vs 自動） | 高 | ダッシュボードのバーに影響 |
| B | ツアー吹き出しの位置指定をpx固定→要素基準に変更 | 中 | Teams埋め込みでズレる |
| D | Teamsへの埋め込みに伴うウィンドウサイズ対応 | 中 | — |
| E | マイルストーン実装（設計完了・帰宅後に実施） | 中 | 下記Section 3-5参照。4ファイル変更が必要 |
| F | PDF出力の実装方法（サーバーサイド vs Print API） | 低 | 将来検討 |
| G | OKR周辺テーブル（kr_sessions/kr_declarations/kr_meeting_notes/kr_note_tf_entries/okr_analyses/kr_reports/quarterly_objectives/quarterly_kr_task_forces）のRLSが部署分離未対応 | 中 | Section 1.6参照。**コア階層（objectives/key_results/task_forces/todos）はv3.03（2026-07-24）でDBレベルの部署分離（RLS＋自動注入トリガー）完了。UI側の表示絞り込みもv3.02で網羅完了済み。** 残るのはOKR周辺テーブルのみ。第2弾でまとめて対応する方針 |

---
