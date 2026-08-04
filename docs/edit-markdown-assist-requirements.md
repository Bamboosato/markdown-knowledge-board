# Markdown Knowledge Board Edit Markdown記号アシスト要件定義

作成日: 2026-08-04

状態: 実装済み（自動検証完了、Windows実機IMEの手動確認は未実施）

関連文書: [現行設計仕様](./design-spec.md)、[Edit Markdown記号アシスト詳細設計](./edit-markdown-assist-design.md)、[Editツールバーメニュー要件](./edit-toolbar-menu-requirements.md)

## 1. 文書の目的

本書は、Edit画面のBodyへ入力されたMarkdownのうち、Previewで非表示になる記号または表示構造を変える記号だけを青系の文字色で識別しやすくする、軽量な編集アシスト機能の要件を定義する。

本機能はMarkdown本文を加工する機能ではない。保存対象の文字列、Note型、IndexedDB、Import / Export / Backup、PreviewおよびSlidesの解釈結果を変更せず、Edit画面上の表示だけを補助する。

## 2. 採用方針サマリー

| No. | 方針 | 決定内容 |
| --- | --- | --- |
| 1 | 編集基盤 | 部分文字列を安全に装飾するため、Bodyの`textarea`をCodeMirror 6へ置き換える。 |
| 2 | 機能範囲 | 構文色分け、補完、行番号などを一括導入せず、Markdown記号の着色に必要な最小構成だけを使用する。 |
| 3 | 着色範囲 | Previewで記法として成立するMarkdown記号だけを着色し、通常本文、リンクラベル、URL、コード本文は着色しない。 |
| 4 | 見た目 | 記号の文字色だけを青系へ変更し、フォントサイズ、太さ、書体、行間、背景色は本文と共通にする。 |
| 5 | 色 | 通常テーマの候補値を`#2563eb`とし、`--md-marker-color`で一元管理する。 |
| 6 | 構文 | Previewとの対応を優先し、CommonMark、GFMおよび既存の単一行`==highlight==`を対象にする。 |
| 7 | データ | CodeMirrorのdocumentと`draftBody`は同一のMarkdown文字列を表し、着色用要素や制御文字を本文へ混入させない。 |
| 8 | 操作互換 | Save、Revert、Undo / Redo、Edit / Preview切替、ツールバー、選択、スクロール、Expand / Collapseを維持する。 |
| 9 | 入力互換 | 日本語IME、貼り付け、モバイルキーボード、マウス、タッチ、キーボードだけの操作を維持する。 |
| 10 | 配布 | CodeMirror関連コードはアプリbundleへ含め、CDNや実行時の外部取得を使用しない。 |
| 11 | 文字サイズ | PCではEdit / Preview本文上の`Ctrl`+mouse wheelで、両画面に共通する本文倍率を80%〜180%の範囲で10%ずつ変更する。 |
| 12 | 操作範囲 | 専用のreset buttonは設けない。対象本文外のbrowser zoomとmobileの現行文字サイズは変更しない。 |

`textarea`と着色用`pre`を重ねる方式、および独自`contenteditable`方式は採用しない。両方式は、折り返し、scroll、selection、IME、モバイル選択、アクセシビリティを二重管理する必要があり、本機能の軽量さに対して回帰リスクが高いためである。

## 3. テスト設計観点

詳細要件やテストケースより先に、本変更で確認する観点を固定する。

### 3.1 観点一覧

| 分類 | 主な観点 | 検証意図 | まず防ぐべき不具合 |
| --- | --- | --- | --- |
| 機能観点 | 対象記号、非対象文字、Previewとの一致、ツールバー、Undo / Redo、Save / Revert、PCの`Ctrl`+wheel、Edit / Preview間の共通倍率 | 表示アシストだけを追加し、既存編集能力とMarkdown解釈を維持する | 記号着色や倍率変更のために本文、選択範囲、保存結果が変わること |
| 非機能観点 | IME、長文性能、主要3ブラウザ、mobile、offline、listener / timer cleanup、連続wheel、bundle | 入力手段、端末、負荷、通信状態、wheel頻度が変わっても編集を継続できること | IME確定文字の欠落、入力遅延、listener多重登録、別editor instanceからのstale更新 |
| データ観点 | Markdown文字列、改行、空白、Unicode、絵文字、外部同期、note境界、history境界、倍率の保存値と不正値fallback | Edit表示と保存データを分離し、note間の混入および不正な表示状態を防ぐこと | 別ノートの本文やUndo履歴の混入、倍率がNote / Export / Backupへ混入すること |
| UI観点 | 青色、contrast、本文色、font metrics、selection、caret、focus、scroll、expanded表示、80%〜180%、一時表示、desktop / mobile差 | 記号を識別しやすくし、疲眼時は本文だけを拡大しながら現行の軽い編集外観を維持すること | marker以外の誤装飾、caretや選択文字の不可視化、本文領域外まで拡大すること |

