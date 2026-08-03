# Markdown Knowledge Board 設計仕様

作成日: 2026-07-09

最終更新日: 2026-07-30

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
  - IndexedDB の初期化、取得、保存、削除と、復元用の単一transaction適用を担当する。
- `src/lib/frontmatter.ts`
  - Markdown frontmatter の parse/export を担当する。
- `src/lib/note.ts`
  - Note ID・timestamp・pin値の正規化と、MarkdownからのNote生成を担当する。
- `src/lib/backup.ts`
  - ローカルJSON backup version 1の作成・parseと、import種別の振り分けを担当する。
- `src/lib/canonicalJson.ts`
  - object key順を固定し、配列順を維持するcanonical JSON serializationを担当する。
- `src/lib/cloudCrypto.ts`
  - Web CryptoによるAES-256-GCM、PBKDF2-SHA-256、暗号化エンベロープ、base64url、passphrase・4.5 MB境界の検証を担当する。現時点ではUIやクラウド通信には未接続。
- `src/lib/cloudRestore.ts`
  - クラウド復元向けのstrict BackupDocument検証、内容fingerprint、safe merge差分を担当する。現時点ではUIやクラウド通信には未接続。
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
  pinnedAt?: number;
  marp?: MarpSettings;
  customMetadata?: Array<{ key: string; value: FrontmatterValue }>;
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
| `pinnedAt` | `number`（任意） | 一覧上部へ固定した日時。Unix epoch milliseconds。未指定は未固定。本文の更新日時およびdirty状態とは独立して扱う。 |
| `marp` | `MarpSettings`（任意） | Slides表示とExportに使用するMarp metadata。 |
| `customMetadata` | `{ key: string; value: FrontmatterValue }[]`（任意） | 標準属性以外の安全な任意frontmatter属性。Bodyとは分離し、Export順を維持して保持する。 |

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
画面左右の外周余白は共通tokenで管理し、desktopではSidebar、Editor、固定ヘッダーを16px、mobileでは12pxとする。Editorの上下余白はdesktopで上18px・下16px、mobileで上下16pxを維持し、Preview／Edit／Slidesで共通化する。Edit拡大時も同じ左右余白を使用する。Preview panel内部の18px余白は読みやすさのため変更しない。

### 6.2 Sidebar

sidebar には以下を配置する。

- `+ New Note`
  - 新規ノートを作成し、編集状態にする。
  - 右隣に Markdown Import アイコンボタンを配置する。
  - アイコンの accessible name と Tooltip は `Import Markdown` とし、`.md`、`.markdown`、`.txt` ファイルを複数選択できる。
  - アイコンは `lucide-react` の `FileDown` を使用する。
  - Import Markdownボタンは通常時の枠線と背景を透明にし、hoverまたはkeyboard focus時だけ枠線と薄い背景色を表示する。disabled時も透明な外観を維持する。
- Notes
  - `NOTES` ラベルとノート件数は1行で表示し、条件なしでは `NOTES (n)`、条件ありでは `NOTES (filtered of total)` とする。ラベルと件数の間隔は `4px` とし、括弧は半角を使用する。
  - `Filter` ボタンを表示する。
  - Search または Tag filter が有効な場合、`Filter (n)` として有効条件数を表示する。
  - Search または Tag filter が有効な場合、`Clear` ボタンを表示し、modal を開かずに全条件を解除できる。
  - 件数のaccessible labelは条件なしでは `n notes`、条件ありでは `filtered of total notes` とし、表示件数の更新をpoliteに通知する。
  - フィルタ後のノート一覧を表示する。
  - `+ New Note` / `Import Markdown`、`NOTES` / 件数、`Filter` / `Clear` はSidebar上部の固定領域として扱い、ノートカード一覧だけを縦スクロールさせる。
  - ノートカードと縦スクロールバーの間に8pxの余白を設け、スクロールバーの有無でカード幅が変わらないようscrollbar gutterを確保する。スクロールバーとSidebar右外枠またはmobile画面右端の間隔は4pxとし、固定化前と同程度のコンパクトさを維持する。
  - desktopとmobileのNotes画面はいずれもカード一覧を単一の縦スクロール領域とし、documentまたはSidebar全体との二重スクロールを発生させない。
  - FilterのApplyまたは適用済み条件のClearで一覧内容が変わる場合は、カード一覧を先頭へ戻す。
  - mobileで通常のカード選択からNotes画面へ戻る場合は、Filter条件とカード一覧のスクロール位置を維持する。Preview内のノートリンクで切り替えた場合だけ、Notesへ戻った描画後にリンク先カードが見える位置へ移動する。
  - 各ノートカードはタイトル、タグ、更新日時の順で表示する。タイトルは1行固定とし、カード幅を超える場合は末尾を省略表示する。
  - 未固定カードでは、選択中のカードだけ右上に `MoreVertical` の縦3点ボタンを常時表示する。未選択かつ未固定のカードには表示せず、desktopのhover有無とtouch端末の差に依存しない導線とする。
  - 固定済みカードでは、選択状態に関係なく縦3点と同じ位置に `Pin` ボタンを常時表示する。固定済みの選択カードも縦3点ではなく `Pin` を表示する。いずれのボタンも通常時は枠線と背景を透明にし、hover、keyboard focus、メニュー展開中だけ枠線と薄い背景色を表示する。
  - 未固定カードの縦3点ボタンは `Selected note actions`、固定済みカードのピンボタンは対象タイトルを含む `Pinned note actions: {title}` をaccessible nameとする。両方に `aria-haspopup="menu"` と開閉状態を表す `aria-expanded` を設定し、開いたメニューのaccessible nameには対象タイトルを含める。カード本体とメニューボタンは独立したbuttonとし、メニュー操作でカード選択を再実行しない。
  - 未固定カードのメニューは `Pin to top`、区切り線、赤い `Trash2` アイコン付きの `Delete` の順とする。固定済みカードのメニューは `Unpin`、区切り線、`Delete` の順とする。メニューは画面内に収まるよう左右位置を補正し、下側の空きが不足する場合はボタンの上側へ表示する。
  - カード用メニューは項目選択、外側クリック、Escape、カード一覧のスクロール、画面サイズ変更、対象カードがFilter結果から外れた場合に閉じる。Escapeでは開いたメニューボタンへフォーカスを戻す。未選択の固定カードをUnpinしてボタン自体が消える場合は、同じカード本体へフォーカスを戻す。
  - タグがある場合は、角丸 `4px` のバッジとして1行固定で表示する。長いタグ名はバッジ内で末尾を省略し、タグ行全体がカード幅を超えた分は表示領域外へはみ出さない。タグがない場合はタグ行を表示しない。
  - 省略前のタイトルとタグは、それぞれ `title` 属性で確認できるようにする。
  - ノート自体が 0 件の場合は `No notes yet.` を表示する。
  - フィルタ結果が 0 件の場合は `No notes match your filters.` と `Clear Filters` を表示する。

