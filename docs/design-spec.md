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
desktop 幅では document と workspace に縦横スクロールを発生させず、Sidebar と Editor の各領域内でスクロールを管理する。Sidebar はノート一覧が表示高を超えた場合のみ縦スクロールし、横スクロールは発生させない。Editor の本文・Preview・Slidesも必要な領域内だけを縦スクロールさせる。

### 6.2 Sidebar

sidebar には以下を配置する。

- `+ New Note`
  - 新規ノートを作成し、編集状態にする。
  - 右隣に Markdown Import アイコンボタンを配置する。
  - アイコンの accessible name と Tooltip は `Import Markdown` とし、`.md`、`.markdown`、`.txt` ファイルを複数選択できる。
  - アイコンは `lucide-react` の `FileDown` を使用する。
- Notes
  - `Filter` ボタンを表示する。
  - Search または Tag filter が有効な場合、`Filter (n)` として有効条件数を表示する。
  - Search または Tag filter が有効な場合、`Clear` ボタンを表示し、modal を開かずに全条件を解除できる。
  - 件数は条件なしでは `n notes`、条件ありでは `filtered of total notes` と表示する。
  - フィルタ後のノート一覧を表示する。
  - ノート自体が 0 件の場合は `No notes yet.` を表示する。
  - フィルタ結果が 0 件の場合は `No notes match your filters.` と `Clear Filters` を表示する。

### 6.2.1 Filter modal

`Filter` ボタン押下で Search / Tags 条件を設定する modal dialog を表示する。

- Search
  - title/body の部分一致検索。
- Tags
  - 選択済みタグをチップとして表示する。
  - タグチップの角丸は共通の `8px` とし、カプセル型にはしない。
  - 各タグチップの `×` で個別解除できる。
  - 入力欄フォーカス時に既存ノート由来のタグ候補をドロップダウン表示する。
  - 候補は入力文字で絞り込み、選択済みタグを除外する。
  - 候補表示は最大 8 件とする。
  - 候補はタグ名昇順で表示し、大小文字は区別せず並べる。
  - 候補はクリック、ArrowUp / ArrowDown、Enter で選択できる。
  - Escape、入力欄外フォーカス、入力欄/候補以外のタップで候補を閉じる。
  - 候補がない場合、候補ドロップダウンは表示しない。
- 条件の適用
  - modal を開いた時点で、現在の適用済み条件を一時条件へコピーする。
  - modal 入力中は modal 内の件数だけ更新し、Note 一覧にはまだ反映しない。
  - `Apply Filters` で一時条件を Note 一覧へ反映して modal を閉じる。
  - `Cancel`、背景クリック、Esc で一時条件を破棄して modal を閉じる。
  - `Clear Filters` は modal 内の一時 Search / Tags 条件を空にする。
  - Search と Tags は AND 条件で絞り込む。

### 6.3 Editor header

editor header には以下を配置する。

デスクトップでは画面全幅の固定ヘッダーバーとして1行表示し、タイトル、保存・バックアップ状態、操作ボタンを配置する。Sidebar と Editor はヘッダーバーの下に並べる。幅が不足する場合は操作領域を横スクロール可能にしてボタンの折り返しを防ぐ。モバイルでは操作性を維持するため複数行を許容しつつ、画面上端への固定を維持する。

- アプリタイトル: `Markdown Knowledge Board`
- タイトル左の application menu
  - トリガーには `lucide-react` の `Menu` を使用する。
  - `Backup All Notes`: 全ノートを単一 JSON バックアップとして出力する。ノートが 0 件の場合も空バックアップを出力する。
  - `Import Backup`: `.json` バックアップファイルのみ複数選択して取り込む。
