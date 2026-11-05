# MKB Phase 2 — Styled Export 画面・処理詳細設計書 v0.1

- 作成日: 2026-11-05
- 状態: レビュー用
- 対応要件: [Phase 2追加要件](./markdown-knowledge-board-phase2-requirements-v0.1.md)
- 関連: [Styled Export詳細設計](./markdown-knowledge-board-styled-export-design.md)
- 対象: PDF-06（文書レイアウト）、PDF-07（表紙・ページ番号なし目次）
- 対象外: PDF-08（複数ノート結合）、PDF-09（新規ページ番号/ヘッダー/フッター制御）。いずれもPhase 3以降。

## 1. 設計方針と現行実装

既存の `Export Styled HTML / PDF…` を拡張する。簡易 `Print / PDF` は変更しない。既存21 Color・8 Design・11 Text size・Show tagsと一時設定、単一ノートsnapshot、画像/リンク/SVGの検査、オフラインHTMLを維持する。

2026-11-05のmainを確認したところ、`src/components/StyledExportView.tsx` にはHTML生成、印刷、初期化timeoutがあり、`src/lib/styledExport/markdown.ts` は見出しIDを生成、`StyledDocument.tsx` が共通DOMを描画する。また `StyledExportView.tsx` の `htmlStyle` には `@top-center`（文書タイトル）と `@bottom-right`（page/pages）のCSS指定が既に存在する。**Phase 2ではこれを新たに設計・変更するのではなく、用紙設定との共存を確認する回帰対象とする。**

## 2. 画面設計

### 2.1 デスクトップ

```text
Export Styled HTML / PDF             [Print / PDF] [Download HTML] [×]
Color [Slate]  Design [Comfort]  Text size [100%]  [ ] Show tags
Document layout
  Paper [A4]  Orientation [Portrait]
  [ ] Cover page   [ ] Table of contents   Depth [H2–H3]
  ※ 印刷画面で用紙・余白が上書きされる場合があります
[準備状態・画像/リンク警告]
[表紙（任意）→目次（任意）→本文のプレビュー]
```

既存4設定は維持。Document layoutは独立グループとする。画面幅390px以下ではDocument layoutを折りたたみ表示（既定は閉じる）とし、summaryにA4/Portraitと表紙・目次のON状態を示す。ネイティブdetails/summaryまたは同等のアクセシブルな実装とする。設定の変更で本文編集状態は変化しない。

### 2.2 入力項目と活性

| 項目 | 値 | 初期値 | 適用 |
|---|---|---|---|
| Paper size | A4 / Letter | A4 | 印刷のみ |
| Orientation | Portrait / Landscape | Portrait | 印刷のみ |
| Cover page | Off / On | Off | HTML・印刷 |
| Table of contents | Off / On | Off | HTML・印刷 |
| TOC depth | H2 / H2–H3 | H2–H3 | HTML・印刷 |

TOC depthは目次Off時はdisabledとし、選択値は保持。見出し0件で目次Onなら「対象の見出しがないため目次は出力されません」と表示し、空目次や余分な改ページを作らない。印刷中は設定変更を抑止する。Back to Previewで全設定を破棄する。

## 3. データ型・責務

```ts
type PaperSize = "a4" | "letter";
type Orientation = "portrait" | "landscape";
type TocDepth = "h2" | "h2-h3";
type DocumentLayoutOptions = {
  paperSize: PaperSize;
  orientation: Orientation;
  coverPage: boolean;
  tableOfContents: boolean;
  tocDepth: TocDepth;
};
const DEFAULT_LAYOUT: DocumentLayoutOptions = {
  paperSize: "a4", orientation: "portrait",
  coverPage: false, tableOfContents: false, tocDepth: "h2-h3",
};
type TocEntry = { id: string; level: 2 | 3; label: string; sourceLine: number };
```

