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
  - 全ノートを単一 JSON バックアップとして出力する。
  - ノートが 0 件の場合も空バックアップを出力し、結果を表示する。
- Import
  - `.md` Markdown ファイルまたは `.json` バックアップファイルを複数選択して取り込む。
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

- アプリタイトル: `Markdown Knowledge Board`
- 保存状態表示
- `Save`
- `Revert`
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
  - タグ未選択時は追加文言を表示せず、入力欄 placeholder のみで空状態を表現する。
  - 入力欄で Enter を押すとタグ追加。
  - 入力欄フォーカス時に既存ノート由来のタグ候補をドロップダウン表示する。
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
  - `ReactMarkdown` で `draftBody` を表示する。
  - `mermaid` fenced code block は Mermaid 図として表示する。
  - Mermaid 図は `Diagram` / `Code` を切り替えられる。
  - 本文が空の場合は `プレビューする内容がありません` を表示する。

## 7. 機能仕様

### 7.1 初期表示

1. IndexedDB から全ノートを取得する。
2. `updatedAt` の降順で `notes` に保持する。
3. IndexedDB 初期化エラーがあれば `dbError` に反映する。
4. `localStorage.lastBackupAt` を確認し、未バックアップまたは 7 日以上経過している場合は、エディタ上部の Status と並べて小さな補助情報として `Backup: None` または経過日数を表示する。

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

1. 選択中ノートまたは未保存 draft がなければ何もしない。
2. `window.confirm` で削除確認する。
3. OK の場合は `notes` から対象ノートを取り除く。
4. 選択状態と draft state をリセットする。
5. `Note deleted` 通知と `Undo` 操作を 8 秒間表示する。
6. Undo した場合は対象ノートを元の一覧位置とエディタへ復元する。
7. Undo 期限を過ぎた場合は IndexedDB から削除を確定する。

### 7.9 インポート

`Import Markdown / Backup` から複数 Markdown ファイルまたは JSON バックアップファイルを選択できる。

各ファイルについて以下を行う。

1. file text を読む。
2. `.json` の場合はバックアップ形式を検証し、含まれる各ノートの Markdown を parse する。
3. `.md` の場合は YAML frontmatter を parse する。
4. `id` は frontmatter またはバックアップメタデータから復元し、なければ新規作成する。
5. title は frontmatter の `title`、本文中の H1、ファイル名の順で決定する。
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
- `Backup Complete` または `Backup Ready` の場合のみ `localStorage.lastBackupAt` に現在時刻の ISO 文字列を保存し、`backupMessage` を消す。

### 7.12 Markdown toolbar

toolbar 操作は textarea の selection/cursor を基準に本文を変更する。
toolbar の表示ラベルは短縮し、スクリーンリーダーや tooltip では各操作名を維持する。
toolbar は Body の編集補助であるため、Body 見出し行内に配置する。

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

Slides は Marp 対応 Markdown をプレゼンテーションとして閲覧する表示モードである。Slides 表示は表示専用であり、スライド生成結果や現在のスライド番号は保存しない。Marp On/Off、size、theme、page number 表示はノート metadata として YAML frontmatter に統合して保存する。

表示モード:

- エディタの表示 mode は `Edit` / `Preview` / `Slides` の 3 種類とする。
- `Edit` は Title / Tags / Markdown toolbar / textarea を表示する。
- `Preview` は通常 Markdown Preview を表示する。
- `Slides` は Marp slide deck を 1 枚ずつ表示する。
- 表示 mode の変更だけでは dirty 状態を変更しない。

Marp 有効条件:

- YAML frontmatter の `marp: true` がある場合に Slides を有効扱いにする。
- Marp 設定は Body には表示せず、Edit 画面の Slides 設定 UI で編集する。
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
- Edit の metadata area に Slides 設定 UI を表示する。
- Slides 設定 UI は `Marp` toggle、`Size` select、`Theme` select、`Page numbers` toggle を持つ。
- Marp Off の場合、Size / Theme / Page numbers は disabled または補助設定として表示する。
- Body textarea には Marp frontmatter を表示しない。
- Slides では操作バーと slide viewport を表示する。
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

Marp Off の場合、`marp` は `false` として出力するか、Marp fields を省略してよい。初期実装では frontmatter の簡潔さを優先し、Marp Off のノートでは `marp` / `theme` / `size` / `paginate` を省略する。

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
| `backupMessage` | バックアップ通知 |
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

