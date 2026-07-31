# Markdown Knowledge Board Editツールバーメニュー要件

作成日: 2026-07-31

状態: 実装済み（2026-07-31）

関連文書: [現行設計仕様](./design-spec.md)、[Editツールバーメニュー詳細設計](./edit-toolbar-menu-design.md)、[UI/UX改善仕様案](./ui-ux-improvement-spec.md)

## 1. 目的と推奨方針

Edit画面のBodyツールバーに直接並ぶ10個のMarkdown操作を、4個の新しい操作と合わせて、次の3つのプルダウンメニューへ再編する。

```text
Body  [ Format ▾ ] [ Paragraph ▾ ] [ Insert ▾ ]  [ Expand ]
```

初期対応では情報設計と操作導線を変更し、Highlight、Heading 3、Table、Code blockを追加する。Highlightの`==text==`だけは現行Previewで解釈されないため、安全なPreview変換と表示スタイルも同じ対応に含める。Note型、IndexedDB、Import / Export / Backup形式は変更しない。

「Obsidianのようなメニュー」は、カテゴリ分け、文字ラベル付きトリガー、選択中のメニューだけを開く操作モデルを指す。外観や全コマンドをそのまま複製することは目的としない。

## 2. テスト設計観点

詳細要件やテストケースより先に、本変更で確認する観点を固定する。

### 2.1 観点一覧

| 分類 | 主な観点 | 検証意図 | まず防ぐべき不具合 |
| --- | --- | --- | --- |
| 機能観点 | 3メニューの開閉、既存10操作、新規4操作、排他的表示、操作後のフォーカス復元 | 既存の編集能力を失わず、新規操作が編集からPreviewまで一貫して動くこと | 選択範囲とは異なる位置へMarkdownを適用すること |
| 非機能観点 | キーボード操作、支援技術、レスポンシブ、長文時の応答、イベント競合 | 端末や入力手段に依存せず操作できること | キーボードだけでは項目を選べないこと、モバイルでメニューが画面外へ出ること |
| データ観点 | 本文、選択範囲、キャレット、ブロック境界、フェンス長、スクロール位置、dirty状態、Undo | メニュー操作以外の本文や保存状態を壊さないこと | 本文の意図しない置換、選択範囲やスクロール位置の消失 |
| UI観点 | 配置、ラベル、開閉状態、hover / focus、重なり、画面端 | どの種類の操作がどこにあるかを明確にすること | メニューがBodyやExpandボタンに隠れること、横スクロールが発生すること |

優先度は次のように判断する。

| 優先度 | 対象 |
| --- | --- |
| 致命 | ツールバー操作によって選択範囲外の本文を破壊し、Undoでも戻せない |
| 重大 | 既存操作の欠落、選択範囲の消失、キーボード操作不能、メニューの画面外表示、Body編集不能 |
| 軽微 | 余白、アイコン位置、hover色など、操作結果に影響しない表示差 |

### 2.2 正常系・異常系・境界値・状態遷移

| 区分 | 検証対象 |
| --- | --- |
| 正常系 | 各トリガーから対応メニューを開く、各既存コマンドを実行する、実行後に本文へフォーカスを戻す |
| 異常系 | メニュー外クリック、Escape、Tab離脱、Edit以外へのタブ切替、ノート切替、Expand切替中の開いたメニューを安全に閉じる |
| 境界値 | 空本文、選択なし、1文字選択、本文先頭・末尾、複数行選択、日本語・絵文字、長文、コード内の`==`、選択内のバッククォート、320 / 390 / 900 / 1440px幅 |
| 状態遷移 | closed → Format / Paragraph / Insert、メニューA → メニューB、open → execute、open → Escape、open → outside click |

状態依存・タイミング依存として、次を重点確認する。

