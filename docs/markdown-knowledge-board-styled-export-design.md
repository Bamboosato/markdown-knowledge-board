# Markdown Knowledge Board 配布用 Styled Export 詳細設計

- 対応要件: [配布用 Styled Export 要件定義書 v0.3](./markdown-knowledge-board-styled-export-requirements-v0.3.md)
- 作成日: 2026-09-28
- 状態: 実装反映版
- 更新日: 2026-10-06（印刷のページ余白欄を現行実装へ同期）

## 1. 設計方針

- 配布用出力は既存の簡易 `Print / PDF` と独立した経路にする。既存の `MarkdownPreview` や印刷面の見た目を変更して既存印刷に波及させない。
- 選択中ノートのスナップショットを入力として、Markdown解析、画像・リンク検査、プレビュー／出力DOM生成を一つのパイプラインで行う。
- 一時設定と選択した画像はStyled Export画面のReact stateだけに保持する。`Note`、IndexedDB、backup、dirty判定には追加しない。
- Reactで構築したサニタイズ済みプレビューDOMを、印刷と単一HTMLの両方で共有する。HTML用にはドキュメント外殻とinline CSSを付け、印刷用には同じ本文DOMと印刷CSSを使う。
- 本文はReactMarkdownで構文木として描画する。文字列連結でMarkdownからHTMLを直接生成しない。

## 2. 構成

### 2.1 UI

新規 `src/components/StyledExportView.tsx` を追加する。

- ダイアログではなく、既存Edit／Preview領域内へ画面として表示する。既存タブ行は領域の外に維持し、タイトルと右側の `Print / PDF`、`Download HTML`、閉じるアイコンに置き換える。閉じるアイコンのアクセシブル名は `Back to Preview` とする。Styled Exportの外枠は通常Preview／Editパネルと同じ位置・幅・高さに合わせる。
- 出力画面ではヘッダーの `Save`、`Revert changes`、`More actions` と保存ショートカットを無効にし、戻った後に通常の状態へ戻す。
- `App.tsx`から戻るコールバックと、開く時点のノートスナップショットを受け取る。
- stateは `colorId`、`designId`、`textScale`、`showTags`、画像参照ごとの選択ファイル、検査結果、リンク警告への続行選択に限定する。
- stateはStyled Export画面のmount中だけ有効にし、`Back to Preview`でunmountして初期化する。通常の編集領域は非表示で保持し、Edit／Previewの状態を失わない。
- `Download HTML`／`Print / PDF`はいずれも現行プレビューやノートdraftを書き換えない。
- HTMLダウンロードの保存完了や印刷PDFの保存完了を推測・通知しない。
- エラー時はStyled Export画面と一時設定を保持して、問題箇所・理由・修正または再試行方法を表示する。

### 2.2 ドメイン処理

以下の純粋処理とブラウザーI/Oを `src/lib/styledExport/` に分ける。

| モジュール | 責務 |
| --- | --- |
| `types.ts` | Color／Design ID、一時設定、参照位置、検査警告、解決済み資産の型 |
| `markdown.ts` | Remark plugin設定、Markdown AST検査、画像・リンク参照、見出しID、警告一覧の生成 |
| `assets.ts` | HTTPS取得、ローカルFileの検査、容量制限、画像data URL化、SVG安全検査 |
| `theme.ts` | 21 Color、8 Design、11倍率からCSS custom propertiesを生成 |
| `filename.ts` | HTMLファイル名に使うタイトルを安全な名前へ変換 |
| `document.css` | 画面・単一HTML・印刷に共通の文書スタイル |

`StyledDocument.tsx`がStyled Export専用の静的な本文を描画し、`StyledExportView.tsx`が画面状態、HTML組み立て、印刷呼び出しを扱う。`MarkdownPreview`のinteractive／print表示は維持する。現行Previewのチェックリスト操作UIやMermaid表示切替は、styled exportでは静的な表示へ置き換える。

### 2.3 Mermaid

