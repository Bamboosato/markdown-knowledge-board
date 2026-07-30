# Markdown Knowledge Board Preview目次（TOC）要件定義

作成日: 2026-07-30

状態: 実装済み

関連文書: [Preview目次（TOC）詳細設計](./preview-toc-design.md)

## 1. 文書の目的

本書は、Markdown Knowledge Board のPreview表示に、表示領域を恒常的に狭めずに文書内の見出しへ移動できる目次（TOC: Table of Contents）参照機能を追加するための要件を定義する。

現行アプリの基本仕様は [design-spec.md](./design-spec.md) に従う。本機能はPreviewの閲覧補助であり、Markdown本文、保存形式、Import / Export / Backupのデータ構造を変更しない。

## 2. 採用方針サマリー

| No. | 方針 | 決定内容 |
| --- | --- | --- |
| 1 | 表示領域 | TOCはオーバーレイ型ポップオーバーとし、Preview領域の恒常的な幅や高さを減らさない。 |
| 2 | 配置 | `Edit` / `Preview` / `Slides` を配置するeditor tab rowの右端にTOCトリガーを配置する。 |
| 3 | 表示条件 | TOCトリガーはPreview選択時だけ表示し、対象見出しがない場合はdisabledにする。 |
| 4 | 対象見出し | 初期実装ではPreviewに描画されるH1、H2、H3を対象とする。H4〜H6は対象外とする。 |
| 5 | 移動方式 | PCではPreview内部、モバイルではdocumentをスクロールし、固定ヘッダーで見出しを隠さない。 |
| 6 | モーション | 通常はスムーズスクロールと短い開閉アニメーションを使用し、`prefers-reduced-motion: reduce`では即時表示・即時移動とする。 |
| 7 | アクセシビリティ | キーボード、フォーカス表示、スクリーンリーダーでTOCを認識・操作できるようにする。 |
| 8 | 対象外 | 現在位置の自動追従表示、URL fragment更新、H4〜H6の選択設定は初期実装に含めない。 |

## 3. テスト設計観点

詳細要件より先に、本機能で優先するテスト観点を定義する。

### 3.1 観点一覧

| 分類 | 主な観点 | まず防ぐべき不具合 |
| --- | --- | --- |
| 機能観点 | 見出し抽出、階層表示、項目選択、ポップオーバー開閉、スクロール | 選択した見出しとは異なる位置へ移動すること |
| 非機能観点 | 長文性能、モーション設定、レスポンシブ、スクロール競合 | TOCによってPreview操作や画面スクロールが停止すること |
| データ観点 | 見出しなし、重複、同名・異階層、装飾文字、日本語、長文、多数見出し | 同名見出しが同じ対象へ誤って集約されること |
| UI観点 | 配置、重なり、最大高、hover、focus、画面端、固定ヘッダー | ポップオーバーがviewport外へはみ出すこと |

### 3.2 正常系・異常系・境界値・状態遷移

| 区分 | 検証対象 |
| --- | --- |
| 正常系 | H1〜H3抽出、階層表示、PC内部スクロール、モバイルdocumentスクロール、項目選択後の自動クローズ |
| 異常系 | 見出しDOMが取得できない、描画更新中、対象見出しが選択前に消える、ポップオーバー外クリック |
| 境界値 | 0件、1件、多数、同名見出し、H1を欠くH2/H3、長い見出し、日本語、inline codeや強調を含む見出し |
| 状態遷移 | Edit／Preview／Slides切替、ノート切替、本文変更、TOC開閉、ESC、外側クリック、項目選択、viewport変更 |

### 3.3 前提条件と実行方針

- PCとモバイルはスクロール所有者が異なるため、同一の期待値を流用せず個別に検証する。
- テスト開始時にviewport、選択ノート、active tab、Previewスクロール位置、`prefers-reduced-motion`を明示する。
- 同一ブラウザページを使う通しテストでは、前ケースのスクロール位置、TOC開閉状態、フォーカス状態が残っていないことを確認する。
- スムーズスクロールの時間そのものに依存せず、最終的な見出し位置とスクロール所有者をpollingで検証する。
- 失敗時は対象見出しのlevel、出現順、bounding box、Previewとdocumentの`scrollTop`、active elementを証跡として取得する。
- 実機確認を行う場合、同一実機に対して複数の自動化スクリプトを並列実行しない。

## 4. スコープ

### 4.1 対象

- PreviewのH1〜H3からのTOC生成
- editor tab rowへのTOCトリガー配置
- オーバーレイ型TOCポップオーバー
- 見出しlevelに応じた階層表示
- PCとモバイルに適した見出し位置への移動
- TOCの自動クローズ
- reduced motion対応
- キーボードおよびスクリーンリーダー対応