### 6.2.1 Filter modal

`Filter` ボタン押下で Search / Tags 条件を設定する modal dialog を表示する。

- Search
  - title/body の部分一致検索。
- Tags
  - 選択済みタグをチップとして表示する。
  - タグチップの角丸はEdit画面およびノートカード内のタグ表示と同じ `4px` とし、カプセル型にはしない。
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

デスクトップでは画面全幅の固定ヘッダーバーとして1行表示し、タイトル、保存・バックアップ状態、操作ボタンを配置する。Sidebar と Editor はヘッダーバーの下に並べる。幅が不足する場合は操作領域を横スクロール可能にしてボタンの折り返しを防ぐ。モバイルの Edit 画面では2段構成とし、1段目は application menu、タイトル、右端の保存状態、2段目は左端の `＜ NOTES` テキストリンクと右側の `Save` / `Revert changes` / `More actions` を配置する。`＜ NOTES` は枠線と背景を持たないリンク外観とし、フォント、文字サイズ、太さ、字間をノート一覧見出しの `NOTES` と揃え、`Save` と垂直中央を揃える。accessible name は `Notes` を維持する。Edit部分の拡大中に `＜ NOTES` で一覧へ戻る場合は、未保存確認の完了後に拡大状態を解除して一覧を表示する。確認をキャンセルした場合はEdit画面と拡大状態を維持する。タイトルが長い場合は省略表示し、保存状態と各操作を表示領域内に維持する。いずれも画面上端への固定を維持する。

- アプリタイトル: `Markdown Knowledge Board`
- タイトル左の application menu
  - トリガーには `lucide-react` の `Menu` を使用する。
  - トリガーは通常時の枠線と背景を透明にし、hover、keyboard focus、メニュー展開中だけ枠線と薄い背景色を表示する。
  - `Backup All Notes`: 全ノートを単一 JSON バックアップとして出力する。ノートが 0 件の場合も空バックアップを出力する。
  - `Import Backup`: `.json` バックアップファイルのみ複数選択して取り込む。
- 保存状態表示
- `Save`: 最も使用頻度の高い主操作としてラベル付きボタンを維持する。
- `Save` には `Ctrl+S`（Windows / Linux）および `Command+S`（macOS）のキーボードショートカットを割り当て、ブラウザ標準のページ保存動作を抑止する。
- `Save` の Tooltip は Windows / Linux で `Save (Ctrl+S)`、macOS で `Save (⌘S)` と表示する。
- `Revert changes`: `RotateCcw` アイコンボタンとして `Save` の右側に配置し、未保存変更がない場合は無効にする。通常時およびdisabled時の枠線と背景を透明にし、操作可能時のhoverまたはkeyboard focus時だけ枠線と薄い背景色を表示する。押下時は他の確認操作と同じアプリ内 modal dialog を表示する。
- `More actions`: `MoreHorizontal` アイコンボタンとして配置し、以下の低頻度操作をメニュー表示する。
  - 通常時およびdisabled時の枠線と背景を透明にし、hover、keyboard focus、メニュー展開中だけ枠線と薄い背景色を表示する。
  - Revert changesとの間隔は4pxとし、SaveとRevert changesの8px間隔より狭くして関連するアイコン操作を視覚的にまとめる。
  - `Metadata`: frontmatterを参照し、Custom metadataを編集するmodal dialogを開く。
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
  - Edit画面の選択済みタグは、ノートカード内のタグバッジと同じ角丸 `4px` とする。
  - タグ未選択時は追加文言を表示せず、入力欄 placeholder のみで空状態を表現する。
  - 入力欄で Enter を押すとタグ追加。
  - 入力欄フォーカス時に既存ノート由来のタグ候補をドロップダウン表示する。
  - Editor の候補ドロップダウンは入力欄の左端に合わせ、幅は最大 `360px`、入力欄が狭い場合は入力欄幅に収める。
  - 候補は選択済みタグを除外し、入力文字で絞り込む。
  - 候補表示は最大 8 件とする。
  - 候補はクリック、ArrowUp / ArrowDown、Enter で選択できる。
  - Escape または入力欄外フォーカスで候補を閉じる。
