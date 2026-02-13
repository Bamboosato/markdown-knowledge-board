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

## 制限事項

- 外部API通信は行いません（完全ローカル）。
- ブラウザのストレージ容量の制限に依存します。