優先度は次のように判断する。

| 優先度 | 対象 |
| --- | --- |
| 致命 | 本文欠落・改変、別ノートへの書き込み、別ノート履歴のUndo、保存データへの装飾情報混入 |
| 重大 | 日本語IME中断、Save / Revert / toolbar不能、selectionまたはscroll消失、通常本文の誤着色、Edit不能 |
| 軽微 | 青色の微差、1px程度の余白差など、入力・保存・可読性へ影響しない表示差 |

### 3.2 正常系・異常系・境界値・状態遷移

| 区分 | 検証対象 |
| --- | --- |
| 正常系 | 有効なMarkdown記号だけを着色し、PCのEdit / Preview本文上で`Ctrl`+wheelを操作すると共通倍率が10%ずつ変わる |
| 異常系 | 無効構文、外部同期競合、不正な保存倍率、`Ctrl`なしのwheel、mobile、対象本文外の`Ctrl`+wheelを誤着色・誤更新・誤抑止しない |
| 境界値 | 空本文、記号1文字、Unicode、10万文字、多数marker、倍率80% / 100% / 180%、上限下限を超えるwheel、微小なtrackpad delta |
| 状態遷移 | Edit↔Preview↔Slides、note切替、新規draft、Save、Revert、Preview task更新、normal↔expanded、composition開始↔確定、focus↔blur、Undo↔Redo、倍率変更↔再読込 |

### 3.3 前提条件、順序依存、証跡

- 各テストは対象note、`draftBody`、active tab、selection、scroll、IME状態、viewportを明示して開始する。
- note切替、Revert、外部本文更新のテストは、直前のUndo historyとcompositionが残っていない独立状態でも、通し操作でも実施する。
- 単独のmarker判定だけでなく、入力→toolbar→Preview→Edit→Save→再読込の通し操作を確認する。
- PlaywrightではBody操作を共通helperへ集約し、`textarea`固有の`inputValue`、`selectionStart`、`selectionEnd`前提を残さない。
- 失敗時はnote ID、CodeMirror document、`draftBody`、selection anchor / head、scroll位置、composition状態、active element、装飾range、構文node名を証跡として取得する。
- IME実機確認を含め、同一実機に対して複数の自動化スクリプトを並列実行しない。
- タイミングだけで成否を決める固定sleepを避け、document値、transaction完了、表示range、最終scroll位置をpollingする。

## 4. スコープ

### 4.1 対象

- Edit画面のBody入力領域。
- Bodyの`textarea`からCodeMirror 6への置き換え。
- CommonMark、GFM、既存の単一行Highlightに含まれるMarkdown記号の表示上の着色。
- 現行Body editorの寸法、padding、font、line-height、line wrapping、focus表示、scroll所有の再現。
- 既存toolbar、選択・scroll復元、Save、Revert、Undo / Redo、Preview task更新との接続。
- Body用E2E helperおよびmarker判定のunit test。
- Chromium、Firefox、WebKit、desktop、390×844 mobile相当、日本語IMEの検証。
- PCのEdit / Preview本文上における`Ctrl`+mouse wheelの共通フォント倍率変更、再読込後の復元、一時的な倍率表示。

### 4.2 対象外

- Title、Tags、Metadata dialog、検索欄、その他inputの着色。
- 本文文字、見出し本文、強調本文をPreview風の大きさ・太さ・斜体へ変えること。
- 行番号、minimap、autocomplete、lint、spell checker、Markdown自動整形、auto-close、live preview。
- markerの非表示、折りたたみ、WYSIWYG化。
- URL、link label、image alt、code info string、code本文の着色。
- PreviewまたはSlidesのrenderer変更。
- 新しいMarkdown記法の追加。
- Note型、IndexedDB schema、Import / Export / Backup形式の変更。
- 利用者が色や対象記法を変更する設定UI。
- mobileでの本文倍率変更、専用の倍率slider / reset button、OSまたはbrowser全体の拡大率変更。