- 保存状態表示
- `Save`: 最も使用頻度の高い主操作としてラベル付きボタンを維持する。
- `Save` には `Ctrl+S`（Windows / Linux）および `Command+S`（macOS）のキーボードショートカットを割り当て、ブラウザ標準のページ保存動作を抑止する。
- `Revert changes`: `RotateCcw` アイコンボタンとして `Save` の右側に配置し、未保存変更がない場合は無効にする。
- `More actions`: `MoreHorizontal` アイコンボタンとして配置し、以下の低頻度操作をメニュー表示する。
  - `Export`: `Download` アイコンとラベルを表示する。
  - 区切り線の後に `Delete`: `Trash2` アイコンと赤いラベルを表示する。確認ダイアログと Undo の仕様は維持する。
- アイコンボタンには同名の英語 accessible name と Tooltip を設定する。メニューは項目選択、外側クリック、Escape で閉じ、Escape 時はトリガーへフォーカスを戻す。
- アイコンボタンの枠線は共通色・1px、Lucideアイコンは共通色・2pxの線幅に統一する。disabled時もアイコンのopacityは下げず、淡い背景色とカーソルで無効状態を表現して視認性を維持する。

保存状態の表示仕様は以下。

| 条件 | 表示 |
| --- | --- |
| 保存失敗 | 赤色のドット + `Save failed` |
| 保存処理中 | 青色のドット + `Saving` |
| 新規ノート | 灰色のドット + `Draft` |
| 未保存変更あり | 橙色のドット + `Unsaved` |
| ノート選択中かつ未保存変更なし | 青色のドット + `Saved` |
| ノート未選択 | 灰色のドット + `No note` |

スクリーンリーダー向けには各表示の先頭へ `Status:` を付与し、色だけに依存せず状態名でも識別できるようにする。

### 6.4 編集フォーム

編集フォームは以下で構成する。

- Title
  - ノートタイトル入力。
- Tags
  - タグチップ表示。
  - タグ未選択時は追加文言を表示せず、入力欄 placeholder のみで空状態を表現する。
  - 入力欄で Enter を押すとタグ追加。
  - 入力欄フォーカス時に既存ノート由来のタグ候補をドロップダウン表示する。
  - Editor の候補ドロップダウンは入力欄の左端に合わせ、幅は最大 `360px`、入力欄が狭い場合は入力欄幅に収める。
  - 候補は選択済みタグを除外し、入力文字で絞り込む。
  - 候補表示は最大 8 件とする。
  - 候補はクリック、ArrowUp / ArrowDown、Enter で選択できる。
  - Escape または入力欄外フォーカスで候補を閉じる。
- Title / Tags
  - 入力内容を読み取りやすくするため縦2行に配置する。
  - 各行はラベルと入力欄を横並びにして、Body 上部の占有高さを抑える。
  - 編集画面の表示ラベルをタップしても入力欄へフォーカスさせない。
  - 入力欄へのフォーカスは入力欄自体をタップした場合のみ行う。
- Body
  - Markdown 本文入力。
  - Body ラベルをタップしても本文入力欄へフォーカスさせない。
- Markdown toolbar
  - Body 見出し行に常時表示する。
  - PC 幅では Body ラベルの右側に配置し、左端を Title / Tags の入力欄左端に揃える。
  - モバイル幅では Body ラベルの下側に配置し、左端を Title / Tags の入力欄左端に揃える。
  - モバイル幅では入力欄列の範囲内に収まるよう、ボタン幅と間隔をさらに抑える。
  - モバイルなどページスクロールが発生する環境では Body 見出し行ごと sticky として追従する。
  - 表示は省スペースな記号/略号とし、操作名は `aria-label` と `title` で保持する。
  - `B`: Bold
  - `I`: Italic
  - `S`: Strike
  - `<>`: Code
  - `H1`: H1
  - `H2`: H2
  - `-`: Bullet
  - `[ ]`: Task
  - `>`: Quote
  - `[]`: Link

### 6.5 Edit / Preview

`activeTab` により `Edit` と `Preview` を切り替える。

- `Edit`
  - Title / Tags を表示する。
  - Markdown toolbar と textarea を表示する。
