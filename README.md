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
- Delete で削除時に確認ダイアログが出ます。
- tags は export 時に YAML フロントマターとして出力されます。
- import でフロントマターがあれば tags を復元します。
- Edit/Preview タブで編集とMarkdownプレビューを切り替えられます。
- Preview は本文（body）をそのままMarkdown表示するため、タイトルは二重表示しません。
- EditタブのBody上部にMarkdownツールバーがあり、選択範囲やカーソル位置に記法を挿入できます。
- タスクのチェックは本文の該当行（- [ ] / - [x]）を更新します。ASTの行番号を使うため、同じテキストが複数あっても行位置ベースで切り替わります。

## データ保存先

- ブラウザの IndexedDB（DB名: `markdown-knowledge-board`）に保存します。

## 設計ドキュメント

- [現行設計仕様](./docs/design-spec.md)
- [フェーズ2 認証・クラウドバックアップ要件定義](./docs/phase2-auth-cloud-backup-requirements.md)
- [フェーズ2 認証・クラウドバックアップ基本設計](./docs/phase2-auth-cloud-backup-architecture.md)
- [フェーズ2 API・認証詳細設計](./docs/phase2-auth-cloud-backup-api-design.md)
- [フェーズ2 フロントエンド詳細設計](./docs/phase2-auth-cloud-backup-frontend-design.md)
- [フェーズ2 実装計画・ゲート・PR分割](./docs/phase2-auth-cloud-backup-implementation-plan.md)

2026年8月3日時点で、フェーズ2の任意GitHub認証、手動の暗号化Gistバックアップ、復号プレビュー後のsafe merge復元まで実装済みです。Production有効化は未実施のため、cloud feature flagは既定offです。IndexedDBをローカルデータの正本とし、未ログイン・認証エラー・オフラインでも従来の編集、保存、JSONバックアップ／インポートを利用できます。GitHub認証・クラウド機能はVercel Productionの2つの本番Originだけで提供し、Preview環境ではローカル機能だけを有効にします。

## 制限事項

- cloud feature flagが既定offの間、通常利用では外部API通信を開始しません。
- cloud feature flagを有効化する前のため、実GitHub Gistを使うProduction経路の結合確認は未実施です。
- ブラウザのストレージ容量の制限に依存します。
