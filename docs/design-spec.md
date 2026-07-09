# Markdown Knowledge Board 設計仕様

作成日: 2026-07-09

## 1. 概要

Markdown Knowledge Board は、Markdown 形式のノートをブラウザ内で管理するローカル専用の React アプリケーションである。

主な目的は以下。

- Markdown ノートの作成、編集、保存、削除
- タイトル、タグ、本文によるノート管理
- Markdown ファイルのインポート、エクスポート
- IndexedDB によるローカル永続化
- Markdown プレビューとタスクチェックの更新
- 全ノートのバックアップ出力

外部 API 通信は行わず、データはブラウザの IndexedDB に保存する。

## 2. 技術構成

### 2.1 フロントエンド

- React
- TypeScript
- Vite
- CSS Modules ではなく通常の CSS ファイル

### 2.2 主なライブラリ

- `idb`: IndexedDB 操作
- `js-yaml`: YAML frontmatter の読み書き
- `react-markdown`: Markdown プレビュー
- `remark-gfm`: GitHub Flavored Markdown 対応
- `remark`, `remark-parse`: Markdown AST 関連処理

### 2.3 npm scripts

- `npm run dev`: Vite 開発サーバー起動
- `npm run build`: TypeScript build と Vite production build
- `npm run lint`: ESLint 実行
- `npm run preview`: Vite preview 起動

## 3. アプリケーション構成

### 3.1 エントリポイント

- `src/main.tsx`
  - React アプリを DOM に mount する。

### 3.2 主要 UI

- `src/App.tsx`
  - 画面全体の state と UI を管理する。
  - ノート一覧、検索、タグフィルタ、インポート、バックアップ、編集、プレビュー、保存、削除、エクスポートを扱う。

### 3.3 スタイル

- `src/index.css`
  - 全体の font、box sizing、body、root 高さを定義する。
- `src/App.css`
  - sidebar、editor、preview、toolbar、tag UI、button、responsive layout を定義する。

### 3.4 ドメイン/ユーティリティ

- `src/lib/types.ts`
  - `Note` 型を定義する。
- `src/lib/db.ts`
  - IndexedDB の初期化、取得、保存、削除を担当する。
- `src/lib/frontmatter.ts`
  - Markdown frontmatter の parse/export を担当する。
- `src/lib/markdownEdit.ts`
  - Markdown 編集補助を担当する。
- `src/lib/markdownTasks.ts`
  - タスク行の検出とチェック状態切替を担当する。
- `src/lib/taskAst.ts`
  - remark ベースのタスク行検出実装。現状の `App.tsx` からは参照されていない。

## 4. データ設計

### 4.1 Note

```ts
export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
};
```

### 4.2 フィールド仕様

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `id` | `string` | ノートを識別する一意 ID。`crypto.randomUUID()` が使える場合はそれを使用する。 |
| `title` | `string` | ノートタイトル。保存時に空の場合は `Untitled` になる。 |
| `body` | `string` | Markdown 本文。 |
| `tags` | `string[]` | ノートに紐づくタグ。重複判定は小文字化した値で行う。 |
| `updatedAt` | `number` | 更新日時。Unix epoch milliseconds。 |

## 5. 保存設計

### 5.1 IndexedDB

保存先はブラウザの IndexedDB。

| 項目 | 値 |
| --- | --- |
| DB 名 | `markdown-knowledge-board` |
| DB version | `1` |
| object store | `notes` |
| keyPath | `id` |

### 5.2 DB 操作

- `getAllNotes()`
  - 全ノートを取得する。
- `getNote(id)`
  - 指定 ID のノートを取得する。
- `saveNote(note)`
  - `notes` store に `put` する。
- `deleteNote(id)`
  - 指定 ID のノートを削除する。

DB 初期化に失敗した場合は `dbInitError` にエラーメッセージを保持し、UI 側で `Status: IndexedDB error` とエラー表示を行う。

## 6. 画面仕様