- `Preview`
  - Preview 表示領域を広げるため、Title / Tags は表示しない。
  - 選択中のタブで表示モードを判別できるため、表示領域内に重複する `Preview` 見出しは表示しない。
  - `ReactMarkdown` で `draftBody` を表示する。
  - `mermaid` fenced code block は Mermaid 図として表示する。
  - Mermaid 図は `Diagram` / `Code` を切り替えられる。
  - 本文が空の場合は `プレビューする内容がありません` を表示する。

## 7. 機能仕様

### 7.1 初期表示

1. IndexedDB から全ノートを取得する。
2. `updatedAt` の降順で `notes` に保持する。
3. IndexedDB 初期化エラーがあれば `dbError` に反映する。
4. `localStorage.lastBackupAt` を確認し、アプリメニューの `Backup All Notes` の下に `Last backup` と分単位の日時を2段で表示する。未実施時は `No backups yet` と表示する。
5. Backup項目のアイコンは複数行全体の中央ではなくタイトル行の上端へ揃え、メニュー項目間はコンパクトな余白を維持する。

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

#### 7.6.1 キーボードショートカット

主要操作には以下のキーボードショートカットを割り当てる。

| 操作 | Windows / Linux | macOS | 動作 |
| --- | --- | --- | --- |
| Save | `Ctrl+S` | `Command+S` | `Save` ボタンと同じ保存処理を実行し、ブラウザ標準のページ保存を抑止する |
| New Note | `Alt+N` | `Alt+N` | `+ New Note` ボタンと同じ新規作成処理を実行する |

- 入力欄にフォーカスがある場合もショートカットを有効とする。
- Save は `Shift` または `Alt`、New Note は `Control`、`Command` または `Shift` を同時に押した組み合わせを対象外とする。
- キー長押しで発生する repeat イベントはブラウザ標準動作を抑止したうえで処理しない。
- 保存処理中は Save / New Note の両ショートカットを処理しない。
- modal dialog 表示中は背後の Save / New Note を実行しない。
- 未保存変更がある状態で New Note を実行した場合は、通常の `+ New Note` と同じく `Save and Continue` / `Discard and Continue` / `Cancel` の確認を行う。
- 対応するボタンには `aria-keyshortcuts` を設定し、支援技術へ割り当てを伝える。

### 7.7 Revert

`Revert` は編集中の未保存変更を、現在のノートを読み込んだ時点の内容へ戻す。

1. 未保存変更または未確定タグ入力がなければ disabled。
2. 押下時に `window.confirm` で確認する。
3. 保存済みノートの場合、`selectedNote` の title / tags / body / updatedAt を draft state に戻す。
4. 新規 draft の場合、draft 作成時の初期状態へ戻す。
5. 保存済みノートは `Status: Saved` に戻り、新規 draft は `Status: Draft` のまま残る。
6. `tagInput`、保存エラー表示、dirty 状態を復元結果に合わせてリセットする。

### 7.8 削除

`Delete` を押すと以下を行う。

- ブラウザ標準の確認ダイアログは使用せず、ノート名、`Cancel`、`Delete Note` を含むアプリ内 modal dialog を表示する。
- `Cancel`、背景クリック、Esc では削除せずに閉じ、More actions ボタンへフォーカスを戻す。
- `Delete Note` で削除を確定し、既存の Undo 可能時間を開始する。

1. 選択中ノートまたは未保存 draft がなければ何もしない。
2. `window.confirm` で削除確認する。
3. OK の場合は `notes` から対象ノートを取り除く。
4. 選択状態と draft state をリセットする。
5. `Note deleted` 通知と `Undo` 操作を 8 秒間表示する。
6. Undo した場合は対象ノートを元の一覧位置とエディタへ復元する。
7. Undo 期限を過ぎた場合は IndexedDB から削除を確定する。

### 7.9 インポート

Sidebar の `Import Markdown` から複数の `.md`、`.markdown`、`.txt` ファイル、application menu の `Import Backup` から複数 JSON バックアップファイルを選択できる。PC では Edit の Body 領域へ Markdown / text ファイルをドラッグ＆ドロップしても、`Import Markdown` と同じ処理を実行する。Body への挿入や置換ではなく、各ファイルをノートとして追加または更新する。両導線は選択可能な拡張子を分離するが、取込後の未保存確認、重複判定、保存、結果表示は共通とする。