- `src/lib/mermaidRenderer.ts`へ遅延ロード、50KB制限、`securityLevel: strict`を共通化する。SVG sanitizerは`src/lib/sanitizeSvg.ts`へ切り出し、Previewとstyled exportで共有する。
- ExportモードではDiagram／Code切替ボタンやアプリ固有headerを描画せず、成功した図は静的SVGのみを本文へ出す。
- 失敗、空、サイズ超過は要件に従い元コードを本文に残す。出力開始前に全Mermaid blockが成功またはfallback状態へ確定するまで待つ。
- 印刷前に `<img>` とSVGのload/decodeを待つ。一定時間内に確定しない場合は該当箇所を示して出力を中止する。

## 3. データフローと状態遷移

```text
App opens Styled Export view with immutable Note snapshot
  -> initialize transient options to defaults
  -> parse markdown and collect references with source positions
  -> resolve images and inspect links
  -> show issues; require local image mapping / explicit link continuation
  -> render sanitized styled document preview
  -> Download HTML OR Print / PDF
  -> retain view state for adjustment and retry
  -> Back to Preview: discard every transient value
```

### 3.1 ノートスナップショット

- Styled Export画面を開くときに `getDraftSnapshot()` 相当の値から `{ title, tags, body }` をコピーし、以後のHTML／印刷ではこの値を使う。
- `Note`全体やID、更新日時、保存関数をexport pipelineに渡さない。
- Styled Export表示中も既存のノート一覧は残る。出力内容は開いた時点のsnapshotに固定し、出力画面内のノート切替でsnapshotが置き換わらないようにする。

### 3.2 一時設定

```ts
type StyledExportOptions = {
  colorId: ColorId;
  designId: DesignId;
  textScale: 80 | 85 | 90 | 95 | 100 | 105 | 110 | 115 | 120 | 130 | 150;
  showTags: boolean;
};
```

既定は `slate`／`comfort`／`100`／`false`。この型はReact UI stateにだけ使い、永続モデル、localStorage、URL、バックアップへserializeしない。

## 4. Markdown・リンク処理

- 既存Previewと同じ `remark-gfm`、`remark-mark-highlight`、`remarkSingleLineHighlight`を共有する。
- 先にASTを走査し、画像・リンク・見出しID・脚注を対応付ける。参照位置にはremark nodeの行・列を用いる。
- HTML生成はReactMarkdownの要素描画を利用し、raw HTMLを有効化しない。
- `javascript:`、`vbscript:`、`data:`等の危険schemeはhrefを出力せず、問題箇所と理由を事前検査の一覧に出す。ラベル／本文は残す。
- 外部 `http:`／`https:`／`mailto:`はhrefを保持する。出力HTML表示時にアクセスしない。
- `#fragment`は生成したheading IDと照合する。存在しないfragmentはlocal link警告へ含める。
- 別ノート／相対ファイルは続行が確認された場合だけhrefを外す。元のlink labelと周囲のMarkdown構造は保持する。
- 脚注は相互参照できる一意のIDを生成する。同名・重複見出しも一意のslug suffixを付ける。
- チェックリストはdisabledなフォームinputを使わず、チェック済み／未チェックを文字またはCSS描画で表示する。

## 5. 画像・資産処理

### 5.1 参照と対応付け

- AST上の画像ごとに一意な参照IDを付ける。`src`文字列だけでmapせず、同じURLや同名ファイルの複数出現を個別に扱えるようにする。
- HTTPS画像のfetchは利用者が `Load HTTPS images` を押した後に行い、匿名 `fetch` とする。credentialsは `omit`、redirect後のURLも許可protocolとMIMEを再検査する。
- fetch failure、CORS、認証要求、timeoutを個別の問題として表示する。成功したresponseはimage MIMEを許可リストで検証し、サイズ上限を超えた場合はエラーにする。
- 相対／ルート相対／`file:`／`blob:`または取得不能画像では、参照単位に `<input type="file">` を提示する。選択ファイルはimage MIME、実データ、サイズを検査し、対応解除・再選択を可能にする。
- SVGはXMLとしてparseし、`script`、`foreignObject`、event handler、危険URL、外部参照を除去または拒否する。安全性を証明できない場合は受け付けない。
- 解決した資産をdata URLへ変換し、export用markdown／ASTの該当参照だけに適用する。アプリのdraft markdownは変更しない。