- Bodyの選択範囲を作った後にトリガーと項目へフォーカスが移っても、実行対象の範囲が変わらないこと。
- `pointerdown`、`click`、Reactのstate更新、`requestAnimationFrame`によるフォーカス復元の順序が変わっても結果が安定すること。
- メニューを素早く切り替えたり項目を連続実行したりしても、2つのメニューが同時に残らないこと。
- 単独実行だけでなく、メニュー操作 → Preview → Edit、Expand → Collapse、ノート保存までの通し操作でも成功すること。
- PCのマウス、キーボード、タッチ操作と、Chromiumのモバイル相当viewportで再現性を確認すること。

### 2.3 テストケース概要

| ID | 前提条件 | 操作 | 期待結果と検証意図 |
| --- | --- | --- | --- |
| TB-01 | Editを表示 | Formatを開く | Formatだけが開き、`aria-expanded`と表示状態が一致すること |
| TB-02 | Formatを表示 | Paragraphを開く | Formatが閉じParagraphだけが開くこと。排他制御を検証する |
| TB-03 | 本文の一部を選択 | Boldを実行 | 元の選択範囲だけを`**`で囲み、本文へフォーカスが戻ること |
| TB-04 | 本文内にキャレットを置く | Heading 1を実行 | 現在行だけに既存仕様の`# `トグルを適用すること |
| TB-05 | 選択範囲あり | Linkを実行 | 選択文字をリンクラベルとして既存仕様のMarkdownを挿入すること |
| TB-06 | メニューを表示 | Escape | 本文を変更せず閉じ、トリガーへフォーカスを戻すこと |
| TB-07 | メニューを表示 | 外側をクリック | 本文を変更せず閉じること |
| TB-08 | トリガーへキーボードフォーカス | Enter / Space、ArrowDown、ArrowUp、Home、Endを操作 | メニューを開き、項目間を規定どおり移動できること |
| TB-09 | 320pxおよび390px幅 | 3メニューを順に開く | ページ横スクロールが発生せず、項目がviewport内で選べること |
| TB-10 | 長文をスクロールして文字列を選択 | 任意の既存操作を実行 | 本文スクロール位置と対象選択が維持され、dirty状態になること |
| TB-11 | 選択なし | Bold / Italic / Strikethrough / Inline codeを実行 | 現行どおり本文を変更しないこと。無選択時改善を混在させない |
| TB-12 | 操作直後 | ブラウザのUndoを実行 | ツールバー操作前の本文へ戻ること |
| TB-13 | 1行の文字列を選択 | Highlightを実行してPreviewを表示 | 選択範囲だけを`==`で囲み、Previewでは`mark`相当として表示すること。通常テキストとコードを取り違えないこと |
| TB-14 | 本文内にキャレットを置く | Heading 3を実行 | 現在行だけに`### `をトグルし、PreviewのH3およびTOCへ反映すること |
| TB-15 | 空本文、行中、既存選択ありの各状態 | Tableを実行 | 2列のGFM Tableを独立ブロックとして挿入し、既存選択を消さず、Previewで表になること |
| TB-16 | 選択なし、選択あり、選択内にバッククォートありの各状態 | Code blockを実行 | コード内容を失わない十分な長さのフェンスを使用し、Previewで通常のコードブロックになること |
| TB-17 | 連続する複数行を部分的または全体選択 | Bulleted list／Task listを実行 | 選択が触れる非空行を一括リスト化し、空行と選択外本文を維持すること。全行設定済みなら一括解除し、混在時は未設定行だけへ付与すること |

同一ブラウザインスタンスへE2Eを並列操作せず、失敗時にはviewport、対象本文、選択開始・終了位置、activeElement、開いているメニューIDを証跡として取得する。

## 3. 対象範囲

### 3.1 対象

- Bodyツールバーの10個の直接操作ボタンを3つの文字ラベル付きメニューへ置き換え、4個の新規操作を同じメニューへ追加する。
- 各メニューの開閉、キーボード操作、フォーカス管理、画面端での配置を追加する。
- 既存のMarkdown編集関数を各メニュー項目から呼び出し、TableとCode blockのブロック挿入処理を編集helperへ追加する。
- Obsidian互換の`==text==`をPreviewの`mark`相当へ変換し、Preview用スタイルを追加する。
- 現在の30px editor control tierとExpand / Collapseボタンを維持する。
- 既存E2Eの直接ボタン前提を新しいメニュー導線へ更新し、メニュー専用E2Eを追加する。