各ファイルについて以下を行う。

1. file text を読む。
2. `.json` の場合はバックアップ形式を検証し、含まれる各ノートの Markdown を parse する。
3. `.md`、`.markdown`、`.txt` の場合は YAML frontmatter を parse する。frontmatter がなければファイル全文を本文として扱う。
4. `id` は frontmatter またはバックアップメタデータから復元し、なければ新規作成する。
5. `.md`、`.markdown`、`.txt` の title は frontmatter の `title`、ファイル名の順で決定する。本文中の H1 はTitle決定には使用せず本文に残す。JSONバックアップはバックアップメタデータ、Markdown frontmatter、本文中の H1、ファイル名の順で決定する。
6. body は frontmatter 除去後の本文を使う。frontmatter がなければファイル全文を使う。
7. tags は frontmatter の `tags` が文字列配列の場合のみ復元する。
8. updatedAt は frontmatter の `updatedAt` を number または parse 可能な date string として復元する。なければ現在時刻。
9. 重複判定は `id` を優先し、次に現行データモデルで扱える `title + updatedAt` の一致を見る。
10. 同一内容なら skipped、差分があれば updated、重複がなければ added として IndexedDB に保存する。
11. import 結果ダイアログで added / updated / skipped / failed を表示する。
12. 失敗したファイルはファイル名と理由を表示し、成功分は保存する。

### 7.10 エクスポート

`Export` は選択中ノートを Markdown ファイルとして出力する。

出力内容:

- YAML frontmatter
  - `id`
  - `title`
  - `tags`
  - `updatedAt`
- body
  - body が H1 で始まらない場合、`# {note.title}` を本文先頭に追加する。

ファイル名は title を使い、Windows で使えない文字は `_` に置換する。

### 7.11 全ノートバックアップ

`Backup All Notes` は全ノートを単一 JSON ファイルとしてダウンロードする。

出力内容:

- `app`: `markdown-knowledge-board`
- `version`: `1`
- `createdAt`: バックアップ作成日時
- `noteCount`: ノート件数
- `notes[]`
  - `id`
  - `title`
  - `tags`
  - `updatedAt`
  - `markdown`: Markdown export と同じ frontmatter 付き本文

実行後:

- 保存完了を検知できた場合は `Backup Complete` を表示し、ファイル名、件数、完了時刻を表示する。
- 保存ダイアログがキャンセルされた場合は結果ダイアログを表示せず、`localStorage.lastBackupAt` は更新しない。
- 保存完了を検知できないブラウザ fallback では `Backup Ready` を表示し、ファイル生成と browser download 開始までを通知する。
- `Backup Complete` または `Backup Ready` の場合のみ `localStorage.lastBackupAt` に現在時刻の ISO 文字列を保存し、メニュー内の最終バックアップ日時を更新する。

### 7.12 Markdown toolbar

toolbar 操作は textarea の selection/cursor を基準に本文を変更する。
toolbar は `lucide-react` の `Bold`、`Italic`、`Strikethrough`、`Code`、`List`、`ListTodo`、`Quote`、`Link` を使用し、スクリーンリーダーや tooltip では各操作名を維持する。見出しレベルは文字自体の識別性を優先し、`H1` / `H2` ラベルを維持する。
toolbar は横スクロール領域にせず、幅が不足する場合はボタンを折り返す。これによりスクロールバーを表示せず、ボタンの tooltip を toolbar 外へクリップせずに表示する。
画面左右端にある操作の tooltip はボタンの内側端を基準に配置し、狭い画面でも viewport 外へはみ出さないようにする。
toolbar は Body の編集補助であるため、Body 見出し行内に配置する。

Body 見出し行の右端には集中編集モードの切替ボタンを配置する。