- Title / Tags
  - 既存どおり縦2行に配置する。
  - 各行はラベルと入力欄を横並びにして、Body上部の占有高さを抑える。
  - 編集画面の表示ラベルをタップしても入力欄へフォーカスさせない。
  - 入力欄へのフォーカスは入力欄自体をタップした場合のみ行う。
- Body
  - Markdown 本文入力。
  - Body ラベルをタップしても本文入力欄へフォーカスさせない。
- Markdown toolbar
  - Body 見出し行に常時表示する。
  - PC 幅では Body ラベルの右側に配置し、左端を Title / Tags の入力欄左端に揃える。
  - モバイル幅では Body ラベルの下側に配置し、左端を Title / Tags の入力欄左端に揃える。
  - モバイル幅では入力欄列の範囲内に収まるよう、trigger幅と間隔を抑える。
  - モバイルなどページスクロールが発生する環境では Body 見出し行ごと sticky として追従する。
  - `Format`、`Paragraph`、`Insert`の3つの文字ラベル付きtriggerを表示し、同時に開くmenuは1つだけとする。
  - PC幅ではFormat／Insertを80px、Paragraphを104px、間隔を8pxとする。モバイル幅では66px／86px／66px、間隔を4pxとして入力欄列へ収める。
  - `Format`: Bold、Italic、Strikethrough、Inline code、Highlight。選択範囲がない場合はdisabledとし、Highlightは1行選択だけを対象とする。
  - `Paragraph`: Heading 1、Heading 2、Heading 3、Bulleted list、Task list、Quote。Bulleted listとTask listは、複数行選択時に選択が触れる非空行を一括変換し、全行設定済みなら一括解除、混在時は未設定行だけへ付与する。
  - `Insert`: Link、Table、Code block。
  - menu itemはiconと可視ラベルを持ち、ArrowUp / ArrowDown、Home / End、Enter / Space、Escape、Tabで操作できる。
  - 実行前の本文選択範囲とscroll位置を保持し、実行後はBodyへfocus、selection、scrollを復元する。
  - Highlightは`==text==`として保存し、Previewで`mark`要素として表示する。inline code、fenced code block、エスケープ、複数行はHighlightとして解釈しない。
  - 詳細は [Editツールバーメニュー要件](./edit-toolbar-menu-requirements.md) と [Editツールバーメニュー詳細設計](./edit-toolbar-menu-design.md) を参照する。

### 6.5 Preview / Edit

`activeTab` により `Preview`、`Edit`、`Slides` を切り替える。タブは利用頻度を考慮して `Preview`、`Edit`、`Slides` の順に表示し、DOM順およびキーボードのフォーカス移動順も表示順と一致させる。

- アプリ起動時および保存済みノート選択時は `Preview` を優先表示する。
- `New Note` で新規draftを作成した場合、および削除した未保存draftをUndoした場合は、入力を開始・継続できるよう `Edit` を表示する。
- Save、Revert、Preview内のタスクチェック操作では現在の表示modeを維持し、自動的に別のタブへ切り替えない。
- 未保存変更がある状態で別の保存済みノートを選択した場合は、既存の未保存確認を完了してから対象ノートの `Preview` を表示する。Cancelでは選択ノートと表示modeを変更しない。
- 表示modeの変更だけでは本文、metadata、dirty状態、保存データを変更しない。

- `Edit`
  - Title / Tags を表示する。
  - Metadata機能の追加によってTitle、Tags、Bodyの配置を変更せず、常設のfrontmatter入力欄を追加しない。
  - Markdown toolbar と textarea を表示する。