### 3.2 対象外

- Highlight以外の新しいインラインMarkdown記法の追加。
- 現在保留中の無選択時プレースホルダー挿入。
- Markdownショートカットの新設。
- Note型、保存、Import / Export / Backup形式の変更。

## 4. メニュー構成

利用者向け文言は現行仕様に合わせて英語とする。初期構成は次のとおりとする。

| メニュー | 表示項目 | 現行操作 | Markdown処理 |
| --- | --- | --- | --- |
| Format | Bold | Bold | 選択範囲を`**`で囲む |
| Format | Italic | Italic | 選択範囲を`*`で囲む |
| Format | Strikethrough | Strike | 選択範囲を`~~`で囲む |
| Format | Inline code | Code | 選択範囲をバッククォートで囲む |
| Format | Highlight | 新規 | 選択範囲を`==`で囲む |
| Paragraph | Heading 1 | H1 | 現在行の`# `をトグルする |
| Paragraph | Heading 2 | H2 | 現在行の`## `をトグルする |
| Paragraph | Heading 3 | 新規 | 現在行の`### `をトグルする |
| Paragraph | Bulleted list | Bullet | キャレット行、または選択が触れる複数行の`- `をトグルする |
| Paragraph | Task list | Task | キャレット行、または選択が触れる複数行の`- [ ] `をトグルする |
| Paragraph | Blockquote | Quote | 現在行の`> `をトグルする |
| Insert | Link | Link | 選択範囲またはプレースホルダーからMarkdownリンクを挿入する |
| Insert | Table | 新規 | 2列のGFM Tableテンプレートを挿入する |
| Insert | Code block | 新規 | 選択範囲またはプレースホルダーをフェンスで囲む |

TableとCode blockは、現行の`remarkGfm`、Preview table CSS、fenced code block表示を利用できる。HighlightはGFM標準ではないため、`==text==`をコードスパンやfenced code blockの外側だけで認識するPreview拡張を追加する。

Insertは将来のImage、Horizontal rule、Mermaid blockなどを追加できる構造とする。追加項目はPreview対応、選択範囲、無選択時、複数行時の挙動を個別に合意してから有効化する。

## 5. 機能要件

### 5.1 ツールバー

- Bodyラベルの右側に`Format`、`Paragraph`、`Insert`の順で配置する。
- 各トリガーには文字ラベルと下向きのchevronを表示する。
- Expand / Collapseはメニューへ入れず、従来どおり右端の独立ボタンとする。
- ツールバー全体は`role="toolbar"`と`aria-label="Markdown tools"`を維持する。
- メニューを閉じた状態で3トリガーが常に識別できること。

### 5.2 開閉

- トリガーのclick、Enter、Spaceで対応メニューを開閉する。
- 同時に開けるメニューは1つだけとする。
- 別のトリガーを選ぶと、現在のメニューを閉じて選択したメニューを開く。
- 項目実行、Escape、メニュー外のpointerdown、Edit以外への表示切替、ノート切替で閉じる。
- Escapeで閉じた場合は、開いていたメニューのトリガーへフォーカスを戻す。
- 項目実行後は、既存の`applyEdit`契約に従ってBodyへフォーカスを戻す。

### 5.3 選択範囲と編集

- メニューを開く直前のBodyの`selectionStart`、`selectionEnd`、`scrollTop`、`scrollLeft`を保持する。
- メニュー項目の実行は保持した選択範囲へ適用し、メニュー操作によるフォーカス移動後の偶発的な選択状態を使用しない。
- 編集後の選択範囲、キャレット、スクロール位置、dirty状態は既存の編集関数と`applyEdit`の契約を維持する。
- Formatの5操作は、初期対応では選択範囲がない場合に本文を変更しない。Highlightは改行を含まない選択範囲を対象とする。
- Heading 1〜3とBlockquoteは現在行のプレフィックス処理を利用する。Bulleted listとTask listは選択範囲が空なら現在行、複数行選択なら選択が触れる全行を対象とする。
- 複数行のリスト処理は空行を変更しない。対象の非空行がすべて同じプレフィックスを持つ場合は一括解除し、それ以外は未設定行だけへ付与する。
- メニューを開閉しただけでは本文とdirty状態を変更しない。