- 通常時は `Maximize2`、accessible name / Tooltip は `Expand editor` とする。
- 拡大時は `Minimize2`、accessible name / Tooltip は `Restore editor` とする。
- 拡大時は固定ヘッダーを残し、Sidebar、Edit / Preview / Slides タブ、Title / Tags / Slides 設定を隠して、Bodyパネルをヘッダー直下の workspace 全体へ拡大する。
- 拡大／復帰には同一documentの View Transitions APIを使用する。API非対応時または `prefers-reduced-motion: reduce` の場合はアニメーションなしで状態を切り替える。
- Escapeでも通常表示へ復帰できる。本文、未保存状態、selection、本文内スクロール位置は切替前後で維持する。

- `wrapSelection`
  - 選択範囲に prefix/suffix を付与または解除する。
- `toggleLinePrefix`
  - カーソル位置の行に H1/H2/Bullet/Task/Quote などの prefix を付与または解除する。
- `insertLink`
  - 選択範囲または placeholder から Markdown link を挿入する。

Phase 3 時点では Markdown toolbar の無選択時挙動明確化は保留とする。現時点では `handleWrap` は選択範囲がない場合は何もしない。Bold / Italic / Strike / Code の無選択時プレースホルダー挿入、または disabled 表示は後続改善で扱う。

### 7.13 UI 文言

アプリ画面に表示される UI 文言は英語で統一する。対象はボタン、ラベル、通知、確認ダイアログ、空状態、エラー文言とする。仕様書本文、テスト名、開発者向けコメントや内部識別子は対象外とする。

### 7.14 Preview タスクチェック

Preview では `remark-gfm` により task list を表示する。
desktopでは `html` / `body` / `#root` のoverflowを固定し、Preview切替時を含めてdocument側のスクロールバーを表示しない。Previewが表示高を超える場合は `.mdPreview-scroll` の内部だけを縦スクロールさせる。mobileではdocumentの縦スクロールを維持する。

実装仕様:

- `input` は `ReactMarkdown` の component override で表示しない。
- `li.task-list-item` に対して `button.taskCheckbox` を表示する。
- `taskCheckbox` は `role="checkbox"`、`aria-checked`、操作内容を含む `aria-label` を持つ。
- Space / Enter / click で同じ切り替え処理を実行する。
- フォーカス時は可視アウトラインを表示する。
- AST position の開始行から本文の行番号を求める。
- `toggleTaskAtLine` により `- [ ]` と `- [x]` を切り替える。
- 切り替え後は本文を更新し、保存状態を `Unsaved changes` にする。
- 同一テキストが複数あっても行番号ベースで対象を決定する。

### 7.15 Preview Mermaid 表示

Preview では fenced code block の言語が `mermaid` の場合に Mermaid 図として表示する。Mermaid 表示は Preview 専用であり、保存形式、Import / Export / Backup の Markdown データ構造は変更しない。

実装仕様:

- `mermaid` dependency を dynamic import し、Mermaid block が存在する場合のみ renderer を読み込む。
- Mermaid renderer は `startOnLoad: false`、`theme: "default"`、`securityLevel: "strict"` で初期化する。
- Mermaid block の初期表示は `Diagram` とする。
- block header に `Mermaid` ラベルと `Diagram` / `Code` 切替ボタンを表示する。
- `Code` 表示では元の Mermaid code を表示する。
- 空 code block は `Empty Mermaid diagram.` を表示する。
- 50KB を超える Mermaid code は自動 render せず、`Diagram is too large to render automatically.` と code fallback を表示する。
- レンダリング中は `Rendering diagram...` を表示する。
- レンダリング失敗時は `Unable to render Mermaid diagram.` とエラー概要を block 内に表示する。
- SVG を DOM に挿入する前に script、foreignObject、event handler 属性、危険な URL を除去する。
- レンダリングは block 単位で独立して扱い、1 つの失敗で Preview 全体を破綻させない。
- Mermaid 表示状態、Code / Diagram 切替、render error はノートの dirty 状態を変更しない。

### 7.16 Slides 表示