## 5. 用語

| 用語 | 定義 |
| --- | --- |
| Body editor | Edit画面で`draftBody`を編集する領域。実装後はCodeMirror 6のEditorViewを指す。 |
| marker | Markdown構文を成立させるdelimiter、prefix、separatorなどの記号範囲。 |
| content | marker以外の利用者本文。link label、URL、code本文、code info stringを含む。 |
| valid marker | Previewと対応する構文parserが有効なMarkdown構文として認識したmarker。 |
| marker decoration | documentを変更せずmarker rangeへ文字色classを付与するCodeMirror Decoration。 |
| external sync | note切替、Revert、Preview task更新など、Body editor外から`draftBody`を変更する処理。 |
| composition | 日本語IMEなどによる未確定文字列の入力状態。 |

## 6. UI要件

| ID | 要件 |
| --- | --- |
| MDA-UI-001 | valid markerだけに`--md-marker-color`を適用する。初期候補値は`#2563eb`とする。 |
| MDA-UI-002 | contentは現行Bodyと同じ文字色を維持する。 |
| MDA-UI-003 | markerとcontentのfont family、font size、font weight、font style、letter spacing、line-heightを同一にする。 |
| MDA-UI-004 | markerへ背景色、underline、outline、opacity、animationを追加しない。 |
| MDA-UI-005 | CodeMirrorのgutter、line number、active line背景、fold marker、autocomplete UIを表示しない。 |
| MDA-UI-006 | 現行`.textarea-fill`と同じ外枠、角丸、padding、最小高、通常時・expanded時の高さを維持する。 |
| MDA-UI-007 | 長い行は現行Bodyと同様に折り返し、Body editor全体の横scrollを通常操作として要求しない。 |
| MDA-UI-008 | selection、caret、IME未確定文字、browser検索結果の視認性をmarker色より優先する。選択中だけmarkerの青がselection前景色へ置き換わることを許容する。 |
| MDA-UI-009 | focus-visible状態は現行入力欄と同等以上に識別でき、focus有無でeditor寸法を変えない。 |
| MDA-UI-010 | `forced-colors: active`ではsystem colorを優先し、青色の固定によってmarkerまたはselectionを不可視にしない。 |
| MDA-UI-011 | placeholderは本文が空で未入力の場合だけ`Write markdown here...`を表示し、保存文字列へ含めない。 |
| MDA-UI-012 | PCではEdit本文を基準`0.95rem`、Preview本文を基準`1rem`のまま、共通倍率80%〜180%を適用する。倍率は10%刻みとする。 |
| MDA-UI-013 | 倍率変更時は`Text size: {倍率}%`を操作を妨げないstatusとして一時表示し、専用のreset buttonは表示しない。 |
| MDA-UI-014 | Preview見出しなどの相対的な文字サイズ比を保ち、Editのmarkerとcontentには常に同じ倍率を適用する。 |
| MDA-UI-015 | 900px以下のmobile表示では保存済み倍率を適用せず、現行のEdit / Preview文字サイズを維持する。 |

## 7. 機能要件

### 7.1 marker対象