### 4.2 対象外

- EditまたはSlides内のTOC
- H4〜H6の表示および表示levelの利用者設定
- スクロール位置に追従するactive heading表示
- URL hashの生成・更新・ブラウザ履歴との連携
- TOCの常設Sidebar表示
- TOC項目の編集、並べ替え、折りたたみ
- 見出し番号の自動付与
- TOC設定の永続保存

## 5. 用語

| 用語 | 定義 |
| --- | --- |
| editor tab row | `Edit` / `Preview` / `Slides` と各表示モード固有操作を配置する行。画面最上部の固定ヘッダーとは区別する。 |
| TOCトリガー | TOCポップオーバーを開閉するアイコンボタン。 |
| TOC項目 | 対象見出しのlevel、表示文字列、出現順、描画先要素を対応付けた項目。 |
| Previewスクロール領域 | PCでPreview本文のスクロールを所有する`.mdPreview-scroll`。 |
| documentスクロール | モバイルでページ全体が所有する縦スクロール。 |

## 6. UI要件

### 6.1 トリガー

| ID | 要件 |
| --- | --- |
| TOC-UI-001 | TOCトリガーはeditor tab row内でタブ群の後ろに配置し、利用可能な余白がある場合は行の右端へ寄せる。 |
| TOC-UI-002 | TOCトリガーは`activeTab === "preview"`の場合だけ表示する。EditとSlidesでは表示しない。 |
| TOC-UI-003 | アイコンは`lucide-react`の目次または階層リストを想起できるアイコンを使用し、テキスト`TOC`だけのボタンにはしない。 |
| TOC-UI-004 | accessible nameとTooltipは`Table of contents`とする。 |
| TOC-UI-005 | 対象となるH1〜H3が0件の場合はdisabledとし、Tooltipは`No headings`とする。 |
| TOC-UI-006 | ボタンサイズ、角丸、border、focus outlineは既存のコンパクトアイコン操作と整合させる。 |

### 6.2 ポップオーバー

| ID | 要件 |
| --- | --- |
| TOC-UI-007 | TOCトリガー押下時、トリガー直下を基準にカード型ポップオーバーをオーバーレイ表示する。本文レイアウトを押し下げない。 |
| TOC-UI-008 | ポップオーバーはviewportの左右端からはみ出さないよう、PCでは右端基準、狭い画面では利用可能幅へ収める。 |
| TOC-UI-009 | ポップオーバーの最大高さは`min(320px, viewport内の利用可能高さ)`とし、超過時はパネル内部だけを縦スクロール可能にする。 |
| TOC-UI-010 | ポップオーバーには`Table of contents`見出しを表示する。 |
| TOC-UI-011 | H1を基準インデントとし、H2、H3の順に一定量の左余白を追加する。先行する上位levelがなくてもlevel本来のインデントを維持する。 |
| TOC-UI-012 | 長い見出しは項目内で複数行表示を許可し、横スクロールを発生させない。 |
| TOC-UI-013 | TOC項目はhoverおよびkeyboard focus時に背景色を変更し、`:focus-visible`で識別可能なoutlineを表示する。 |

### 6.3 モーション

| ID | 要件 |
| --- | --- |
| TOC-UI-014 | 通常時の開閉はopacityと短い移動量によるアニメーションとし、本文や周辺UIを動かさない。 |
| TOC-UI-015 | `prefers-reduced-motion: reduce`の場合はポップオーバー開閉アニメーションとスムーズスクロールを無効化する。 |

## 7. 機能要件

### 7.1 見出し抽出

| ID | 要件 |
| --- | --- |
| TOC-FUNC-001 | TOCは現在選択中のノートのPreviewに実際に描画されるH1、H2、H3を文書順に抽出する。 |
| TOC-FUNC-002 | fenced code block内の`#`、通常本文内の`#`、描画されないMarkdownは見出しとして扱わない。 |
| TOC-FUNC-003 | 見出しの表示文字列はPreviewに描画される可視テキストを使用し、Markdown記号を含めない。 |
| TOC-FUNC-004 | 可視テキストが空の見出しはTOCへ表示しない。 |
| TOC-FUNC-005 | 同じ文字列の見出しが複数ある場合も、levelと文書内の出現順に基づく別項目として保持する。最初の同名見出しへ集約しない。 |
| TOC-FUNC-006 | 本文、選択ノート、またはPreview描画結果が変化した場合はTOCを再生成し、古い描画要素への参照を使用しない。 |

### 7.2 見出しへの移動