既存 `StyledExportOptions` にlayoutを追加するか別stateとするかは実装時に判断。ただしHTML/印刷/プレビューで同一の設定snapshotを用い、Note型・IndexedDB・バックアップに新フィールドを追加しない。

変更候補:
- `src/lib/styledExport/types.ts`: layout型・既定値
- `src/lib/styledExport/markdown.ts`: 既存ASTから目次項目を抽出
- `src/components/StyledDocument.tsx`: 表紙・目次の構成
- `src/components/StyledExportView.tsx`: 設定UI、CSS生成・印刷への接続
- `src/lib/styledExport/document.css`: 表紙/目次の画面・印刷スタイル
- 新規 `src/lib/styledExport/printLayout.ts`（候補）: 列挙値から印刷用CSSを生成

## 4. PDF-06 用紙・向きと既存余白

用紙サイズはA4（210×297mm）、Letter（215.9×279.4mm）。用紙×向きは4組合せ。用紙余白の選択・presetは設けない。既存のアプリ内印刷は上下18mm・左右16mm、保存HTMLは上下18mm・左右14mmを維持する。Designごとの本文・タイトルの内側余白も維持する。

印刷用 `@page` のsizeと既存margin boxは固定された列挙値から共通生成し、marginは経路別の既存値を使用する。**既存のmargin boxによるタイトル/ページ番号指定を不用意に削除しない**。アプリ内用の一時styleは準備中に限り適用し、終了・キャンセル・例外・画面終了時に撤去する。簡易印刷の `@page` は変更しない。印刷ダイアログによる設定上書きは制御不能なためUIで案内し、実際のページ数をDOMから推測しない。

紙の向きを適用した寸法から経路別の余白を引いて印刷可能幅・高さを算出する。CSS pxへの換算は96/25.4。不正・0以下の寸法は拒否する。画像の印刷幅はDesignの内側余白や親幅を含めて測定し、選択領域に応じてPhase 1の画像分割閾値・片の高さを判断する。画素・辺・片数の制限とエラー時の印刷抑止・後始末を維持する。Mermaidは印刷可能領域を安全側に評価し、収まると判断できない場合は既存のコードfallbackを使う。印刷開始時に設定を固定し、準備・ダイアログ中の変更を抑止する。

ダイアログで変更された用紙・余白・向き・倍率は取得できない。選択した設定で事前準備し、実際のプレビュー確認を案内する。単一HTMLはスクリプトなしのため保存後の印刷で動的画像分割を実行できず、縦長画像の分割結果は保証範囲外とする案。選択設定に基づく安全側のMermaid fallbackを含める案とし、両案の採否を実装前に決める。

画面プレビューは文書構造・デザインの確認用であり、ページ分割まで完全一致するWYSIWYGとは称さない。HTMLの通常閲覧幅を用紙設定で固定しない。

## 5. PDF-07 表紙

`StyledDocument` を「任意のCover → 任意のTOC → 本文」に拡張する。表紙ONでは既存Styledの文書タイトル（本文直下の最初の非空H1、なければsnapshot.title）を表紙に移し、本文冒頭には同じタイトルを重複出力しない。元H1の見出しIDは表紙タイトルに引き継ぎ、既存アンカーリンクを維持する。タグONなら表紙にのみタグを表示し、表紙Offでは既存の表示位置を維持する。

印刷では表紙の後に `break-after: page` を適用。長いタイトルを省略せず、ページ内に収まらない場合は折返しや複数ページを許容する。HTMLでは表紙を独立セクションとして表示し、画面表示には強制ページ区切りを適用しない。副題・著者・日付・ロゴ入力は追加しない。

## 6. PDF-07 目次

既存 `analyzeStyledMarkdown` のASTからH2/H3の順序、プレーンテキストラベル、ソース行、**本文で使用する確定済みID** を取得する。既存のslugを基本としつつ、文書全体の重複を防ぐ割り当てを設ける。H1/H4以下、空テキストの見出しは対象外。見出し内の強調・コード・リンクはテキストに変換し、画像のみの見出しは対象外とする案。H3が先行する場合も欠落させずH3階層で表示する。