- `Preview`
  - Preview 表示領域を広げるため、Title / Tags は表示しない。
  - 選択中のタブで表示モードを判別できるため、表示領域内に重複する `Preview` 見出しは表示しない。
  - `ReactMarkdown` で `draftBody` を表示する。
  - 相対パスの `.md` / `.markdown` リンクを押すと、リンク先ファイル名から拡張子を除いた文字列とタイトルが完全一致する保存済みノートを検索し、そのノートのPreview先頭へ移動する。URL queryとfragmentはタイトル照合に使用しない。
  - 対象ノートがない場合は `Note not found: {title}`、同名ノートが複数ある場合は `Multiple notes found: {title}` と通知し、画面遷移しない。外部URL、絶対パス、ページ内リンク、対象外拡張子は通常リンクとして扱う。
  - リンク元に未保存変更がある場合は既存の未保存確認を表示し、SaveまたはDiscardの完了後のみ移動する。Cancelではリンク元のPreviewを維持する。現在のFilter条件は変更しない。
  - リンク切替が成功した場合はリンク先ノートIDを一時保持し、カード描画後にリンク先カードが一覧の表示範囲へ入るよう `.note-list` だけを最小距離でスクロールする。対象カードがすでに完全表示されている場合はスクロール位置を変更しない。document、Sidebar全体、editor、keyboard focusは移動しない。
  - desktopはリンク切替後に即時実行する。mobileはEditor表示中のSidebarが非表示であるため、リンク先IDを維持し、利用者が `Notes` へ戻った後に実行する。通常のカード選択やNew Noteへ移動した場合は保留中のリンク先IDを破棄する。
  - 通常はsmooth scrollとし、`prefers-reduced-motion: reduce` では即時移動する。該当なし、同名複数、未保存確認Cancelではリンク先IDを設定せず、一覧をスクロールしない。
  - リンク先が現在のFilter条件に一致せずカードが描画されていない場合はFilterを自動解除せず、`Linked note is hidden by the current filter: {title}` と通知する。リンク先IDは保持し、Filter解除または条件変更でカードが表示された時点で自動スクロールして保留状態と通知を解除する。
  - editor tab row右端に、H1〜H3を文書順に抽出する `Table of contents` アイコンボタンを表示する。見出しがない場合はdisabledとし、Tooltipを `No headings` とする。EditとSlidesでは表示しない。
  - Table of contentsボタンは通常時およびdisabled時の枠線と背景を透明にし、hover、keyboard focus、目次展開中だけ枠線と薄い背景色を表示する。
  - TOCは本文領域を狭めないカード型ポップオーバーとし、見出しlevelに応じてH1、H2、H3をインデントする。最大高は320pxとし、超過分はポップオーバー内でスクロールする。
  - TOC項目選択時は、desktopでは `.mdPreview-scroll` 内、mobileではdocumentを対象見出しまで移動し、固定ヘッダーで見出しが隠れないoffsetを確保する。通常はsmooth、`prefers-reduced-motion: reduce` では即時移動とする。
  - TOCは項目選択、外側pointer選択、Escape、表示mode変更、選択ノートまたは本文変更で閉じる。keyboardで開いた場合は最初の項目、Escapeではトリガー、項目選択後は移動先見出しへフォーカスする。
  - TOCの生成、開閉、移動はdirty状態および保存データを変更しない。詳細は [Preview目次（TOC）要件定義](./preview-toc-requirements.md) と [Preview目次（TOC）詳細設計](./preview-toc-design.md) に従う。
  - `mermaid` fenced code block は Mermaid 図として表示する。
  - Mermaid 図は `Diagram` / `Code` を切り替えられる。
  - 本文が空の場合は `プレビューする内容がありません` を表示する。

#### Preview基本カラー

Previewはモノクロ基調を維持し、リンクとkeyboard focusだけに青のaccentを使用する。errorは赤系とし、色だけで状態や意味を伝えない。

| Token | 値 | 用途 |
| --- | --- | --- |
| `--preview-bg` | `#fafafa` | Preview背景 |
| `--preview-text` | `#1f1f1f` | 本文・見出し |
| `--preview-muted-text` | `#555555` | 引用・補助文 |
| `--preview-completed-text` | `#666666` | 完了task。取消線を併用する |
| `--preview-link` | `#1d4ed8` | link。下線を併用する |
| `--preview-link-hover` | `#1e40af` | link hover |
| `--preview-code-bg` | `#eef1f4` | inline code、code block、Mermaid code |
| `--preview-table-header-bg` | `#f1f3f5` | table header |
| `--preview-border` | `#c7cbd1` | code block、table、blockquote、Mermaid境界 |
| `--preview-focus` | `#2563eb` | link、task、TOCのfocus ring |
| `--preview-error-bg` / `--preview-error-text` | `#fff1f1` / `#5a1f1f` | Mermaid error |

- linkは通常、visited、hover、focusで識別可能とし、常にunderlineを維持する。
- code blockは背景色とborderの両方で本文領域から区別し、inline codeとは余白・形状で区別する。
- table headerは背景色と太字でdata rowから区別する。
- 完了taskは要素全体の`opacity`を下げず、専用文字色と取消線を使用する。
- Preview色は上記tokenから参照し、同じ意味の色をcomponentごとに直接定義しない。

## 7. 機能仕様

### 7.1 初期表示

1. IndexedDB から全ノートを取得する。
2. 固定済みノートを `pinnedAt` 降順、その後に未固定ノートを `updatedAt` 降順で `notes` に保持する。同値の場合は `updatedAt` 降順、`id` 昇順を使用して決定的に並べる。
3. IndexedDB 初期化エラーがあれば `dbError` に反映する。
4. `localStorage.lastBackupAt` を確認し、アプリメニューの `Backup All Notes` の下に `Last local backup` と分単位の日時を2段で表示する。未実施時は `No backups yet` と表示する。
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

### 7.3.1 ノート固定

カードメニューの `Pin to top` / `Unpin` は、ノート本文の編集とは独立した一覧整理操作とする。