### 5.2 容量と失敗

- 入力ファイルは1件あたり5 MiB、全画像合計20 MiBを上限とする。HTTPS fetch timeoutは15秒とする。値は `assets.ts` に定義し、超過／timeout時には上限と対象画像を表示する。
- 画像1つでも未解決または安全検査に失敗した場合、HTML・印刷とも開始しない。
- HTTPS画像を順に取得し、現在の件数を表示する。再試行は未解決の参照だけを対象にする。`Back to Preview`で出力画面を離れた時点で画像のdata URL stateを破棄する。

## 6. プレビュー、HTML、印刷

### 6.1 共通DOM

- 画面プレビュー、HTML、印刷は同じ `StyledDocument` の本文DOMを使う。
- `StyledDocument`へ渡すのはsnapshot、resolved assets、transient options。Markdownの構文木から本文直下の最初の空でないH1を選び、その文字列と既存の見出しIDを文書上部のH1へ移す。元の見出しは本文で描画せず、2つ目以降のH1は残す。候補がなければsnapshotのメタ情報の`title`を使う。
- HTMLの`<title>`とファイル名はメタ情報の`title`を使う。画面プレビュー、HTML、印刷に共通の見出し選択を適用する。
- Colorは色token、Designは余白・見出し・表・枠のtoken、Text sizeは共通scale tokenとしてCSS custom propertiesへ変換する。
- Editorial／WebsiteのH2は、見出しの左側の線と文字の間に12pxの余白を取る。共通のDesign tokenで設定し、画面プレビュー・HTML・印刷へ同じ値を反映する。
- 出力画面の外枠は通常Previewパネルと同じ12px角丸とする。内側のスクロール領域は角丸なしとし、スクロールバーと文書ページの間に余白を設ける。文書ページには画面プレビューと単一HTMLの両方でDesignの角丸を適用する。
- タグ表示、リンク、コード、画像、Mermaidに含まれるすべての値は属性／テキストとしてReactに渡し、未検証HTMLとして挿入しない。

### 6.2 単一HTML

- Mermaid描画と画像データの検証・decodeが確定した後、Reactの静的DOMから文書のtitle、viewport、inline CSS、本文fragmentを組み立てる。
- HTML内に外部stylesheet、script、font、image参照を残さない。HTML documentを保存後、network requestなしで動作する。
- filename sanitizerはタイトルのWindows禁止文字を各々`_`に置換し、空名は`note`とする。出力時には`.html`を一度だけ付与する。
- Blob URLを作成しanchor downloadを開始した後、短い遅延後にrevokeする。保存完了を成功として表示しない。

### 6.3 印刷

- 現行簡易印刷surfaceには触れず、Styled Export画面内の`StyledDocument`を印刷対象として再利用する。印刷CSSでは`app-workspace`を表示したままサイドバーを隠す。
- 印刷時はアプリナビゲーションと出力画面の操作UI、プレビュー用余白を隠し、文書surfaceだけを印刷する。A4 portraitと要件の改ページ規則を専用print CSSへ定義する。
- 文書ページの角丸、背景、影、リンク色、表罫線は画面プレビューと共通のDesign／Color定義を使う。印刷CSSではこれらを別の値に上書きしない。
- print呼出前にフォント、画像decode、Mermaid描画の完了を待つ。準備中の二重操作を抑止する。
- `afterprint`、例外、画面終了、および`afterprint`が発火しない場合のタイムアウトでbusy stateを解除する。cancelと保存完了は区別できないため、保存確認UIを出さない。
- `@page`はA4縦、上下18mm・左右14mm。対応ブラウザでは`@top-center`にsnapshotのmetadata title（空なら`Untitled`）、`@bottom-right`に`counter(page) " / " counter(pages)`を出す。本文H1から選ぶ文書内見出しとは別である。ダウンロードHTMLのinline CSSと直接印刷の一時CSSの両方へ反映する。直接印刷のタイトルCSSは終了・例外・unmount時に除去する。
- 通常の簡易Printは上中央の余白欄を空にし、本文内のタイトルを維持する。両経路のページ番号は同じ形式。CSS page margin box非対応環境では余白欄の表示を保証せず、ブラウザ標準のヘッダー／フッター設定は利用者が調整する。