### 6.1 全体レイアウト

画面は以下の 2 ペイン構成。

- 左: sidebar
- 右: editor

desktop 幅では横並び。
`max-width: 900px` 以下では `.app` を縦方向に切り替える。

### 6.2 Sidebar

sidebar には以下を配置する。

- `+ New Note`
  - 新規ノートを作成し、編集状態にする。
- `Backup All Notes`
  - 全ノートを Markdown ファイルとして出力する。
  - ノートが 0 件の場合は disabled。
- Search
  - title/body の部分一致検索。
- Tag filter
  - カンマ区切りでタグ条件を入力する。
  - 入力された全タグを含むノートだけを表示する。
- Import
  - `.md` または `text/markdown` ファイルを複数選択して取り込む。
- Notes
  - フィルタ後のノート一覧を表示する。
  - 0 件の場合は `No notes yet.` または `No matches.` を表示する。

### 6.3 Editor header

editor header には以下を配置する。

- アプリタイトル: `Markdown Knowledge Board`
- 保存状態表示
- `Save`
- `Export`
- `Delete`

保存状態の表示仕様は以下。

| 条件 | 表示 |
| --- | --- |
| IndexedDB エラーあり | `Status: IndexedDB error` |
| 未保存変更あり | `Status: Unsaved changes` |
| ノート選択中かつ未保存変更なし | `Status: Saved` |
| ノート未選択 | `Status: No note` |

### 6.4 編集フォーム

編集フォームは以下で構成する。

- Title
  - ノートタイトル入力。
- Tags
  - タグチップ表示。
  - 入力欄で Enter を押すとタグ追加。
  - 既存ノート由来のタグ候補を表示。
- Body
  - Markdown 本文入力。
- Markdown toolbar
  - `Bold`
  - `Italic`
  - `Strike`
  - `Code`
  - `H1`
  - `H2`
  - `Bullet`
  - `Task`
  - `Quote`
  - `Link`

### 6.5 Edit / Preview

`activeTab` により `Edit` と `Preview` を切り替える。

- `Edit`
  - Markdown toolbar と textarea を表示する。
- `Preview`
  - `ReactMarkdown` で `draftBody` を表示する。
  - 本文が空の場合は `プレビューする内容がありません` を表示する。

## 7. 機能仕様

### 7.1 初期表示

1. IndexedDB から全ノートを取得する。
2. `updatedAt` の降順で `notes` に保持する。
3. IndexedDB 初期化エラーがあれば `dbError` に反映する。
4. `localStorage.lastBackupAt` を確認し、未バックアップまたは 7 日以上経過している場合はバックアップメッセージを表示する。

### 7.2 新規ノート作成

`+ New Note` を押すと以下を行う。

1. 空の `Note` を作成する。
2. `notes` の先頭に追加する。
3. 作成したノートを選択状態にする。
4. draft state を空のノート内容で初期化する。
5. `isDirty` を `true` にする。

現状では、新規ノートは `Save` するまで IndexedDB には保存されない。

### 7.3 ノート選択

ノート一覧からノートを選択すると以下を行う。

1. 未保存変更または未確定タグ入力がある場合、`window.confirm("変更を保存しますか？")` を表示する。
2. OK の場合は現在の draft を保存する。
3. Cancel の場合は選択処理を中断する。
4. 対象ノートを選択し、draft state を対象ノートの内容でリセットする。

### 7.4 編集

Title、Tags、Body、Markdown toolbar の操作により draft state を更新する。

編集が発生すると以下を行う。

- `isDirty = true`
- `draftUpdatedAt = 現在時刻`
- `isDirtyRef.current = true`

### 7.5 タグ

タグ追加仕様:

- 入力値を trim する。
- 空文字は追加しない。
- 既存タグと小文字化比較して重複していれば追加しない。
- 未保存変更として扱う。

保存時は `tagInput` に未確定入力が残っている場合もタグとして取り込む。