1. `Pin to top` では対象ノートの `pinnedAt` に現在時刻を設定し、IndexedDBへ保存する。
2. 保存成功後、対象を固定グループの先頭へ移動する。複数の固定カードは `pinnedAt` の降順とし、固定後に本文を保存しても固定グループ内の位置を変更しない。
3. `Unpin` では `pinnedAt` を削除してIndexedDBへ保存し、未固定グループの `updatedAt` に基づく位置へ戻す。
4. Pin／Unpinだけでは `updatedAt`、editor draft、`isDirty`、選択状態、Filter条件を変更しない。
5. Filter中は条件に一致する固定カードだけを結果の上部へ表示する。固定カードをFilter条件に関係なく強制表示しない。
6. Pin／UnpinのDB保存中は同じカードメニューの操作を無効化する。失敗した場合は一覧と固定状態を変更せず、IndexedDBエラーを表示して再試行可能にする。
7. 一覧上部への固定は並び順の固定であり、カード一覧をスクロールした際にviewport上端へ追従するsticky表示にはしない。

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
6. 既存ノートの `pinnedAt` を維持して `notes` を対象ノートで更新し、固定グループと未固定グループの共通順序で並べる。
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
- `New Note` の Tooltip は Windows / Linux で `New Note (Alt+N)`、macOS で `New Note (Option+N)` と表示する。Tooltip のOS差は表示上の呼称のみとし、実装上はいずれも `Alt` modifier を使用する。
- Tooltip はマウス hover またはキーボード focus で表示し、狭い viewport でも左右端からはみ出さない。
- Tooltip の生成コンテンツにかかわらず、ボタンの accessible name はそれぞれ `Save` / `New Note` に固定する。

### 7.7 Revert

`Revert` は編集中の未保存変更を、現在のノートを読み込んだ時点の内容へ戻す。

1. 未保存変更または未確定タグ入力がなければ disabled。
2. 押下時はブラウザ標準の確認ダイアログを使用せず、`Revert changes?`、説明文、`Cancel`、`Revert Changes` を含むアプリ内 modal dialog を表示する。
3. 保存済みノートでは、未保存変更を破棄して最後に保存した状態へ戻す旨を説明する。新規 draft では、draft 作成時の初期状態へ戻す旨を説明する。
4. `Cancel` を初期フォーカスとし、`Cancel`、背景クリック、Escapeでは変更を破棄せずに閉じて、Revert changesボタンへフォーカスを戻す。
5. `Revert Changes` で確認した場合、保存済みノートは `selectedNote` の title / tags / body / updatedAt を draft state に戻し、新規 draft はdraft作成時の初期状態へ戻す。
6. 保存済みノートは `Status: Saved` に戻り、新規 draft は `Status: Draft` のまま残る。
7. `tagInput`、保存エラー表示、dirty 状態を復元結果に合わせてリセットする。

### 7.8 削除

Editor header、選択中カードの縦3点メニュー、または固定済みカードのピンメニューから `Delete` を押すと以下を行う。

- ブラウザ標準の確認ダイアログは使用せず、対象ノート名、`Cancel`、`Delete Note` を含むアプリ内 modal dialog を表示する。
- 削除要求では表示中の選択状態から対象を再推測せず、要求時点の対象ノートIDとdraft snapshotを保持する。これにより別ノートの誤削除を防ぐ。
- 選択中ノートに未保存変更または未確定タグ入力がある場合は、現在のdraft snapshotを確認表示とUndo復元対象に使用する。
- `Cancel`、背景クリック、Escでは削除せずに閉じる。Editor headerから開いた場合はheaderのMore actions、カードから開いた場合は対象カードの縦3点またはピンボタンへフォーカスを戻す。
- `Delete Note` で削除を確定し、既存のUndo可能時間を開始する。

1. 選択中ノートまたは未保存draftがなければ何もしない。
2. 対象ノート名を含む確認modalを表示する。
3. `Delete Note` の場合は `notes` から対象IDだけを取り除き、対象が選択中なら選択状態とdraft stateをリセットする。
4. `Note deleted` 通知と `Undo` 操作を8秒間表示する。
5. Undoした場合は対象ノートを `pinnedAt` を含むsnapshotと元の一覧位置へ復元し、削除時に選択中だった場合だけエディタへ再表示する。別ノートの編集中に影響を与えない。
6. Undo期限を過ぎた場合はIndexedDBから対象IDの削除を確定する。
7. Undo待機中に別の削除を確定する場合は、先の削除をIndexedDBへ確定してから次のUndo期間を開始する。

### 7.9 インポート

Sidebar の `Import Markdown` から複数の `.md`、`.markdown`、`.txt` ファイル、application menu の `Import Backup` から複数 JSON バックアップファイルを選択できる。PC では Edit の Body 領域または Preview 領域へ Markdown / text ファイルをドラッグ＆ドロップしても、`Import Markdown` と同じ処理を実行する。Body への挿入・置換やPreview内容の変更ではなく、各ファイルをノートとして追加または更新する。Edit／Previewの両ドロップ領域は同じ受入表示とイベント処理を使用し、各導線は取込後の未保存確認、重複判定、保存、結果表示を共通とする。

各ファイルについて以下を行う。

1. file text を読む。
2. `.json` の場合はバックアップ形式を検証し、含まれる各ノートの Markdown を parse する。
3. `.md`、`.markdown`、`.txt` の場合は YAML frontmatter を parse する。frontmatter がなければファイル全文を本文として扱う。
4. `id` は frontmatter またはバックアップメタデータから復元し、なければ新規作成する。
5. `.md`、`.markdown`、`.txt` の title は frontmatter の `title`、ファイル名の順で決定する。本文中の H1 はTitle決定には使用せず本文に残す。JSONバックアップはバックアップメタデータ、Markdown frontmatter、本文中の H1、ファイル名の順で決定する。
6. body は frontmatter 除去後の本文を使う。frontmatter がなければファイル全文を使う。
7. tags は frontmatter の `tags` が文字列配列の場合のみ復元する。
8. updatedAt は frontmatter の `updatedAt` を number または parse 可能な date string として復元する。なければ現在時刻。
9. JSONバックアップの `pinnedAt` はfiniteかつ0以上のnumberの場合だけ復元する。Markdown／text importで既存ノートを更新する場合は既存の固定状態を維持し、新規Markdown／text importは未固定とする。
10. 対応済みの標準属性とMarp属性を除いた未知属性は、安全な値型であればCustom metadataとして復元する。
   - frontmatter内の出現順を維持し、string、number、boolean、null、sequence、mappingの型を保持する。