| ID | 種別 | 着色する範囲 | 着色しない範囲 |
| --- | --- | --- | --- |
| MDA-FN-001 | ATX / Setext heading | 行頭の`#`列、Setext underlineの`=`または`-` | heading本文 |
| MDA-FN-002 | emphasis / strong | 開始・終了の`*`または`_` | 強調対象本文 |
| MDA-FN-003 | strikethrough | 開始・終了の`~~` | 取消対象本文 |
| MDA-FN-004 | Highlight | 同一行で成立する開始・終了の`==` | Highlight本文、未閉鎖`==`、code内の`==` |
| MDA-FN-005 | inline / fenced code | inline delimiter、開始・終了fenceのbacktickまたはtilde | code本文、fenceのlanguage info |
| MDA-FN-006 | blockquote | 行頭の`>` | 引用本文 |
| MDA-FN-007 | list | unordered marker、ordered markerの数字と区切り記号 | list本文 |
| MDA-FN-008 | task list | list markerと`[ ]`、`[x]`、`[X]` | task本文 |
| MDA-FN-009 | link / image / autolink | `!`、bracket、parenthesis、angle bracketなど構文を囲む記号 | label、alt、URL、title |
| MDA-FN-010 | GFM table | cell境界の`&#124;`、delimiter行の`-`、`:`、`&#124;` | header／cell本文 |
| MDA-FN-011 | horizontal rule | ruleを構成する`-`、`*`、`_` | 前後の空白・本文 |
| MDA-FN-012 | escape / hard break | escapeまたはbackslash hard breakの先頭`\` | escaped対象文字、trailing space hard breakの空白 |

### 7.2 判定規則

| ID | 要件 |
| --- | --- |
| MDA-FN-013 | CommonMarkとGFMはCodeMirrorのMarkdown parserが返す構文treeをmarker判定の正本とする。 |
| MDA-FN-014 | CodeMirror既定のGFM外拡張であっても、Previewが解釈しないsubscript、superscript、emoji短縮記法などは対象にしない。 |
| MDA-FN-015 | parserが構文として認識しない未閉鎖・不正なdelimiterをmarkerとして着色しない。 |
| MDA-FN-016 | escaped markerは構造markerとして着色せず、escape自身の`\`だけを着色する。 |
| MDA-FN-017 | inline codeおよびfenced code本文では、内側のMarkdown風文字をmarkerとして着色しない。 |
| MDA-FN-018 | tableのpipe判定はGFM Table node内部に限定し、通常本文やcode内のpipeを着色しない。 |
| MDA-FN-019 | marker装飾はdocument変更およびdirty状態変更を発生させない。 |

### 7.3 既存編集機能との互換

| ID | 要件 |
| --- | --- |
| MDA-FN-020 | Body編集transactionのdocument文字列を`draftBody`へ反映し、既存のdirty化と保存時刻更新を1回だけ実行する。 |
| MDA-FN-021 | Format、Paragraph、Insertのtoolbar commandはCodeMirrorの現在selectionを対象にし、実行後のselection、focus、scrollを維持する。 |
| MDA-FN-022 | Save shortcutの`Ctrl+S` / `Command+S`とNew Noteの`Alt+N` / `Option+N`を維持する。 |
| MDA-FN-023 | `Tab`はeditorへ閉じ込めず、現行どおり次のfocus可能要素へ移動する。`indentWithTab`は初期構成に含めない。 |
| MDA-FN-024 | 通常入力とtoolbar編集をUndo / Redoできる。note切替後のUndoで切替前noteの本文を復元しない。 |
| MDA-FN-025 | Edit / Preview / Slidesの切替だけではdocument、selection history、dirty状態を変更しない。 |
| MDA-FN-026 | Previewのtask checkbox操作を`draftBody`と非表示中のBody editorへ反映し、Editへ戻ったとき同じ本文を表示する。 |
| MDA-FN-027 | Expand / Collapse後にeditorを再計測し、selection、caret、scrollを維持する。 |
| MDA-FN-028 | 901px以上かつfine pointerのPCで、EditまたはPreview本文上の`Ctrl`+wheel上方向を+10%、下方向を-10%として扱う。`Meta`+wheelは対象にしない。 |
| MDA-FN-029 | 対象本文上の`Ctrl`+wheelだけをnon-passive listenerで抑止し、対象本文外の`Ctrl`+wheel、`Ctrl`なしのwheel、keyboardのbrowser zoomを変更しない。 |
| MDA-FN-030 | EditとPreviewは同じ倍率stateを共有し、mode切替、note切替、Save、Revertでは倍率をresetしない。 |
| MDA-FN-031 | 倍率変更後にCodeMirrorを再計測し、document、dirty状態、selection、caretを変更しない。 |

## 8. データ・状態要件

| ID | 要件 |
| --- | --- |
| MDA-DATA-001 | `view.state.doc.toString()`と`draftBody`は同期完了時に同一文字列とする。 |
| MDA-DATA-002 | marker Decoration、syntax tree、DOM class、placeholderを保存・Export・Backup対象へ含めない。 |
| MDA-DATA-003 | editor導入によって改行、末尾改行、空行、連続空白、全角文字、結合文字、絵文字を新たに正規化しない。 |
| MDA-DATA-004 | CodeMirror位置と既存編集helperのoffsetはUTF-16 code unitとして扱い、日本語・絵文字を含むselection境界を壊さない。 |
| MDA-DATA-005 | user transactionをReactから同じdocumentへ書き戻さず、同一編集による二重transactionと二重dirty更新を防ぐ。 |
| MDA-DATA-006 | 同一noteへのexternal syncは現在documentとの差分がある場合だけ適用する。 |
| MDA-DATA-007 | note ID変更、新規draft、Revertではeditor stateを新しい本文から再構成し、前noteまたは破棄対象本文のUndo historyを持ち越さない。 |
| MDA-DATA-008 | 同一noteのSaveではdocumentを置換せず、現在のUndo historyを維持する。 |
| MDA-DATA-009 | composition中の同一note external syncは確定まで保留し、staleなuser updateで新しい本文を上書きしない。note ID変更はstate境界として扱う。 |
| MDA-DATA-010 | unmountまたはnote state再構成後の旧EditorViewから届くcallbackをoperation tokenまたはinstance identityで無視する。 |
| MDA-DATA-011 | 本文倍率はversion付きlocalStorage keyへ整数percentで保存し、Note、IndexedDB、Markdown、Import / Export / Backupへ含めない。 |
| MDA-DATA-012 | 保存値が数値でない、有限でない、10%刻みでない、範囲外の場合は、最寄りの10%へ丸めて80%〜180%へ制限する。不明な値は100%へfallbackする。 |
| MDA-DATA-013 | localStorageの読込・保存が例外になっても100%または現在sessionの倍率で編集とPreviewを継続する。 |

## 9. 非機能要件

| ID | 要件 |
| --- | --- |
| MDA-NFR-001 | Chromium、Firefox、WebKitの現行E2E対象versionで編集、selection、Undo / Redo、marker表示が成立する。 |
| MDA-NFR-002 | Windows日本語IMEでcomposition開始、変換候補選択、確定、取消、連続入力を行っても文字欠落・重複・caret移動を発生させない。 |
| MDA-NFR-003 | 390×844相当のmobile viewportで横scroll、toolbar重なり、editorの高さ崩れを発生させない。 |
| MDA-NFR-004 | 10万文字かつmarkerを多数含む基準本文で、表示range外を毎keystroke全走査しない。基準Windows / Chromium環境で通常入力20回のtransactionから次frameまでの95 percentileを50ms以下とし、測定環境を証跡へ残す。 |
| MDA-NFR-005 | Decorationは表示rangeを中心に更新し、色だけの装飾でlayout再計算を発生させない。 |
| MDA-NFR-006 | CodeMirror instance、DOM listener、ViewPlugin、timerをunmount時に破棄し、note切替やReact Strict Modeで重複登録しない。 |
| MDA-NFR-007 | CodeMirror関連packageは必要なmoduleだけを導入し、umbrella packageの`basicSetup`を採用しない。実装PRでproduction bundle増分を記録する。 |
| MDA-NFR-008 | editor表示・入力・保存にruntime network requestを必要とせず、認証状態やcloud availabilityから独立させる。 |
| MDA-NFR-009 | wheel listener、delta accumulator、status timerを対象DOMの変更またはunmount時に解除し、React Strict Modeやtab切替で多重反応しない。 |
| MDA-NFR-010 | Chromium、Firefox、WebKitのPC相当viewportで倍率変更が同じ方向・刻み・境界となり、連続wheelでも1eventにつき意図しない複数段階を発生させない。 |

## 10. アクセシビリティ要件

| ID | 要件 |
| --- | --- |
| MDA-A11Y-001 | 編集可能要素をmultiline textboxとして公開し、既存の`Body`ラベルを`aria-labelledby`で関連付ける。 |
| MDA-A11Y-002 | `page.getByLabel("Body")`相当のアクセシブルな特定方法を維持する。DOM要素種別が`textarea`であることは契約にしない。 |
| MDA-A11Y-003 | marker色は白背景に対してWCAG AAの通常文字contrast 4.5:1以上を満たす。 |
| MDA-A11Y-004 | 色は補助情報とし、Markdown記号そのものを非表示にしない。色を認識できなくても編集内容を理解できる。 |
| MDA-A11Y-005 | keyboardだけでfocus、入力、selection、toolbar移動、Save、Undo / Redo、editorからのTab離脱ができる。 |
| MDA-A11Y-006 | browser zoom 200%およびOS text scalingでmarkerとcontentのbaseline、折り返し、caret位置がずれない。 |
| MDA-A11Y-007 | 倍率statusは`role="status"`と`aria-live="polite"`で通知し、focusを移動しない。keyboardによるbrowser zoom手段は維持する。 |

## 11. 受け入れテスト

| ID | 前提条件 | 操作 | 期待結果と検証意図 |
| --- | --- | --- | --- |
| MDA-AT-001 | Editに全対象記法を含む本文を表示 | markerとcontentのcomputed styleを取得 | valid markerだけが`--md-marker-color`であり、font metricsはcontentと一致する |
| MDA-AT-002 | 未閉鎖、escape、code内marker、無効tableを含む | Editを表示して入力を継続 | 不正範囲を誤着色せず、構文成立時だけ装飾rangeが更新される |
| MDA-AT-003 | 日本語・絵文字を含む本文 | IME入力、選択、toolbar、Undo / Redo | 文字、selection、caret、Undo単位を壊さない |
| MDA-AT-004 | 長文を途中までscrollして選択 | toolbar実行後にExpand / Collapse | 対象だけを編集し、focus、selection、scrollを維持する |
| MDA-AT-005 | 未保存本文 | Preview→Edit→Save→再読込 | Edit表示前後と保存後のMarkdown文字列が一致する |
| MDA-AT-006 | note Aを編集後、note Bへ切替 | Undoを実行 | note Aの本文をnote Bへ復元しない |
| MDA-AT-007 | 同一noteをEditとPreviewで表示 | Preview task checkboxを切替後Editへ戻る | task marker更新をBody editorへ反映し、marker着色とdirty状態が一致する |
| MDA-AT-008 | composition中 | 同一note external syncおよびcomposition確定を発生 | 未確定文字を重複・欠落させず、stale値で上書きしない |
| MDA-AT-009 | 390×844、900×800、1440×900 | 入力、scroll、toolbar、expanded表示 | 横scrollや重なりを発生させず現行Body寸法契約を維持する |
| MDA-AT-010 | cloud無効・offline | Editで入力して保存 | editor機能が通信を行わずローカル編集・保存を継続できる |
| MDA-AT-011 | 10万文字の基準本文 | 20回の通常入力とscroll | MDA-NFR-004の測定値を満たし、失敗時に文書長・node数・測定値を記録する |
| MDA-AT-012 | forced colorsおよび200% zoom | marker、selection、caret、focusを確認 | 内容が可読で、keyboard操作可能である |
| MDA-AT-013 | 1200px幅、Edit本文、倍率100% | 本文上で`Ctrl`+wheel上方向を2回操作 | 120%となり、本文とmarkerが同率で拡大し、document、dirty、selectionは変化しない |
| MDA-AT-014 | Editで110%へ変更済み | Preview切替、再読込、Preview本文上で下方向を操作 | Previewも110%で表示し、再読込後も復元し、100%へ戻せる。専用reset buttonはない |
| MDA-AT-015 | 390px幅または対象本文外 | `Ctrl`+wheelおよび通常wheelをdispatch | アプリ倍率は変わらず、eventを抑止しない。PC対象本文上だけbrowser zoom抑止が成立する |

## 12. 実装・移行条件

1. CodeMirror導入前に、現行textareaのBody値取得・入力・selection操作を共通E2E helperへ移す。
2. marker着色を有効化する前に、CodeMirrorで既存Save、Revert、toolbar、Undo / Redo、Preview task、Expand / Collapseが通ることを確認する。
3. marker parserとDecorationを追加し、unit testでrangeを固定する。
4. 主要3ブラウザ、mobile、長文、日本語IMEを順に確認する。
5. 実装完了後に本書の状態、[詳細設計](./edit-markdown-assist-design.md)、[現行設計仕様](./design-spec.md)を実装結果へ同期する。

初期実装では色設定、auto completion、live preview、marker非表示を追加しない。これらは本機能の安定性を確認した後、別要件として検討する。