### 5.4 新規操作

#### Highlight

- 選択範囲を`==`で囲み、編集後も内側の文字列を選択状態にする。
- Previewでは`==highlight==`を`<mark>highlight</mark>`相当として表示する。
- inline code、fenced code block、Mermaid code、エスケープされた区切りの内部ではHighlightとして解釈しない。
- 空の`====`、閉じ区切りがない`==text`、改行をまたぐ範囲をHighlightとして解釈しない。
- Previewで生成する要素は固定の`mark`相当とし、入力から任意HTMLを生成しない。

#### Heading 3

- 現在行の`### `を既存H1 / H2と同じ規則でトグルする。
- PreviewではH3として表示し、現在のH1〜H3 TOC抽出対象に含める。

#### Table

- 次の2列テンプレートを、前後に必要な空行を補って独立したブロックとして挿入する。

```markdown
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
```

- 挿入後は`Header 1`を選択し、すぐ置換入力できる状態にする。
- 選択範囲がある場合は選択文字列を削除せず、その直後へTableを挿入する。
- 行中、リスト内、引用内から実行しても、既存行を壊さずGFM Tableとして解析できるブロック境界を作る。

#### Code block

- 選択範囲がある場合はその内容をfenced code blockで囲み、選択内容を保持する。
- 選択範囲がない場合は`code`プレースホルダーを持つfenced code blockを挿入し、`code`を選択する。
- 基本フェンスは3個のバッククォートとする。内容に同長以上の連続バッククォートがある場合は、それより1個長いフェンスを使用する。
- 前後に必要な空行を補い、既存行や後続Markdownをコードブロックへ誤って取り込まない。
- 言語指定は初期値なしとし、利用者が開始フェンスへ追記できるようにする。

### 5.5 キーボード

- トリガーは通常のTab順序に含める。
- Enter / Spaceでメニューを開き、最初の項目へフォーカスを移す。
- ArrowDown / ArrowUpで次／前の項目へ移動し、端では循環する。
- Home / Endで最初／最後の項目へ移動する。
- Escapeで閉じ、トリガーへ戻す。
- Tab / Shift+Tabではメニューを閉じ、ブラウザ標準の次／前のフォーカス先へ移動する。
- 項目のEnter / Space実行後はメニューを閉じ、Bodyへ戻す。

### 5.6 アクセシビリティ

- トリガーへ`aria-haspopup="menu"`、`aria-expanded`、`aria-controls`を設定する。
- ポップオーバーへ`role="menu"`とカテゴリを表す`aria-label`を設定する。
- 各操作へ`role="menuitem"`を設定し、アイコンだけでなく可視の英語ラベルを表示する。
- 開閉状態とDOM表示を一致させ、閉じたメニュー項目をTab順序やアクセシビリティツリーへ残さない。
- `:focus-visible`でトリガーと項目の現在位置を視認できること。

## 6. UI要件

- トリガーの高さは`var(--control-editor-height)`を使用し、Expand / Collapseと揃える。
- ポップオーバーはトリガー直下へ表示し、Body textarea、sticky header、他メニューより前面に出す。
- Formatは左寄せ、Insertは右寄せを基本とし、viewport端で切れない配置とする。
- ポップオーバーには最大幅と最大高を設定し、必要な場合はメニュー内部だけを縦スクロールさせる。
- 320px幅でもアプリ全体の横スクロールを発生させない。3トリガーとExpandが1行に収まらない場合は、Bodyラベルを上段、操作群を下段とする現在のモバイル構造内で操作群だけを折り返せるようにする。
- 390px以上では`Body [Format] [Paragraph] [Insert] [Expand]`の関係が一目で分かる配置を優先する。
- expanded editorでも同じメニュー順序、サイズ、開閉仕様を維持する。
- メニュー開閉に必須のアニメーションは設けない。追加する場合は`prefers-reduced-motion`で無効化する。