TOC depth=H2はH2のみ、H2–H3は両方。重複見出しは異なる確定済みIDへリンク。目次自体の「目次」見出しは抽出対象に含めず、脚注や本文のIDとの衝突を防ぐ。目次のリンクは確定済み内部IDからのみ作り、Markdown中の任意URLを転用しない。

見出し・表紙・脚注のIDを文書全体で一意とする。既存の衝突しないIDは維持し、自然な候補と連番候補の競合（`A`、`A`、`A-1`等）も防ぐ。脚注の生成IDを予約し、本文・表紙・目次で確定IDを共有する。既存の曖昧な重複見出しリンクは初出を、脚注との衝突は脚注参照を優先する案。後者では同じ文字列で見出しを指す意図を自動識別できない制約を記録する。優先順位と具体的な割当て方法は採否を決め、回帰テストに固定する。

概念DOM:
```html
<nav class="styled-export-toc" aria-label="Table of contents">
  <h2>目次</h2>
  <ol><li><a href="#overview">概要</a></li></ol>
</nav>
```
実装ではReact要素を使用し、生HTMLの文字列連結や `dangerouslySetInnerHTML` は追加しない。HTMLでは目次項目をクリックして移動できる。印刷時はページ番号を表示しない。目次が複数ページになる場合は自然分割し、項目の途中分割を可能な範囲で抑止する。

| 表紙 | 目次 | 印刷順 |
|---|---|---|
| Off | Off | 従来本文 |
| On | Off | 表紙 → 本文 |
| Off | On | 目次 → 本文 |
| On | On | 表紙 → 目次 → 本文 |

表紙/目次の末尾で後続内容があるときに印刷改ページする。対象見出し0件では目次も目次用改ページも生成せず、空本文や末尾に余分な空白ページが生じないことを確認する。

## 7. 状態遷移と安全性

```text
Styled画面open → snapshot固定 → Markdown AST解析/ID確定
→ layout設定から表紙/目次モデル生成
→ 既存の画像・リンク・Mermaid検査/解決
→ 同一StyledDocumentをプレビュー
→ [HTML] 静的HTML+CSS生成 / [Print] readiness確認→window.print
→ cleanup / Back to Previewで一時state破棄
```

設定変更時にMarkdown ASTやsnapshotを不要に再取得しない。Styledはノート選択変更だけでは失効しない。画面終了/unmount・新セッションで旧非同期結果を失効させる。Phase 1の初期化timeout、画像decode、Mermaid fallback、印刷準備、afterprint/例外/タイムアウトcleanupを維持。HTMLに外部CSS/JS/font/image依存を追加しない。

## 8. PDF-09の扱い（Phase 3へ延期）

Phase 2で新しいページ番号ON/OFF、表紙の番号除外、ヘッダー/フッター設定、ページ番号付き目次は実装しない。**既存コードの `@top-center` と `@bottom-right` の挙動を回帰確認することだけはPhase 2に含める。** 確認対象はWindows Chrome/Edge、アプリ内印刷と単一HTML印刷、用紙・向きの変更と印刷画面による余白の上書き、ブラウザ標準ヘッダー/フッターとの重複。差異・制約を記録するが、PR-Dの独立PoCは作らない。

## 9. 受け入れテストと品質ゲート