### 7.6 保存

`Save` を押すと以下を行う。

1. `draftTitle`, `draftBody`, effective tags を取得する。
2. title/body/tags がすべて空の場合は何もしない。
3. title が空の場合は `Untitled` とする。
4. `selectedId` があれば同じ ID で保存し、なければ新しい ID を作成する。
5. `saveNote(note)` で IndexedDB に保存する。
6. `notes` を対象ノートで更新し、`updatedAt` 降順に並べる。
7. `selectedId` を保存したノート ID にする。
8. `isDirty = false` にする。
9. `draftTags` を保存後タグに更新し、`tagInput` を空にする。

### 7.7 削除

`Delete` を押すと以下を行う。

1. 選択中ノートがなければ何もしない。
2. `window.confirm` で削除確認する。
3. OK の場合は IndexedDB から削除する。
4. `notes` から対象ノートを取り除く。
5. 選択状態と draft state をリセットする。

### 7.8 インポート

`Import Markdown` から複数 Markdown ファイルを選択できる。

各ファイルについて以下を行う。

1. file text を読む。
2. YAML frontmatter を parse する。
3. title は frontmatter の `title`、本文中の H1、ファイル名の順で決定する。
4. body は frontmatter 除去後の本文を使う。frontmatter がなければファイル全文を使う。
5. tags は frontmatter の `tags` が文字列配列の場合のみ復元する。
6. updatedAt は frontmatter の `updatedAt` を number または parse 可能な date string として復元する。なければ現在時刻。
7. IndexedDB に保存する。
8. 取り込んだノートを `notes` に追加し、`updatedAt` 降順に並べる。

### 7.9 エクスポート

`Export` は選択中ノートを Markdown ファイルとして出力する。

出力内容:

- YAML frontmatter
  - `title`
  - `tags`
  - `updatedAt`
- body
  - body が H1 で始まらない場合、`# {note.title}` を本文先頭に追加する。

ファイル名は title を使い、Windows で使えない文字は `_` に置換する。

### 7.10 全ノートバックアップ

`Backup All Notes` は全ノートに対して Markdown export と同じ内容を個別ファイルとして連続ダウンロードする。

実行後:

- `localStorage.lastBackupAt` に現在時刻の ISO 文字列を保存する。
- `backupMessage` を消す。

### 7.11 Markdown toolbar

toolbar 操作は textarea の selection/cursor を基準に本文を変更する。

- `wrapSelection`
  - 選択範囲に prefix/suffix を付与または解除する。
- `toggleLinePrefix`
  - カーソル位置の行に H1/H2/Bullet/Task/Quote などの prefix を付与または解除する。
- `insertLink`
  - 選択範囲または placeholder から Markdown link を挿入する。

`handleWrap` は選択範囲がない場合は何もしない。

### 7.12 Preview タスクチェック

Preview では `remark-gfm` により task list を表示する。

実装仕様:

- `input` は `ReactMarkdown` の component override で表示しない。
- `li.task-list-item` に対して独自の `taskCheckbox` を表示する。
- AST position の開始行から本文の行番号を求める。
- `toggleTaskAtLine` により `- [ ]` と `- [x]` を切り替える。
- 同一テキストが複数あっても行番号ベースで対象を決定する。

## 8. Frontmatter 仕様

### 8.1 parse

Markdown が `---` で始まり、2 つ目の `---` が存在する場合、そこまでを YAML frontmatter として扱う。

対応する frontmatter fields:

- `title`: string の場合のみ採用
- `tags`: string 配列の場合のみ採用
- `updatedAt`: number または parse 可能な date string の場合のみ採用

frontmatter が存在しない、または閉じ delimiter が存在しない場合は、全文を body として扱う。

### 8.2 export

export 時は常に frontmatter を出力する。

例:

```markdown
---
title: Example
tags:
  - memo
updatedAt: 2026-07-09T00:00:00.000Z
---
# Example

Body text
```