## 7. 実装方針

### 7.1 コンポーネント

`App.tsx`へ3組の開閉処理を重複実装せず、共通の`MarkdownToolbarMenu`コンポーネントとコマンド定義を用いる。

```text
src/
  components/
    MarkdownToolbarMenu.tsx
  lib/
    markdownEdit.ts              既存の変換処理を継続利用
    remarkSingleLineHighlight.ts 複数行Highlightの通常text復元
  App.tsx                        メニュー構成と編集handlerを接続
  App.css                        toolbar / trigger / popover / item
```

開いているメニューは`"format" | "paragraph" | "insert" | null`の単一stateで管理し、排他性を構造的に保証する。

### 7.2 コマンド定義

メニューの表示と実行を分離し、少なくとも`id`、`label`、`group`、`icon`、`execute`、`requiresSelection`を定義できる形にする。将来項目を追加するときにJSX、ARIA、開閉処理を複製しない。Table、Code block、複数行リストは、挿入文字列、対象行、選択範囲を返す純粋関数として`markdownEdit.ts`でテスト可能にする。

### 7.3 イベント処理

- Bodyの`onSelect`またはメニューを開く直前に編集対象範囲をsnapshotする。
- トリガーや項目のpointer操作で選択範囲が失われないことを実ブラウザで確認する。
- 外側クリックと項目clickが競合してexecute前にstateやsnapshotを破棄しないよう、包含判定を行う。
- window event listenerはメニューを開いている間だけ登録し、cleanupする。
- Editタブの非表示化、ノート切替、コンポーネントunmount時に開閉stateとlistenerを残さない。

## 8. 受け入れ条件

- Bodyツールバーが`Format`、`Paragraph`、`Insert`の3メニュー表示になり、既存の直接操作ボタンが残っていない。
- 現在の10操作が欠落なく対応メニューから実行でき、Markdown結果が変更前と一致する。
- Highlight、Heading 3、Table、Code blockの4操作が定義したMarkdownを生成し、Preview結果まで確認できる。
- Bulleted listとTask listは複数行選択を一括変換・解除でき、部分行選択、空行、既存プレフィックス混在、選択末尾が次行先頭にある境界でも対象外の行を変更しない。
- メニュー操作前の選択範囲へ処理が適用され、操作後にBodyのフォーカス、選択範囲、スクロール位置が適切に復元される。
- 1つのメニューだけが開き、項目実行、Escape、外側クリック、表示状態の切替で確実に閉じる。
- マウス、キーボード、タッチ相当操作で到達・実行でき、ARIAの開閉状態が表示と一致する。
- 320 / 390 / 900 / 1440px幅とexpanded editorでメニューがviewport外へはみ出さず、ページ横スクロールを発生させない。
- メニューの開閉だけでは本文、dirty状態、保存データを変更しない。
- Highlightの区切りを通常テキストだけで解釈し、inline code、fenced code block、Mermaid codeの内容を変更しない。
- `npm run lint`、`npm run build`、対象Playwright E2Eが成功し、コンソールエラーがない。

## 9. 段階的な拡張

### 第1段階: 本要件の対象

- 3メニューへの再編。
- 既存10操作の移設と、Highlight、Heading 3、Table、Code blockの追加。
- 選択範囲保持、キーボード、ARIA、レスポンシブ対応。
- Bulleted list／Task listの複数行一括変換・解除。
- HighlightのPreview変換と表示スタイル。

### 第2段階: 別要件として検討

- Format無選択時のプレースホルダー挿入。
- Paragraph、Heading 4〜6、Numbered list。
- Image、Horizontal rule、Mermaid blockなどのInsert項目。
- コマンドごとのキーボードショートカットと可視表示。
- Heading／Blockquoteを含む、リスト以外の複数行一括Paragraph変換。

第2段階では、追加数ではなく利用頻度、Preview互換性、モバイル操作性、Undo可能性を基準に優先順位を決める。
