# MKB Local MCP：末尾追記・文字列置換

- 更新日：2026-11-17
- 状態：runtime 0.5.0へ実装。契約をAPI設計書へ統合。

仕様案で合意した末尾追記・既定の単一置換・明示指定の全件置換は、[API設計書（確定版）の7A・7B節](./local-mcp-note-access-spec.md)を参照してください。要求・正常応答・エラー応答のJSON例、競合チェック、永続receipt、旧版との互換性も同書に集約しています。

- `append_note`は改行を自動挿入せず、本文末尾にtextを追加します。
- `replace_note_text`は既定single、明示mode=allで全件置換。想定一致件数の指定は不要で、成功時にreplacement_countを返します。
- singleは重なりも含め完全一致1か所だけで実行。allは左から右の非重複一致を1回で処理します。0件は両方で更新しません。
- revision照合と同一request_id再送保証を継承します。mode省略とsingle明示は同じ入力として扱います。

公開・検証結果は実装PRを参照してください。旧仕様案を別のAPI契約として維持しません。