Slides は Marp 対応 Markdown をプレゼンテーションとして閲覧する表示モードである。Slides 表示は表示専用であり、スライド生成結果や現在のスライド番号は保存しない。Marp On/Off、size、theme、page number 表示、heading divider はノート metadata として YAML frontmatter に統合して保存する。

表示モード:

- エディタの表示 mode は `Edit` / `Preview` / `Slides` の 3 種類とする。
- `Edit` は Title / Tags / Markdown toolbar / textarea を表示する。
- `Preview` は通常 Markdown Preview を表示する。
- `Slides` は Marp slide deck を 1 枚ずつ表示する。
- 表示 mode の変更だけでは dirty 状態を変更しない。

Marp 有効条件:

- YAML frontmatter の `marp: true` がある場合に Slides を有効扱いにする。
- Marp 設定は Body には表示せず、Slides 選択時にタブ列へ表示する設定 UI で編集する。
- YAML frontmatter は app metadata と Marp metadata を統合して扱う。
- Marp Off の場合、Slides では `Slides unavailable for this note.` を表示する。

実装仕様:

- Marp renderer は Slides 表示が必要になった時のみ lazy load する。
- 依存ライブラリは `@marp-team/marp-core` とする。
- renderer に渡す Markdown は draft body へ Marp metadata を含む YAML frontmatter を内部的に付与して生成する。
- renderer は内部生成した Markdown から slide deck の HTML / CSS を生成する。
- render 結果は app DOM へ直接挿入せず、`iframe srcdoc` で表示する。
- iframe には `sandbox` と `title` を設定し、script 実行を許可しない。
- Marp On/Off は `marp` として frontmatter に保存する。
- theme は `theme` として frontmatter に保存し、初期候補は `default` / `gaia` / `uncover` とする。
- size は `size` として frontmatter に保存し、初期候補は `16:9` / `4:3` とする。
- page number 表示は `paginate` として frontmatter に保存する。
- heading divider は Off または `1`〜`6` とし、On の場合は `headingDivider` として frontmatter に保存する。On にした直後の既定値は `1` とする。
- custom theme CSS の登録、保存、管理は初期仕様の対象外とする。
- 本文変更後の render は 300ms debounce する。
- 100KB を超える本文は自動 render せず、`Slide deck is too large to render automatically.` を表示する。
- render 中は `Rendering slides...` を表示する。
- renderer load 失敗時は `Unable to load slide renderer.` を表示する。
- render 失敗時は `Unable to render slides.` とエラー概要を表示する。

スライド操作:

- Slides は 1 枚表示を基本にする。
- `First` / `Previous` / `Next` / `Last` 操作を提供する。
- 現在位置を `3 / 12` の形式で表示する。
- `ArrowLeft` / `ArrowRight` で前後移動する。
- `Home` / `End` で先頭・最後へ移動する。
- 表示 mode を Slides に切り替えた時点で slide index は 1 枚目に初期化する。
- ノート切替、本文変更、再 render により slide count が変わった場合、slide index を有効範囲に補正する。
- スライド移動、render error、Slides unavailable 状態は dirty 状態を変更しない。

画面仕様:

