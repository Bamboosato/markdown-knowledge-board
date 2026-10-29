# Codex実装指示書：MKB PDF品質改善 Phase 1

対象repo: `Bamboosato/markdown-knowledge-board`
作業範囲: [要件定義](./pdf-print-quality-phase1-requirements-v0.1.md) と [画面・処理設計](./pdf-print-quality-phase1-screen-processing-design-v0.1.md) の PDF-01〜05。

## 手順
1. 最新mainを取得し、`AGENTS.md`、`docs/design-spec.md`、`docs/markdown-knowledge-board-styled-export-design.md` と既存テストを読む。文書と実装が異なる場合は差異を報告する。
2. 作業用ブランチ `feat/pdf-print-quality-phase1` を作る。既存の簡易印刷とStyled Exportの責務を保持し、設計差分を最小化する。
3. 印刷待機処理をテスト可能な関数へ分離し、ready/fallback/failed/timeout、理由、二重実行防止、例外とafterprint未発火のcleanupを実装。タイムアウトで無条件に印刷しない。
4. 既存2経路のCSSを調査し、日本語禁則、見出し孤立、長大表・コード・図の欠落防止を改善。意匠トークンを無理に共通化しない。
5. 正常/異常/境界fixtureとunit/E2Eを追加。未保存draft、印刷キャンセル、オフライン、Styled HTMLセキュリティを回帰確認する。
6. `npm ci`、lint、unit、build、対象Playwright E2E、security auditを実行。必要なら既存CI規約に従う。失敗や実機未検証を明記。
7. 要件と設計の実装結果、ブラウザ制約、テスト対応表をdocsに追記。PRを作成し、レビュー待ちで止める。ユーザーの明示承認なしにmergeしない。

## 禁止事項
- pfPDF/Vivliostyleを導入しない。
- Note/IndexedDB/バックアップ形式、dirty判定、通常Markdown編集、Slidesを変更しない。
- Styled Exportの画像・リンク・SVG安全性を緩和しない。
- 新たな外部通信、raw HTML実行、保存完了の推測通知を追加しない。
- Phase 2の表紙/目次/複数ノート結合に着手しない。

## PR記載必須
変更概要、要件ID別対応、変更ファイル、テストコマンドと結果、PDF比較結果、既知制約、未実施の実機試験、セキュリティ/プライバシー影響、レビュー論点。