| ID | 要件 |
| --- | --- |
| TOC-SCROLL-001 | TOC項目押下時、対応する現在のPreview見出しへ移動する。 |
| TOC-SCROLL-002 | PCではdocumentをスクロールせず、`.mdPreview-scroll`の`scrollTop`だけを更新する。 |
| TOC-SCROLL-003 | モバイルでは現行レイアウトに従ってdocumentをスクロールする。 |
| TOC-SCROLL-004 | 移動後の見出しは固定ヘッダーやパネル上端に隠れない位置に表示し、必要な`scroll-margin-top`またはoffsetを設ける。 |
| TOC-SCROLL-005 | 通常時は`behavior: "smooth"`、reduced motion時は`behavior: "auto"`相当で移動する。 |
| TOC-SCROLL-006 | 移動完了後、既存のPreviewスクロール位置保持情報を移動先へ同期し、Edit／Preview切替や同一ノートの再描画で直前位置へ戻らないようにする。 |
| TOC-SCROLL-007 | 選択時点で対象見出しが存在しない場合は例外を発生させず、ポップオーバーを閉じて現在位置を維持する。 |

### 7.3 開閉と状態遷移

| ID | 要件 |
| --- | --- |
| TOC-STATE-001 | TOCトリガーを押すたびにポップオーバーのopen／closedを切り替える。 |
| TOC-STATE-002 | TOC項目を選択した場合はポップオーバーを閉じる。 |
| TOC-STATE-003 | ポップオーバー外をpointerで選択した場合は閉じる。 |
| TOC-STATE-004 | ESCキーを押した場合は閉じ、TOCトリガーへフォーカスを戻す。 |
| TOC-STATE-005 | active tabがPreview以外へ変化した場合は閉じる。 |
| TOC-STATE-006 | 選択ノートまたは本文が変化した場合は閉じる。 |
| TOC-STATE-007 | viewport変更でポップオーバー位置が無効になる場合はviewport内へ再配置する。 |
| TOC-STATE-008 | TOCの開閉、スクロール、項目選択はノートのdirty状態を変更しない。 |

## 8. アクセシビリティ要件

| ID | 要件 |
| --- | --- |
| TOC-A11Y-001 | TOCトリガーは`button`とし、`aria-label="Table of contents"`、`aria-expanded`、`aria-controls`を持つ。 |
| TOC-A11Y-002 | ポップオーバーはmodal dialogではなく、`nav`または同等のnavigation landmarkとして`aria-label="Table of contents"`を持つ。背景操作を無効化しない。 |
| TOC-A11Y-003 | TOC項目はTab、Shift+Tab、Enter、Spaceで操作できるbuttonまたは同等のネイティブ操作要素とする。 |
| TOC-A11Y-004 | ポップオーバーをkeyboardで開いた場合、最初のTOC項目へフォーカスを移動する。 |
| TOC-A11Y-005 | TOC項目選択後は移動先見出しへフォーカスを移し、スクリーンリーダー利用者が移動結果を認識できるようにする。見出しへ一時的な`tabIndex=-1`を付与してよい。 |
| TOC-A11Y-006 | ESCで閉じた場合はトリガーへフォーカスを戻す。外側pointer選択では選択先の自然なフォーカスを妨げない。 |
| TOC-A11Y-007 | 見出しlevelは視覚的なインデントだけに依存せず、項目のaccessible nameまたは補助情報から識別可能にする。 |
| TOC-A11Y-008 | hoverだけで情報や操作可否を表現せず、keyboard focusでも同等の視覚フィードバックを提供する。 |

## 9. レスポンシブ要件

| ID | 要件 |
| --- | --- |
| TOC-RESP-001 | editor tab rowが折り返す幅でも、TOCトリガーがviewport外へ押し出されない。 |
| TOC-RESP-002 | モバイルではポップオーバー幅を`calc(100vw - 24px)`以下とし、左右に安全な余白を確保する。 |
| TOC-RESP-003 | 画面回転またはviewport縮小後もポップオーバー全体へ到達できる。 |
| TOC-RESP-004 | TOC内部スクロール中に背面のPreviewまたはdocumentへ意図しないscroll chainingを発生させないよう配慮する。 |

## 10. 非機能要件

| ID | 要件 |
| --- | --- |
| TOC-NFR-001 | 見出し抽出は本文またはPreview描画結果が変化した場合にだけ再計算し、TOCの開閉だけでMarkdown全体を再解析しない。 |
| TOC-NFR-002 | 多数の見出しを含む文書でも、Preview本文の入力、タブ切替、通常スクロールを継続できる。 |
| TOC-NFR-003 | TOC処理の失敗でPreview全体を非表示または操作不能にしない。 |
| TOC-NFR-004 | TOC生成結果や開閉状態をIndexedDB、localStorage、Export、Backupへ保存しない。 |
| TOC-NFR-005 | TOC追加後もPCではdocumentスクロールを発生させず、モバイルでは現行のdocumentスクロールを維持する。 |