- `Edit` / `Preview` / `Slides` 切替は editor 上部に表示する。
- タブボタンの角丸は入力欄・セレクトと同じ `8px` とし、カプセル型にはしない。
- タブボタンは `min-width: 80px` とし、ラベルを左右中央に配置する。
- 操作サイズはCSS変数で3段階に統一する。New Note、Import Markdown、Edit / Preview / Slidesは標準40px・アイコン18px、ヘッダー操作はコンパクト36px・アイコン18px、Markdownツールと拡大操作は30px・アイコン15pxを基本とする。角丸は8pxを共通値とする。
- Title / Tags / Body のラベルは維持し、`0.85rem`、`600`、`#666` で補助情報として表示する。ラベル列は `56px` とする。
- モバイルの固定ヘッダーは2段構成とし、1段目にメニュー／Notes／省略可能なタイトル、2段目にステータス／通常幅のSave／アイコン操作を横並びで表示する。Saveは全幅化しない。
- モバイルのBodyヘッダーはラベルを上段、Markdownツールバーと拡大ボタンを下段に配置する。ツールバーは左端から拡大ボタン手前まで使用し、末尾のLink操作まで欠けずに表示する。
- Slides 選択時のみ、Slides タブボタンの右側に設定 UI を表示する。Edit / Preview 選択時は表示しない。
- Slides タブと設定群、各設定項目の間には識別しやすい余白を設け、横幅が不足する場合は折り返す。
- タブボタンと Slides 設定コントロールの高さを揃え、Preview / Slides 切替時に表示領域の上端が移動しないようにする。
- Slides 設定 UI は `Marp` toggle と設定アイコンを持つ。設定メニューは `Slide Settings` ヘッダーと右揃えの固定幅コントロールを持ち、`Size` select、`Theme` select、`Page Numbers` switch、`Heading Divider` checkbox と見出しレベル select を配置する。
- Marp Off の場合、設定アイコンは disabled とする。Heading Divider Off の場合、見出しレベル select は disabled とするが、再度 On にした際に直前の選択値を復元する。初回の既定値は `1` とする。
- Body textarea には Marp frontmatter を表示しない。
- Slides では操作バーと slide viewport を表示する。
- 選択中のタブで表示モードを判別できるため、操作バー内に重複する `Slides` 見出しは表示しない。
- slide viewport は Marp size に合わせたステージとして表示し、`16:9` は `16 / 9`、`4:3` は `4 / 3` にする。
- slide viewport は利用可能な横幅に合わせて縮小する。
- PC では操作バーを slide viewport の上に置き、本文表示領域を圧迫しすぎない。
- モバイルでは操作バーが折り返しても slide viewport と重ならない。
- 横長コードや画像でページ全体の横スクロールを発生させない。

アクセシビリティ:

- 表示 mode 切替は button として実装し、現在 mode を視覚と `aria-pressed` または同等の状態で示す。
- Slides 操作ボタンは focus 表示と disabled 状態を持つ。
- 現在位置は `Slide 3 of 12` のように支援技術で理解できる文言を持つ。
- slide viewport には `aria-label="Slide preview"` を付与する。
- iframe には内容を説明する `title` を付与する。

## 8. Frontmatter 仕様

### 8.1 parse

Markdown が `---` で始まり、2 つ目の `---` が存在する場合、そこまでを YAML frontmatter として扱う。

対応する frontmatter fields:

- `title`: string の場合のみ採用
- `tags`: string 配列の場合のみ採用
- `updatedAt`: number または parse 可能な date string の場合のみ採用
- `id`: string の場合のみ採用
- `marp`: boolean の場合のみ採用。Marp slide mode の On/Off
- `theme`: `default` / `gaia` / `uncover` の場合のみ採用
- `size`: `16:9` / `4:3` の場合のみ採用
- `paginate`: boolean の場合のみ採用。Marp page number 表示
- `headingDivider`: `1`〜`6` の number の場合のみ採用。値が指定されている場合は Heading divider On

frontmatter が存在しない、または閉じ delimiter が存在しない場合は、全文を body として扱う。
未対応の Marp theme / size や型不一致の Marp fields は採用せず、既定値に fallback する。

### 8.2 export

export 時は常に frontmatter を出力する。

例:

```markdown
---
id: note-example
title: Example
tags:
  - memo
updatedAt: 2026-07-09T00:00:00.000Z
marp: true
theme: default
size: 16:9
paginate: true
---
# Example

Body text
```

Marp Off の場合、`marp` は `false` として出力するか、Marp fields を省略してよい。初期実装では frontmatter の簡潔さを優先し、Marp Off のノートでは `marp` / `theme` / `size` / `paginate` / `headingDivider` を省略する。Marp On かつ Heading divider Off の場合も `headingDivider` は省略する。

## 9. 状態管理

`App.tsx` が以下の state を保持する。