11. 重複判定は `id` を優先し、次に現行データモデルで扱える `title + updatedAt` の一致を見る。
12. 同一内容と固定状態なら skipped、差分があれば updated、重複がなければ added として IndexedDB に保存する。
13. import 結果ダイアログで added / updated / skipped / failed を表示する。
14. 失敗したファイルはファイル名と理由を表示し、成功分は保存する。

### 7.10 エクスポート

`Export` は選択中ノートを Markdown ファイルとして出力する。

frontmatterはMetadata dialogと共通のcanonical order（`id`、`title`、`tags`、`updatedAt`、対象Marp属性、Custom metadata）で生成する。

出力内容:

- YAML frontmatter
  - `id`
  - `title`
  - `tags`
  - `updatedAt`
  - 有効なMarp属性
  - Custom metadata
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
  - `pinnedAt`: 固定済みの場合のみUnix epoch millisecondsを出力する。Markdown frontmatterには含めない。
  - `customMetadata`
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
対応済み属性を除く未知属性はCustom metadataとして出現順を維持して保持する。Custom metadataはstring、number、boolean、null、配列、入れ子mappingを許可する。危険なkeyまたは安全に保持できない値は拒否する。

次のkeyはアプリまたは既存UIが管理する予約属性とし、Custom metadataからの指定を許可しない: `id`、`title`、`tags`、`updatedAt`、`marp`、`theme`、`size`、`paginate`、`headingDivider`。

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
author: Bamboo
status: draft
---
# Example

