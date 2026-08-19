# Markdown Knowledge Board

Local-only Markdown knowledge board built with React + Vite + TypeScript.

## 起動方法

依存関係のインストール:

```bash
npm install
```

開発サーバー起動:

```bash
npm run dev
```

ビルド:

```bash
npm run build
```

## 使い方

- 左ペインの Import Markdown から .md を複数選択して取り込みます。
- 検索ボックスはタイトルと本文の部分一致です。
- Tag filter はカンマ区切りで指定します。
- ノートを選択すると右ペインで編集できます。
- Save で保存、Export で選択中ノートを .md として出力します。
- More actions の `Print / PDF` で、選択中ノートのPreview本文全体をブラウザの印刷プレビューへ渡せます。PDFとして保存する場合は、ブラウザ／OSの印刷画面で保存先を選択します。
- Delete で削除時に確認ダイアログが出ます。
- tags は export 時に YAML フロントマターとして出力されます。
- import でフロントマターがあれば tags を復元します。
- Edit/Preview タブで編集とMarkdownプレビューを切り替えられます。
- Preview は本文（body）をそのままMarkdown表示するため、タイトルは二重表示しません。
- EditタブのBody上部にMarkdownツールバーがあり、選択範囲やカーソル位置に記法を挿入できます。
- タスクのチェックは本文の該当行（- [ ] / - [x]）を更新します。ASTの行番号を使うため、同じテキストが複数あっても行位置ベースで切り替わります。

## データ保存先

- ブラウザの IndexedDB（DB名: `markdown-knowledge-board`）に保存します。
- PWAをアンインストールした場合やブラウザのsite dataを消去した場合に、ローカルノートが保持されるかはOS／ブラウザに依存します。重要なノートは事前に`Backup All Notes`でJSONへ保存してください。

## PWA・オフライン利用

- ProductionではApplication menuの`Install App`からインストールできます。iPhone Safariでは`Install Help`に従ってホーム画面へ追加します。
- 初回オンライン起動でoffline準備が完了した後は、ブラウザやインストール済みアプリを閉じてもofflineで再起動できます。
- offline中もIndexedDBのノート編集、保存、Preview、Mermaid、Slides、ローカルimport／exportを利用できます。GitHub認証とCloud Backup／Restoreには接続が必要です。
- 新版は自動reloadせず、`Update available`から`Restart to update`を選んだときだけ適用します。未保存変更があれば、保存成功後に更新します。
- 通常の`npm run dev`と`npm run build`ではService Workerを生成・登録しません。PWA専用のローカル確認は次を使用します。

```bash
npm run build:pwa:test
npm run verify:pwa
npm run test:e2e:pwa
```

## 設計ドキュメント

- [現行設計仕様](./docs/design-spec.md)
- [Markdown Import／表示中ノート更新 要件（実装予定）](./docs/markdown-import-current-note-update-requirements.md)
- [フェーズ2 認証・クラウドバックアップ要件定義](./docs/phase2-auth-cloud-backup-requirements.md)
- [フェーズ2 認証・クラウドバックアップ基本設計](./docs/phase2-auth-cloud-backup-architecture.md)
- [フェーズ2 API・認証詳細設計](./docs/phase2-auth-cloud-backup-api-design.md)
- [フェーズ2 フロントエンド詳細設計](./docs/phase2-auth-cloud-backup-frontend-design.md)
- [フェーズ2 実装計画・ゲート・PR分割](./docs/phase2-auth-cloud-backup-implementation-plan.md)
- [フェーズ3 PWA要件定義](./docs/phase3-pwa-requirements.md)
- [フェーズ3 PWA基本・詳細設計](./docs/phase3-pwa-design.md)
- [フェーズ3 PWA実装計画](./docs/phase3-pwa-implementation-plan.md)
- [フェーズ3 PWA実機手動チェックリスト](./docs/phase3-pwa-device-checklist.md)

2026年8月3日時点で、フェーズ2の任意GitHub認証、手動の暗号化Gistバックアップ、復号プレビュー後のsafe merge復元、offline・390×844・キーボード／focus・主要3ブラウザ回帰を実装済みです。Productionではcloud feature flagを有効化し、GitHub Appの本番2 callback、expiring user token、`Gists: write`、GitHub／session用環境変数を設定済みです。両本番Originで実OAuth、secret Gistの初回作成、検出、暗号文取得、復号、safe merge復元、既存Gistの重複なし更新を確認しました。IndexedDBをローカルデータの正本とし、未ログイン・認証エラー・オフラインでも従来の編集、保存、Markdown／JSONのimport/exportを利用できます。

## 制限事項

- GitHub認証・クラウド機能はVercel Productionの`https://mkb.bamboosato.com/`と`https://markdown-knowledge-board.vercel.app/`だけで提供します。Preview環境とlocalhostではローカル機能だけを利用できます。
- 実Gistの初回作成、復元、既存Gistを重複作成しない更新はProductionで確認済みです。
- 4,500,000 bytes成功／4,500,001 bytes拒否はunitテストで固定済みです。Productionでの実上限サイズ試験は追加品質確認として未実施です。
- Cloud Backup／Restore開始時のGist再検出と復号ダイアログの横スクロール修正は主要3ブラウザで回帰済みですが、Production反映前です。
- ブラウザのストレージ容量の制限に依存します。
- PWAはProduction環境変数`VITE_PWA_ENABLED=true`を設定したbuildだけで有効になります。Preview deploymentと通常localhostではService Workerを登録しません。
- Android Chrome／iPhone Safariの最終実機確認は[実機手動チェックリスト](./docs/phase3-pwa-device-checklist.md)に従って実施します。