| state | 内容 |
| --- | --- |
| `notes` | ノート一覧 |
| `selectedId` | 選択中ノート ID |
| `draftTitle` | 編集中タイトル |
| `draftTags` | 編集中タグ |
| `tagInput` | 未確定タグ入力 |
| `isTagSuggestOpen` | タグ候補ドロップダウン表示有無 |
| `activeTagSuggestionIndex` | キーボード操作中のタグ候補位置 |
| `draftBody` | 編集中本文 |
| `draftMarpEnabled` | 編集中ノートの Marp On/Off |
| `draftMarpSize` | 編集中ノートの Marp size。`16:9` または `4:3` |
| `draftMarpTheme` | 編集中ノートの Marp theme。`default` / `gaia` / `uncover` |
| `draftMarpPaginate` | 編集中ノートの Marp page number 表示 |
| `draftMarpHeadingDivider` | 編集中ノートの heading divider。Off または `1`〜`6` |
| `draftUpdatedAt` | 編集中更新日時 |
| `isDirty` | 未保存変更有無 |
| `dbError` | IndexedDB 初期化エラー |
| `searchQuery` | 適用済み検索語 |
| `tagFilter` | 適用済みタグフィルタ。内部表現はカンマ区切り文字列 |
| `isFilterDialogOpen` | Filter modal 表示有無 |
| `filterDraftSearchQuery` | Filter modal 内の一時検索語 |
| `filterDraftTags` | Filter modal 内の一時タグ条件 |
| `filterTagInput` | Filter modal 内のタグ候補入力 |
| `isTagFilterSuggestOpen` | Filter modal 内のタグ候補ドロップダウン表示有無 |
| `activeTagFilterSuggestionIndex` | キーボード操作中の Filter modal タグ候補位置 |
| `lastBackupAt` | 最終バックアップ日時。メニュー内の補助情報として表示 |
| `operationDialog` | Backup / Import 結果ダイアログ。Backup は `complete` / `ready` を持つ |
| `isBackupBusy` | Backup 処理中 |
| `isImporting` | Import 処理中 |
| `pendingDelete` | Undo 可能な削除対象 |
| `initialDraft` | 新規 draft の Revert 復元元 |
| `activeTab` | 表示 mode。A2 実装後は `edit` / `preview` / `slides` |
| `slideIndex` | A2 実装後の Slides 現在位置。0-based index |

`isDirtyRef` はノート選択時の非同期保存確認に使う。
`MarpSlides` component は Slides render 状態として loading / rendered / unavailable / error / empty / too-large を局所 state に保持する。

Marp 設定を変更した場合は本文編集と同じく dirty 状態にする。保存時は `Note` の Marp metadata として保持し、Export / Backup では YAML frontmatter に出力する。

## 10. エラー/異常系仕様

### 10.1 IndexedDB 初期化失敗

- `dbInitError` にエラーメッセージを保持する。
- UI にエラーメッセージを表示する。
- `Save` は disabled になる。

### 10.2 空ノート保存

title/body/tags がすべて空の場合、保存処理は何もしない。

### 10.3 import 異常

YAML parse エラー、空ファイル、非対応拡張子、バックアップ形式不正はファイル単位で failed として扱う。
成功分は保存し、結果ダイアログで failed 件数とファイル名、理由を表示する。

### 10.4 export/backup 異常

Backup は単一 JSON を作成する。File System Access API で保存完了を検知できる場合は `Backup Complete`、ユーザーキャンセルは通知なし、検知できない download fallback は `Backup Ready` を表示する。
`Backup Ready` は保存完了を保証せず、ブラウザの保存プロンプト確認が必要であることを示す。

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
- mobile 幅では editor の高さ/overflow 仕様により、操作領域の扱いを見直す余地がある。

## 13. 検証観点

### 13.1 機能観点

- ノート作成、保存、選択、削除ができること。
- `Ctrl+S` / `Command+S` で保存でき、`Alt+N` で新規ノートを作成できること。
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

