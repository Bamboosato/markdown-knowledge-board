# MKB PDF出力品質改善 追加要件定義書 v0.1
2026-10-29 / Phase 1 / レビュー用

## 目的と対象
既存の簡易 `Print / PDF` と `Export Styled HTML / PDF…` を維持し、日本語組版、改ページ、描画準備判定、回帰品質を改善する。pfpdfは参考実装とし、Vivliostyleやpfpdfを追加依存にしない。

## 現行の前提
簡易印刷は `src/App.tsx` の `handlePrint` / `waitForPrintableContent` と `src/App.css` の印刷CSSを使用。A4、見出しや表の分割抑制、未保存draft反映は実装済み。Styled Exportは `StyledExportView` / `StyledDocument` を利用し、21 Color、8 Design、11文字倍率、画像安全検査、HTML出力を持つ独立経路。両経路の統合は行わない。

## 必須要件
| ID | 要件 | 受け入れ基準 |
|---|---|---|
| PDF-01 | 日本語の禁則、括弧、句読点、英数字混在、長いURLの組版改善 | テスト文書で文字欠落・横はみ出しなし。ブラウザ差異は記録 |
| PDF-02 | 見出し孤立と長大表・コード・引用・Mermaidの改ページ改善 | 2ページ超の要素でも文字欠落・重なりなし。表見出し反復は対応環境で確認 |
| PDF-03 | 印刷準備結果を ready/fallback/failed/timeout に区別 | readyと安全確認済fallbackのみ印刷。failed/timeoutは理由を表示し印刷しない |
| PDF-04 | 共通化できる印刷CSS規則と回帰テストの整備 | 通常Preview、Styled HTML、Styled印刷の既存外観と安全性を維持 |
| PDF-05 | 既存2経路の役割整理 | 簡易印刷とカスタムStyled Exportを残し、既存操作と設定を維持 |

## 詳細な制約
- 画像は `complete` だけでなくdecode/描画可否を判定。Mermaid失敗時は既存のコードfallbackを尊重する。
- 現行の最大10秒待機を初期基準とする。変更は実測で判断。フォント待機が上限を超えた場合も無条件にready扱いしない。
- 印刷キャンセル・例外・afterprint未発火時にbusyを残さず、保存成功を推測しない。
- ノート本文、Note型、IndexedDB、dirty判定、バックアップ、クラウド同期、Slides機能を変更しない。
- raw HTMLを有効化しない。危険URL・SVG・外部画像の検査を緩和しない。新たな外部送信を加えない。
- PWAオフライン、未保存draft、390px画面、キーボード操作を維持する。

## テスト観点
AC-01 日本語禁則・長いURL、AC-02 長大表/コード、AC-03 巨大Mermaid/画像、AC-04 timeoutで印刷抑止、AC-05 fallback/失敗表示、AC-06 未保存draftと保存状態不変、AC-07 cancel/例外/afterprint欠落、AC-08 Styled単一HTMLの外部資産要求0、AC-09 オフライン、AC-10 Chromium E2EおよびSafari/iPhone/Android実機差異記録。

## 対象外
表紙、目次、複数ノート結合、ページ番号、デザイン追加、PDF直接生成、Vivliostyle導入（Phase 2/3）。

## 未決事項
禁則・表ヘッダー反復のブラウザ別保証範囲、巨大図の縮小限界、フォントタイムアウト時の代替フォント許容条件。実測結果に基づいて決定する。

## v0.2追補（PR #55レビュー対応）
### PDF-01 / PDF-02 合格条件の具体化
- 対応対象ブラウザの固定fixtureにおいて、句読点・閉じ括弧等の行頭禁則文字が行頭に現れず、開き括弧等の行末禁則文字が行末に孤立しないこと。文字欠落・横はみ出しがないことだけでは合格としない。
- 見出しがページ最終行に孤立せず、後続の本文が同一ページに少なくとも1行続くこと。ただし後続がない末尾見出し等は別ケースとして判定する。
- 日本語括弧・句読点、英数字混在、長URL、ページ境界付近の見出しを含む固定Markdown fixtureを用意し、生成PDFのページ境界・行頭行末を目視確認する。自動検証できない項目は手動ゲートとして記録する。
- ブラウザの組版制約による例外は、OS/ブラウザ/版、再現fixture、期待との差分、回避策、許容判断を記録し、無条件に合格扱いしない。
### PDF-03 経路別の準備・失効
- 簡易Print/PDFでは準備中に選択ノートが変わった場合、その試行を失効し旧DOMを印刷しない。
- Styled Exportは開いた時点の固定snapshotを維持し、ノート選択変更だけでは失効しない。Styled画面終了/unmountまたは新しい出力セッション開始で旧試行を失効する。
- Styled Exportは印刷操作後だけでなく、印刷ボタン有効化前のMermaid初期化待機にも期限と終了状態（ready/fallback/failed/timeout）を設ける。期限切れでは無限待機せず理由と再試行手段を表示する。既存の安全なコードfallbackのみ許容する。
### 追加受け入れテスト
AC-11 簡易印刷の準備中にノートを切替えても旧ノートを印刷しない。AC-12 Styled準備中のノート切替では固定snapshotを保持する。AC-13 Styled初期化でMermaidが完了しないfixtureがtimeoutとなり、操作可能状態へ復帰し再試行できる。