## 9. 状態管理

`App.tsx` が以下の state を保持する。

| state | 内容 |
| --- | --- |
| `notes` | ノート一覧 |
| `selectedId` | 選択中ノート ID |
| `draftTitle` | 編集中タイトル |
| `draftTags` | 編集中タグ |
| `tagInput` | 未確定タグ入力 |
| `draftBody` | 編集中本文 |
| `draftUpdatedAt` | 編集中更新日時 |
| `isDirty` | 未保存変更有無 |
| `dbError` | IndexedDB 初期化エラー |
| `searchQuery` | 検索語 |
| `tagFilter` | タグフィルタ入力 |
| `backupMessage` | バックアップ通知 |
| `activeTab` | `edit` または `preview` |

`isDirtyRef` はノート選択時の非同期保存確認に使う。

## 10. エラー/異常系仕様

### 10.1 IndexedDB 初期化失敗

- `dbInitError` にエラーメッセージを保持する。
- UI にエラーメッセージを表示する。
- `Save` は disabled になる。

### 10.2 空ノート保存

title/body/tags がすべて空の場合、保存処理は何もしない。

### 10.3 import 異常

現状、YAML parse エラーやファイル単位の import 失敗を UI に明示する仕様はない。
例外が発生した場合は処理が中断する可能性がある。

### 10.4 export/backup 異常

現状、download 成功/失敗の検知や結果通知はない。

## 11. レスポンシブ仕様

現状の CSS 仕様:

- desktop:
  - `.app` は横並び flex。
  - `.sidebar` は幅 `320px`、高さ `100vh`、縦スクロール。
  - `.editor` は残り幅、 高さ `100vh`、内部 overflow hidden。
- `max-width: 900px`:
  - `.app` は縦並び。
  - `.sidebar` は幅 `100%`。
  - `.editor` 側の高さ/overflow は desktop 仕様が残る。

## 12. 現状の制約

現状仕様として以下の制約がある。

- 外部 API 通信やクラウド同期はない。
- データ保存はブラウザ/プロファイル単位の IndexedDB に依存する。
- 新規ノートは `Save` まで IndexedDB に保存されないが、一覧には表示される。
- ノート切替時の未保存確認は `保存して移動` と `移動中止` の 2 択であり、破棄して移動する選択肢はない。
- import/export/backup の結果通知や失敗通知は限定的。
- backup はノートごとの複数ファイル連続 download であり、zip 化はしていない。
- Preview のタスクチェック UI は `span` クリックであり、キーボード操作や ARIA 属性は未整備。
- 画面文言は英語と日本語が混在している。
- mobile 幅では editor の高さ/overflow 仕様により、操作領域の扱いを見直す余地がある。

## 13. 検証観点

### 13.1 機能観点

- ノート作成、保存、選択、削除ができること。
- title/body/tags の編集内容が保存後に復元できること。
- search と tag filter が組み合わせて動作すること。
- Markdown import/export が frontmatter を含めて動作すること。
- Preview で Markdown と GFM task list が表示されること。
- Preview のタスクチェック切替が本文の該当行を更新すること。

### 13.2 非機能観点

- IndexedDB が使えない場合に UI が破綻しないこと。
- build/lint/audit が通ること。
- 大量ノートまたは長文 Markdown でも操作不能にならないこと。

### 13.3 データ観点

- `Note` の `id`, `title`, `body`, `tags`, `updatedAt` が欠けないこと。
- frontmatter の invalid data を誤って採用しないこと。
- 同名タグ、大小文字違いタグの重複扱いが一貫すること。
- import/export 後に Markdown 本文が意図せず変形しないこと。

### 13.4 UI 観点

- desktop と mobile で主要操作に到達できること。
- 保存状態がユーザーに誤解されないこと。
- 削除、未保存変更、バックアップなどの確認/通知が十分であること。
- キーボード操作とスクリーンリーダー利用に必要な semantics があること。