Body text
```

Marp Off の場合、`marp` は `false` として出力するか、Marp fields を省略してよい。初期実装では frontmatter の簡潔さを優先し、Marp Off のノートでは `marp` / `theme` / `size` / `paginate` / `headingDivider` を省略する。Marp On かつ Heading divider Off の場合も `headingDivider` は省略する。

Metadata dialogとExportは、標準属性、Marp属性、Custom metadataをcanonical orderへ統合する同じentry生成処理を共有する。Dialogでは`id`、`title`、`tags`、`updatedAt`、Marp属性をread-only表示し、Custom metadataだけをKey／Value行で編集する。詳細は [Metadataダイアログ 要件定義](./frontmatter-editor-requirements.md) と [Metadataダイアログ 詳細設計](./frontmatter-editor-design.md) に従う。

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
| `draftCustomMetadata` | 適用済みCustom metadata。順序と値型を維持し、メインSaveの対象にする。 |
| `isMetadataDialogOpen` | Metadata modal dialogの表示有無。 |
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
| `openNoteCardMenuId` | 選択中カードまたは固定済みカードのPin／Unpin／Deleteメニューを開いているノートID。閉じている場合は `null`。 |
| `noteCardMenuPosition` | viewport内へ補正したカード用メニューの `top` / `left`。 |
| `noteCardActionBusyId` | Pin／UnpinをIndexedDBへ保存中のノートID。処理中でない場合は `null`。 |
| `pendingNoteListRevealId` | Preview内リンクによる切替後、一覧内で表示待ちのリンク先ノートID。表示完了、通常カード選択、New Note、対象削除で `null` に戻す。 |
| `deleteConfirmation` | 削除確認対象のsnapshotと、Cancel／Escape時のフォーカス復帰先。 |
| `revertConfirmation` | Revert確認対象。保存済みノートまたは新規draftの初期状態を識別し、modal表示中に対象を固定する。 |
| `pendingDelete` | 対象snapshot、元の一覧位置、選択／draft状態を含むUndo可能な削除対象。 |
| `initialDraft` | 新規 draft の Revert 復元元 |
| `activeTab` | 表示mode。`preview` / `edit` / `slides`。初期値は `preview` |
| `slideIndex` | A2 実装後の Slides 現在位置。0-based index |

`isDirtyRef` はノート選択時の非同期保存確認に使う。
`MarpSlides` component は Slides render 状態として loading / rendered / unavailable / error / empty / too-large を局所 state に保持する。

Marp 設定を変更した場合は本文編集と同じく dirty 状態にする。保存時は `Note` の Marp metadata として保持し、Export / Backup では YAML frontmatter に出力する。
Metadata dialog内の編集はdialog local stateだけを変更する。Applyで内容が変わった場合にCustom metadata draftを更新してdirty状態にし、メインSaveで永続化する。RevertまたはメインのDiscardは保存済みCustom metadataへ戻す。

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

### 10.5 Pin／Unpin保存失敗

Pin／Unpinの `saveNote` が失敗した場合は、一覧順、`pinnedAt`、選択状態、draftを変更しない。対象メニューの処理中状態を解除し、既存のIndexedDBエラー表示へ理由を表示する。同じ操作を再実行できる状態を維持する。

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

### 10.2 Custom metadata不正

- 空key、重複key、予約key、安全でないkey、不正なYAML valueまたは過大な構造をrow errorとする。
- 1件以上のerrorがある場合はMetadata dialogのApplyをdisabledにし、メインdraftへ反映しない。
- 未適用変更がある状態でCancel、Escape、dialog外pointer選択を行った場合は破棄確認を表示する。
- dialogを開かずに他のdraft項目を保存しても、既存Custom metadataを維持する。

## 13. 検証観点

### 13.1 機能観点

- ノート作成、保存、選択、削除ができること。
- 未固定の選択中カードだけに縦3点、固定済みカードには選択状態を問わずピンボタンが表示され、Pin to top、Unpin、Delete、確認、Cancel、Undoが一連で動作すること。
- 複数カードの固定順、固定後の本文保存、Filter適用、再読み込みで固定グループと固定状態が維持されること。
- カード用メニュー表示中にEscape、外側クリック、一覧スクロール、画面サイズ変更、選択／Filter変更を行うと安全に閉じること。
- `Ctrl+S` / `Command+S` で保存でき、`Alt+N` で新規ノートを作成できること。
- Save / New Note の Tooltip に実行環境に応じたショートカット表記が表示されること。
- title/body/tags の編集内容が保存後に復元できること。
- search と tag filter が組み合わせて動作すること。
- FilterのApply／Clear後にカード一覧が先頭へ戻り、ノートを開いてNotesへ戻った場合は以前のスクロール位置が復元されること。
- Markdown import/export が frontmatter を含めて動作すること。
- EditのBodyまたはPreviewへMarkdown／textファイルをドロップすると、いずれもImport Markdownと同じ結果になり、未保存確認をCancelした場合は取込と編集中データの変更が発生しないこと。
- Preview内リンクで一覧外のノートへ切り替えた場合、desktopでは切替後、mobileではNotesへ戻った後に対象カードが一覧の表示範囲へ入ること。すでに見えている場合、リンク不成立、未保存確認Cancelでは一覧位置が変わらないこと。
- Preview内リンク先がFilter対象外の場合はFilterと保留IDを維持して通知し、Filter解除後に対象カードへ移動すること。
- More actionsからMetadata dialogを開き、Exportと同じ順序でread-only属性とCustom metadataを参照できること。
- Custom fieldの追加・変更・削除、Apply／Cancel、メインSave／Revert、Import／Export／Backup roundtripが動作すること。
- Preview で Markdown と GFM task list が表示されること。
- Preview のタスクチェック切替が本文の該当行を更新すること。
- アプリ起動時と保存済みノート選択時はPreview、新規draft作成時と未保存draftのUndo時はEditが選択されること。
- 未保存確認のSave／Discard完了後は対象ノートのPreviewへ移動し、Cancelでは元のノートと表示modeを維持すること。
- 保存済みノートと新規draftのRevert確認で、`Revert Changes` は対応する復元元へ戻し、`Cancel`、背景クリック、Escapeは編集中の値と保存状態を変更しないこと。

### 13.2 非機能観点

- IndexedDB が使えない場合に UI が破綻しないこと。
- build/lint/audit が通ること。
- 大量ノートまたは長文 Markdown でも操作不能にならないこと。
- 大量ノートでもカード一覧だけをスクロールでき、Sidebar上部の作成・Import・件数・Filter操作を継続できること。
- 長文やMermaidを含む保存済みノートをPreviewで開いても、タブ切替と基本操作が継続できること。
- 多数または長いCustom metadataでもdialog内部スクロール、validation、Apply／Cancel操作を継続できること。
- カード用メニューを短時間に繰り返し開閉しても複数表示や対象IDの競合が起きないこと。
- Pin／Unpin保存中の連打やDeleteとの競合を抑止し、IndexedDB失敗時に見た目だけ固定／解除された状態を残さないこと。
- 大量ノートでPreviewリンクを連続操作してもdocumentやeditorを誤ってスクロールせず、最後に成功したリンク先だけをreveal対象にすること。smooth scroll中もカード選択やNotesへの切替を阻害しないこと。

### 13.3 データ観点

- `Note` の `id`, `title`, `body`, `tags`, `updatedAt`, `pinnedAt`, Custom metadata が欠けないこと。
- 既存の `pinnedAt` がないノートは未固定として読み込め、JSON Backup／ImportとDelete／Undoでは固定状態をroundtripでき、Markdown Import／Exportでは固定状態をfrontmatterへ混入させないこと。
- frontmatter の invalid data を誤って採用しないこと。
- 予約属性と危険なkeyをCustom metadataとして採用せず、未知の安全な属性はroundtripで保持すること。
- 同名タグ、大小文字違いタグの重複扱いが一貫すること。
- import/export 後に Markdown 本文が意図せず変形しないこと。
- Previewへのファイルドロップは表示中ノートの本文を挿入・置換せず、対応ファイルから追加または更新されたノートだけを保存すること。
- Preview優先表示およびタブ切替だけでは本文、metadata、dirty状態、保存データが変化しないこと。
- Previewリンクによる一覧スクロールと保留IDは表示状態だけに作用し、ノート順、Filter条件、本文、metadata、dirty状態、IndexedDBを変更しないこと。
- カードからの削除で対象ID以外のノート、未保存編集、Filter条件を変更せず、Undo時は元の一覧位置へ復元すること。
- Revert確認のCancel経路ではtitle、body、tags、Custom metadata、Marp設定、未確定タグ入力が失われず、確定時だけ保存済みまたは初期draftの値へ戻ること。

### 13.4 UI 観点

- desktop と mobile で主要操作に到達できること。
- Application menu、Import Markdown、Revert changes、More actions、Table of contentsは通常時／disabled時に枠線と背景が透明で、hover、keyboard focus、展開中は枠線と薄い背景を表示し、クリック領域とTooltipを維持すること。
- desktop、390px、320pxで選択中カードの縦3点ボタンがタイトルと重ならず、先頭／末尾カードのメニューがviewport外またはスクロール領域の背後へ切れないこと。
- desktop、390px、320pxで固定済みカードのピンボタンが常時表示され、未選択の固定カードからもUnpin／Deleteへ到達できること。Unpinでボタンが消える場合は同じカード本体へフォーカスが移ること。
- desktop、390px、320pxでSidebar固定領域が消えず、カード一覧とdocumentの二重スクロールおよび横あふれが発生しないこと。
- desktop、390px、320pxでノート見出しが `NOTES (n)` または `NOTES (filtered of total)` の1行表示を維持し、Filter／Clearと重ならないこと。
- desktopとmobileでノートカードとスクロールバーの間隔が8px、スクロールバーと右外枠の間隔が4px確保されること。Sidebar、Editor、固定ヘッダーの左右外周余白がdesktopでは16px、mobileでは12pxとなり、Preview／Edit／SlidesおよびEdit拡大時に一貫すること。
- desktop と mobile の両方でタブがPreview、Edit、Slidesの順に表示され、選択状態とキーボードのフォーカス移動順が一致すること。
- PCのEdit／Previewでファイルをドラッグ中は同じImport案内を表示し、dragleave、drop、Import処理終了後に強調表示が残らないこと。
- desktopではPreviewリンク先カードがSidebarのスクロール領域内へ最小距離で現れ、mobileではEditor表示中にdocumentを動かさず、Notesへ戻った時だけ同じカードが見えること。reduced motion時はsmooth animationを使用しないこと。
- Metadata追加前後で既存Edit画面のTitle、Tags、Body配置が変わらないこと。
- PCとmobileでMetadata dialogのread-only属性、Custom row、内部scroll、footer、focus管理へ到達できること。
- Dialogの項目順が実際のExport frontmatterと一致すること。
- Revert確認が他の確認dialogと同じ幅、外枠、背景、影、ボタン順で表示され、Cancelに初期フォーカスがあり、Cancel／背景クリック／Escape後はRevert changesボタンへフォーカスが戻ること。
- 保存状態がユーザーに誤解されないこと。
- 削除、未保存変更、バックアップなどの確認/通知が十分であること。
- キーボード操作とスクリーンリーダー利用に必要な semantics があること。
- カード本体と縦3点ボタンを個別にTab選択でき、Enterで開き、Escapeおよび削除確認Cancelで起点へフォーカスが戻ること。

## 14. フェーズ2拡張設計（手動バックアップ実装済み）

任意の GitHub ログインと暗号化 Gist バックアップは、現行ローカル機能を維持した追加機能として設計する。2026年8月3日時点でローカルJSON共通化、安全な復元基盤、ブラウザ暗号化、Production gate・session・CSRF、GitHub OAuth、Gist検出・候補選択・作成・更新、手動Cloud Backup UIまで実装済みである。クラウド復元UIとProduction有効化は未実装で、cloud feature flagは既定offを維持する。上記 1～13 は引き続き利用者向けローカル仕様を表す。

### 14.1 方針

- IndexedDB を引き続きローカルデータの正本とする。
- 未ログイン、認証確認中、認証エラー、オフラインでもローカル編集・保存・import/export を妨げない。
- GitHub App の認証と Gist 操作は Vercel Functions を経由し、token と client secret をブラウザ JavaScript へ渡さない。
- Markdown はブラウザ内で AES-GCM により暗号化し、Gist とサーバーには暗号文だけを渡す。
- backup/restore は利用者の明示操作だけで開始し、ログイン完了や通信復旧で自動実行しない。
- restore は preview 後の安全な merge と単一 IndexedDB transaction を使用し、無警告の上書き・削除・部分反映を防ぐ。
- Sign out と GitHub 連携解除で IndexedDB と Gist を削除しない。
- `https://mkb.bamboosato.com/` と `https://markdown-knowledge-board.vercel.app/` を有効な別 Origin として扱う。
- GitHub認証・クラウド機能はVercel Productionだけで提供し、Preview deploymentとlocalhostでは無効化する。Previewに本番秘密情報を配布せず、ローカル機能だけを利用可能とする。

### 14.2 設計文書

- [フェーズ2 認証・クラウドバックアップ要件定義](./phase2-auth-cloud-backup-requirements.md)
- [フェーズ2 認証・クラウドバックアップ基本設計](./phase2-auth-cloud-backup-architecture.md)
- [フェーズ2 API・認証詳細設計](./phase2-auth-cloud-backup-api-design.md)
- [フェーズ2 フロントエンド詳細設計](./phase2-auth-cloud-backup-frontend-design.md)

実装時は上記文書の要件 ID とテスト観点をトレースし、実装完了後に本書 1～13 の技術構成、データ設計、画面仕様、状態管理、エラー仕様を実装内容へ同期する。