| ID | 観点 | 期待結果 |
|---|---|---|
| P2-AC01 | 表紙/目次Off | 既存HTML・印刷に意図しない差分なし |
| P2-AC02 | 表紙On | 表紙1回、タイトル/タグ重複なし、アンカー維持 |
| P2-AC03 | 目次On | H2/H3階層・順序・HTMLリンク一致 |
| P2-AC04 | 両方On | 表紙→目次→本文、印刷改ページ |
| P2-AC05 | 重複見出し、日本語、インライン装飾 | ID衝突なし、リンク先一致 |
| P2-AC06 | 見出し0件 | 空目次・余計な改ページなし、理由表示 |
| P2-AC07 | 長い目次/本文 | 文字・項目の欠落や重なりなし |
| P2-AC08 | 用紙・向き4組合せ | CSS生成値と経路別既定余白が正しく印刷へ反映、上書きの制約を案内 |
| P2-AC09 | 未保存draft | snapshotを出力し、dirty/保存内容不変 |
| P2-AC10 | 単一HTMLをオフラインで開く | 外部資産要求0、目次リンク動作 |
| P2-AC11 | 画面再open | 設定が既定値に戻る |
| P2-AC12 | 既存margin box | ページ番号/タイトルの回帰結果を記録 |
| P2-AC13 | 印刷キャンセル・準備失敗 | busy解除、保存成功誤通知なし |
| P2-AC14 | 390px・キーボード | 横はみ出しなし、設定操作・focus復帰 |
| P2-AC15 | 印刷領域と画像・図 | 4組合せ・経路別余白・Design別内側余白、画像/図の境界と代表PDFを確認 |
| P2-AC16 | ID衝突と既存参照 | 重複・連番・日本語・脚注・H1参照のID一意性とリンク先を確認 |
| P2-AC17 | 保存HTMLの制約 | 外部資産要求0、内部リンクを確認。動的画像分割の非保証とMermaid fallbackは案の採否に応じて確認・記録 |
| P2-AC18 | 既存余白 | アプリ内16mm・保存HTML14mmの左右用紙余白とDesign別内側余白を維持 |

テスト観点は機能、非機能、データ、UIとし、正常・異常・境界・状態遷移を区別する。unitは4組合せ×2経路のCSS・寸法計算、目次抽出、重複ID、表紙タイトル、設定初期化を中心に追加。PlaywrightはHTML生成、内部リンク、印刷CSS、未保存draft、オフラインと状態遷移を検証。代表Designの広狭・相対単位の余白や、画像・図の境界と上限超過を確認する。実PDFの改ページ・ページ番号は目視確認ゲートを設ける。Windows Chrome/Edgeを主要検証対象、Android Chromeを実機確認対象とし、Safari/iPhoneは未検証事項として明記する。実PDF・実機で4組合せ全てを確認するかは実装前に決め、未実施範囲と選定理由を記録する。

## 10. PR分割と完了条件

- **PR-A（PDF-06）**: Document layout UI、印刷CSS生成、4組合せ×2経路の寸法計算、画像・Mermaidの適合、既存余白・margin box回帰。
- **PR-B（PDF-07 表紙）**: 表紙コンポーネント、H1アンカー移動、タグ表示、HTML/印刷回帰。
- **PR-C（PDF-07 目次）**: AST見出し抽出、階層、ID、HTML内部リンク、長い目次、印刷改ページ。PR-BでID基盤が必要なら先行して含める。
- **PR-Dは設けない。** PDF-09の新規制御はPhase 3以降に検討する。

各PRに変更範囲、要件/テスト対応表、CI・セキュリティ監査結果、ブラウザ別確認、未実施事項を記録。既存の全依存監査問題がある場合は本変更起因かを区別する。ユーザーの承認なしにマージしない。

## 11. レビュー論点

1. 保存HTMLの縦長画像は動的分割を保証しない案と、選択設定に基づくMermaid fallbackを採用するか。
2. 表紙ON時の元H1アンカー移動、ID割当てと曖昧な見出し・脚注参照の優先順位。
3. 見出し内画像のみ/空テキストを目次対象外とする案。
4. 性能ベースラインと許容閾値、実PDF・実機における4組合せの確認範囲。
5. 既存 `@page` margin boxと印刷画面の上書き後の結果・制約。PDF-09の新規制御は要件書でPhase 3以降に延期済み。
