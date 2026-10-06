# 実装・文書整合監査

確認日: 2026-10-06（日本時間）

照合元: GitHubの`origin/main`と一致する`c10cf11b2c1cf6f8ba77f85740241124e727a8a5`。監査開始時に追跡済みMarkdownはREADMEを含む29ファイル。実装、設定、テスト定義、文書状態、相対リンクを照合した。本書は機能の再受入検証ではなく、現在のコードと説明の整合確認を記録する。

## 1. 確認観点

詳細確認の前に以下の観点を設定した。優先順位は、誤った保存・復元手順によるデータ消失、暗号化／認証の誤認、実装状態と検証状態の混同、操作・参照先の不足の順とした。

| 分類 | 観点・検証意図 |
| --- | --- |
| 機能 | 実装済みの入口、操作、対象外機能がREADME・現行設計から分かること |
| 非機能 | offline、Origin分離、認証・通信、印刷／PWAの環境差、非同期・競合の制約を過大に保証しないこと |
| データ | IndexedDB正本、未保存draft、JSON／暗号化backup／非暗号化Markdownの違い、復元・更新規則を混同しないこと |
| UI | メニュー名、タブ、確認dialog、focus、mobile遷移、処理中表示をコードと一致させること |

| 区分 | 照合内容 |
| --- | --- |
| 正常系 | 編集・保存・Import・各Export・backup・safe merge・PWAの入口と結果 |
| 異常系 | 保存失敗、誤passphrase、認証エラー、外部画像未解決、offline、権限不足時の制約 |
| 境界値 | 画像5 MiB／20 MiB、15秒timeout、暗号化4,500,000 bytes、文字倍率、複数Importの最初の成功 |
| 状態遷移 | 未保存確認、自動選択の開始／完了条件と操作世代、接続期限切れ／再接続、明示PWA更新 |

## 2. 実装と文書の対応・修正内容

| 機能・構成 | 実装根拠（リポジトリ内） | 文書対応 |
| --- | --- | --- |
| ローカル保存・任意クラウド | `src/lib/db.ts`、`cloudCapability.ts`、`src/hooks/useGoogleDrive.ts` | READMEと設計概要の「ローカル専用／外部通信なし」を修正。自動同期なしを維持 |
| Markdown／text Import・本文置換 | `src/lib/noteImport.ts`、`src/components/ImportChoiceDialog.tsx`、`src/App.tsx` | READMEの「実装予定」を訂正。新ID登録と本文だけの置換を説明 |
| Import後の自動選択 | `src/App.tsx`の`importFiles`、`importInteractionRevisionRef` | README・設計に追記。要件文書にPR #47のmain取り込みを反映 |
| 検索・タグ・固定・未保存確認 | `src/App.tsx`、`src/lib/tagSuggestions.ts` | Filterの操作、Pin、3択の未保存確認を現行説明へ同期 |
| Markdown編集・Metadata・目次 | `src/components/MarkdownBodyEditor.tsx`、`MarkdownToolbarMenu.tsx`、`MetadataDialog.tsx`、`MarkdownPreview.tsx` | READMEの機能案内・詳細設計リンクを補完。既存詳細文書の実装済み状態を確認 |
| Mermaid／Marp | `src/lib/mermaidRenderer.ts`、`src/components/MarpSlides.tsx` | READMEへ表示・設定を追記。Slides専用出力がないことを明示 |
| Styled HTML／PDF | `src/components/StyledExportView.tsx`、`StyledDocument.tsx`、`src/lib/styledExport/` | READMEと現行設計へ一時設定・画像検査・出力を追記 |
| 印刷タイトル・ページ番号 | `src/App.css`、`src/components/StyledExportView.tsx` | 通常印刷とStyled印刷の違い、`counter(page) " / " counter(pages)`、ブラウザ依存を要件・詳細設計へ追記 |
| GitHub認証・Gist backup／restore | `api/auth/`、`api/cloud-backups/`、`src/hooks/useCloudBackup.ts`、`useCloudRestore.ts` | main取り込み済みの修正を「反映前」とする記述、マージ済みPR #27をDraftとする記述を更新 |
| cloud UI・API adapter | `src/components/cloud/`、`api/auth/csrf.ts` | 存在しないdialogファイル名を実際の3 componentへ訂正。独立Sign out廃止とFetch adapterを記載 |
| Google Drive | `src/lib/googleIdentity.ts`、`googleDrive.ts`、`googleDriveOperations.ts` | 要件の未実装記述を更新。メニュー・処理中表示を詳細設計へ追記。実サービス検証未実施を維持 |
| PWA | `vite.config.ts`、`vercel.json`、`src/pwa/` | レビュー初版／実装着手前／vercel.json未作成を訂正。過去計画と現在の配信確認を区別 |
| 公開情報ページ | `public/about.html`、`privacy.html`、`terms.html`、`legal.css` | README・現行設計に案内とPWA fallback除外を追記 |
| 旧版・検討記録 | Styled Export v0.2、Drive初期検討、UI/UX改善仕様案 | 履歴を保持し、現在の要件・設計への案内を明確化 |