## 7. アクセシビリティ・レスポンシブ

- Color／Design／Text sizeは可視ラベル付きselectとし、色チップだけで区別しない。設定欄と枠の上下余白は、PCで12px、小幅画面で10pxに揃える。
- 設定欄に十分な横幅がある場合はColor／Design／Text sizeの各ラベルとselectを横並びにし、Show tagsを含む4項目を1行に配置する。設定欄が720px以下では4項目を縦に並べ、selectを各行の幅に合わせる。
- Styled Exportは通常の画面遷移として扱い、初期focusを `Back to Preview` に置く。戻る操作後はPreviewタブへfocusを戻す。
- 問題一覧は画像／リンク参照の種類と行番号を含め、選択した問題から対応コントロールへ移動できるようにする。
- 1280pxデスクトップと390pxモバイルでプレビューを読みやすく保つ。広い表・コード・Mermaidはプレビュー内で横スクロール可能にし、document全体の横スクロールを発生させない。

## 8. 受け入れテスト設計

### 8.1 機能観点

- 保存済み、未保存、新規draftでsnapshotが正しい。
- 各一時設定が独立して反映され、HTML／印刷／プレビュー間で一致する。
- `Back to Preview`後に設定とassetsを破棄し、再オープンで既定値となる。
- 有効な画像・外部リンク・fragment・脚注を正しく変換する。

### 8.2 異常系・境界値

- 空タイトル／空本文、禁止文字を含むタイトル、最小・最大倍率。
- 壊れたdata URL、非画像MIME、画像サイズ上限境界、SVGのscript/event/external reference。
- CORS拒否、HTTP error、timeout、redirect、認証要求、offline fetch。
- Mermaid空、render error、50KB境界、複数diagramの一部失敗。
- 存在しないfragment、別ノートlink、危険scheme。明示的な続行と未選択のまま画面を閉じる操作を両方確認。

### 8.3 状態遷移・競合

- 出力画面からPreviewへ戻る、再度開く、HTML連続出力、印刷連続クリック。
- HTML／印刷準備中にPreviewへ戻る操作、非同期fetch完了後のunmount、印刷例外、`afterprint`未発火時のbusy解除。
- 複数画像の並行解決、同一URL複数出現、選択ファイル再指定、リンク警告と画像エラーの同時発生。
- 出力失敗後に画面stateと入力snapshotを保持し、再試行可能であること。

### 8.4 非機能・回帰

- Windows Chrome／Edge、macOS Safari、iOS Safari、Android Chromeの検証バージョンを記録する。
- 1280px／390px表示、キーボード操作、画面reader用name、色なし印刷を確認する。
- 単一HTMLを通信なしで開き、外部資産要求が0件であることを確認する。
- 既存Markdown export、既存Print/PDF、dirty state、Note型、IndexedDB、JSON backup、cloud backupに差分がないことを確認する。

## 9. 実装順序

1. Color／Design／scale token、AST参照検査、危険scheme処理を純粋関数として追加。
2. StyledDocumentとMermaid export表示モードを追加し、fixtureでプレビュー描画を確認。
3. 画像resolver、問題一覧、ローカル対応付け、続行／画面を閉じるフローを追加。
4. メイン領域内の画面遷移、snapshot固定、一時state、操作のアクセシビリティを追加。
5. 同一DOMから単一HTMLと印刷surfaceを生成し、async asset待機と失敗処理を追加。
6. 要件書§9の実施範囲を選定し、対象テスト、ブラウザー印刷、offline単一HTMLを検証する。

## 10. 設計上の固定値

- HTTPS画像fetch timeout: 15秒。
- 画像1件の最大サイズ: 5 MiB。
- 全画像の最大合計: 20 MiB。
- 画面プレビューでは長い表・コード・図を文書幅100%で表示し、内側の領域に `overflow-x: auto` を設定する。ページ全体には横スクロールを発生させない。

上限値は `src/lib/styledExport/assets.ts` に定義し、受け入れテストで上限直下・上限・上限超過を確認する。