## 11. 状態遷移

| 現在状態 | 操作・事象 | 次状態 | 補足 |
| --- | --- | --- | --- |
| Preview／見出しあり／closed | TOCトリガー | open | 最初の項目へフォーカス可能にする。 |
| Preview／見出しなし／closed | TOCトリガー | closed | トリガーはdisabled。 |
| open | TOC項目選択 | closed | 対象見出しへ移動し、見出しへフォーカスする。 |
| open | ESC | closed | トリガーへフォーカスを戻す。 |
| open | 外側pointer選択 | closed | 外側の操作を妨げない。 |
| open | EditまたはSlidesへ切替 | closed | TOCトリガーも非表示になる。 |
| open | ノート切替または本文変更 | closed | TOC項目を再生成する。 |
| open | viewport変更 | open | viewport内へ再配置できない場合はclosedとしてよい。 |

## 12. 受入条件

| ID | 受入条件 |
| --- | --- |
| TOC-AC-001 | H1、H2、H3が文書順かつlevelに応じたインデントで表示され、H4〜H6は表示されない。 |
| TOC-AC-002 | 同名見出しをそれぞれ選択すると、対応する別々の出現位置へ移動する。 |
| TOC-AC-003 | PCでTOC移動してもdocumentの`scrollTop`は変化せず、Preview内部だけが移動する。 |
| TOC-AC-004 | モバイルでTOC移動するとdocumentが移動し、対象見出しが固定ヘッダーに隠れない。 |
| TOC-AC-005 | 項目選択、外側pointer選択、ESC、タブ切替、ノート切替でポップオーバーが閉じる。 |
| TOC-AC-006 | ESCではトリガー、項目選択では移動先見出しへフォーカスが移る。 |
| TOC-AC-007 | 320px幅相当のviewportでトリガーとポップオーバーが横にはみ出さず、全TOC項目へ到達できる。 |
| TOC-AC-008 | reduced motion時に開閉アニメーションとスムーズスクロールを使用しない。 |
| TOC-AC-009 | TOC操作で本文、タグ、タイトル、dirty状態、保存データが変化しない。 |
| TOC-AC-010 | 見出し0件ではトリガーがdisabledとなり、Previewの通常閲覧を妨げない。 |

## 13. 自動化テスト候補

### 13.1 機能・データ

- H1〜H6を含む本文からH1〜H3だけが抽出されることを検証する。
- H1を持たずH2から始まる本文でもlevel本来のインデントになることを検証する。
- 同名見出し、同名でlevelが異なる見出し、inline code／強調／日本語を含む見出しを検証する。
- fenced code block内の`# heading`がTOCへ混入しないことを検証する。
- 見出し0件、1件、多数の境界を検証する。

### 13.2 UI・アクセシビリティ

- PreviewだけでTOCトリガーが表示され、見出し0件ではdisabledになることを検証する。
- `aria-expanded`とポップオーバー表示が同期することを検証する。
- Enter／Spaceで開閉・選択でき、ESC後にトリガーへフォーカスが戻ることを検証する。
- 長い見出しと多数項目でもパネルがviewport内にあり、内部スクロールできることを検証する。
- hoverと`:focus-visible`の両方で視覚フィードバックがあることを検証する。

### 13.3 スクロール・環境差

- PCではPreview内部、モバイルではdocumentだけがスクロールすることを検証する。
- 固定ヘッダーの高さを考慮し、移動先見出しが可視範囲内にあることをbounding boxで検証する。
- reduced motionの有無で最終位置は同じで、移動方式だけが変化することを検証する。
- viewport変更、画面回転相当、狭幅、長いPreview、スクロール途中からのTOC移動を検証する。
- Edit／Preview切替後にTOC移動位置が既存のスクロール位置保持処理と競合しないことを検証する。

## 14. 優先度

| 優先度 | 対象 | 理由 |
| --- | --- | --- |
| 重大 | 正しい見出しへの移動、PC／モバイルのスクロール所有者、viewport内配置 | 誤移動や操作不能は長文閲覧の目的を損なう。 |
| 重要 | 自動クローズ、フォーカス管理、reduced motion、重複見出し | 操作継続性とアクセシビリティへ直接影響する。 |
| 軽微 | 開閉アニメーションの細部、hover色、余白の微調整 | 機能成立後に調整可能である。 |

## 15. 将来拡張

- H4〜H6の表示とlevel範囲設定
- 現在閲覧中の見出しをIntersection Observerで追跡するactive heading表示
- H1／H2単位の折りたたみ
- URL fragmentとブラウザ履歴の連携
- TOCの常設表示とポップオーバー表示の切替