新規ImportとJSON backupの取り込みは同じ更新規則ではない。新規Markdownは新IDを作り、JSON backupは同IDの内容を更新する。cloud restoreは差分確認後のsafe mergeを使う。この違いをREADMEに明記した。

本文置換も状態に依存する。未保存DraftではBodyだけを変更してSaveを待ち、保存済みノートでは未保存確認後に置換内容を保存する。Markdown exportは現在のdraftを出力するだけでIndexedDBを更新しない。これらの保存タイミングもコードで照合した。

## 3. GitHub・本番の確認

- `git fetch origin`後、監査開始時の`HEAD...origin/main`は双方0 commit差分。
- GitHubのPR #27、#33、#42、#45、#47は`MERGED`。Google Drive・公開情報ページ・Import自動選択の実装がmainに含まれることを確認。
- `https://mkb.bamboosato.com/`と`https://markdown-knowledge-board.vercel.app/`はHTTP 200。両HTMLは`/manifest.webmanifest`を参照し、同じ`/assets/index-C3Uvm9s8.js`を配信していた。
- 配信JSにStyled Export、Google Drive、`Cloud backup and account`のUI実装を確認。文字列の存在は認証設定や実操作の成功を証明しない。
- 両Originの`/sw.js`はJavaScriptとしてHTTP 200、Workbox precacheコードを含み、`Cache-Control: no-cache, max-age=0, must-revalidate`を返した。PWAの資産配信確認であり、install／offline再起動／updateの実操作確認ではない。

## 4. 検証範囲・残る確認

今回の変更はMarkdown文書のみ。相対リンクの参照先、実装ファイル名・UI名称・固定値、差分の空白を検査した。`[label](url)`などの記法例は実リンク検査から除外した。READMEから現行要件・設計へ到達できることも確認した。

- 文書リンク検査: 30ファイル、119相対リンク、参照先の欠落0件。
- 差分に追加したリポジトリルートからの実装ファイルパス: 12件、欠落0件。
- 新しく導入した見出し重複: 0件。既存の例示や別節の同名見出しは保持。
- `git diff --check`: 成功。
- 変更対象: README・設計・要件・監査記録の計19文書。アプリコード・設定の変更0件。

E2E実施範囲: **未実施**。動作コード・設定を変更しておらず、今回の検証意図は文書整合であるため。unit／build／lintも再実行しない。既存文書のテスト件数は過去の実行証跡として保持し、今回の結果と混同しない。

次の項目は今回の監査で完了に変更しない。

- Google実アカウントのOAuth、Picker、Drive API書き込み・復元、外部アプリのMarkdown参照／更新追従。
- Android Chrome／iPhone Safariの実機install、launcher、OS終了後offline起動。
- Windows実機のIME手動確認。
- GitHub本番の実上限サイズ・大容量・実mobile性能。
- 本番の認証／backup／restore、PWA更新、印刷dialog／PDFのブラウザ操作再検証。

作業前から未追跡の`docs/chatgpt-shared-link-import-feasibility.md`と`docs/pwa-jump-list-feasibility.md`は編集・公開対象に含めない。
