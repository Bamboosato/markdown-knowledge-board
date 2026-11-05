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
  Paper [A4]  Orientation [Portrait]  Margin [Standard]
  [ ] Cover page   [ ] Table of contents   Depth [H2–H3]
  ※ 印刷画面で用紙・余白が上書きされる場合があります
[準備状態・画像/リンク警告]
[表紙（任意）→目次（任意）→本文のプレビュー]
```

既存4設定は維持。Document layoutは独立グループとする。画面幅390px以下ではDocument layoutを折りたたみ表示（既定は閉じる）とし、summaryにA4/Portrait/Standardと表紙・目次のON状態を示す。ネイティブdetails/summaryまたは同等のアクセシブルな実装とする。設定の変更で本文編集状態は変化しない。

### 2.2 入力項目と活性

| 項目 | 値 | 初期値 | 適用 |
|---|---|---|---|
| Paper size | A4 / Letter | A4 | 印刷のみ |
| Orientation | Portrait / Landscape | Portrait | 印刷のみ |
| Margin | Standard / Narrow / Wide | Standard | 印刷のみ |
| Cover page | Off / On | Off | HTML・印刷 |
| Table of contents | Off / On | Off | HTML・印刷 |
| TOC depth | H2 / H2–H3 | H2–H3 | HTML・印刷 |

TOC depthは目次Off時はdisabledとし、選択値は保持。見出し0件で目次Onなら「対象の見出しがないため目次は出力されません」と表示し、空目次や余分な改ページを作らない。印刷中は設定変更を抑止する。Back to Previewで全設定を破棄する。

## 3. データ型・責務

```ts
type PaperSize = "a4" | "letter";
type Orientation = "portrait" | "landscape";
type MarginPreset = "standard" | "narrow" | "wide";
type TocDepth = "h2" | "h2-h3";
type DocumentLayoutOptions = {
  paperSize: PaperSize;
  orientation: Orientation;
  margin: MarginPreset;
  coverPage: boolean;
  tableOfContents: boolean;
  tocDepth: TocDepth;
};
const DEFAULT_LAYOUT: DocumentLayoutOptions = {
  paperSize: "a4", orientation: "portrait", margin: "standard",
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

## 4. PDF-06 用紙・余白

| Preset | 上下 | 左右 |
|---|---:|---:|
| Narrow | 10mm | 10mm |
| Standard | 18mm | 14mm |
| Wide | 25mm | 20mm |

上記は詳細設計上の提案値。Standardは現行のA4/18mm/14mmを維持する。用紙サイズはA4（210×297mm）、Letter（215.9×279.4mm）。サイズ×向き×余白の12組合せを検証する。

印刷用 `@page` のsize/marginはホワイトリストの列挙値から単一関数で生成し、アプリ内印刷とダウンロード単一HTMLに同じ規則を適用する。現行の `htmlStyle()` と印刷時の一時styleの二重定義を整理する際、**既存のmargin boxによるタイトル/ページ番号指定を不用意に削除しない**。印刷ダイアログによる設定上書きは制御不能なためUIで案内し、実際のページ数をDOMから推測しない。

画面プレビューは文書構造・デザインの確認用であり、ページ分割まで完全一致するWYSIWYGとは称さない。HTMLの通常閲覧幅を用紙設定で固定しない。

## 5. PDF-07 表紙

`StyledDocument` を「任意のCover → 任意のTOC → 本文」に拡張する。表紙ONでは既存Styledの文書タイトル（本文直下の最初の非空H1、なければsnapshot.title）を表紙に移し、本文冒頭には同じタイトルを重複出力しない。元H1の見出しIDは表紙タイトルに引き継ぎ、既存アンカーリンクを維持する。タグONなら表紙にのみタグを表示し、表紙Offでは既存の表示位置を維持する。

印刷では表紙の後に `break-after: page` を適用。長いタイトルを省略せず、ページ内に収まらない場合は折返しや複数ページを許容する。HTMLでは表紙を独立セクションとして表示し、画面表示には強制ページ区切りを適用しない。副題・著者・日付・ロゴ入力は追加しない。

## 6. PDF-07 目次

既存 `analyzeStyledMarkdown` のASTからH2/H3の順序、プレーンテキストラベル、ソース行、**本文で使用する確定済みID** を取得する。別のslugアルゴリズムを実装しない。H1/H4以下、空テキストの見出しは対象外。見出し内の強調・コード・リンクはテキストに変換し、画像のみの見出しは対象外。H3が先行する場合も欠落させずH3階層で表示する。

TOC depth=H2はH2のみ、H2–H3は両方。重複見出しは異なる確定済みIDへリンク。目次自体の「目次」見出しは抽出対象に含めず、脚注や本文のIDとの衝突を防ぐ。目次のリンクは確定済み内部IDからのみ作り、Markdown中の任意URLを転用しない。

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

表紙/目次の末尾で印刷改ページする。対象見出し0件では目次も目次用改ページも生成しない。

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

Phase 2で新しいページ番号ON/OFF、表紙の番号除外、ヘッダー/フッター設定、ページ番号付き目次は実装しない。**既存コードの `@top-center` と `@bottom-right` の挙動を回帰確認することだけはPhase 2に含める。** 確認対象はWindows Chrome/Edge、アプリ内印刷と単一HTML印刷、用紙/向き/余白変更、ブラウザ標準ヘッダー/フッターとの重複。差異・制約を記録するが、PR-Dの独立PoCは作らない。

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
| P2-AC08 | 12種類の用紙設定 | CSS生成値が正しく印刷へ反映 |
| P2-AC09 | 未保存draft | snapshotを出力し、dirty/保存内容不変 |
| P2-AC10 | 単一HTMLをオフラインで開く | 外部資産要求0、目次リンク動作 |
| P2-AC11 | 画面再open | 設定が既定値に戻る |
| P2-AC12 | 既存margin box | ページ番号/タイトルの回帰結果を記録 |
| P2-AC13 | 印刷キャンセル・準備失敗 | busy解除、保存成功誤通知なし |
| P2-AC14 | 390px・キーボード | 横はみ出しなし、設定操作・focus復帰 |

unitはレイアウトCSS生成、目次抽出、重複ID、表紙タイトル、設定初期化を中心に追加。PlaywrightはHTML生成、内部リンク、印刷CSS、未保存draft、オフラインを検証。実PDFの改ページ・ページ番号は目視確認ゲートを設ける。Windows Chrome/Edgeを主要検証対象、Android Chromeを実機確認対象とし、Safari/iPhoneは未検証事項として明記する。

## 10. PR分割と完了条件

- **PR-A（PDF-06）**: Document layout UI、印刷CSS生成、12組合せのunit/E2E、既存margin box回帰。
- **PR-B（PDF-07 表紙）**: 表紙コンポーネント、H1アンカー移動、タグ表示、HTML/印刷回帰。
- **PR-C（PDF-07 目次）**: AST見出し抽出、階層、ID、HTML内部リンク、長い目次、印刷改ページ。
- **PR-Dは設けない。** PDF-09の新規制御はPhase 3以降に検討する。

各PRに変更範囲、要件/テスト対応表、CI・セキュリティ監査結果、ブラウザ別確認、未実施事項を記録。既存の全依存監査問題がある場合は本変更起因かを区別する。ユーザーの承認なしにマージしない。

## 11. レビュー論点

1. 余白のNarrow=10/10、Standard=18/14、Wide=25/20mmを確定するか。
2. 表紙ON時の元H1アンカーの付け替えと既存文書リンクの整合。
3. 見出し内画像のみ/空テキストを目次対象外とする判断。
4. 既存 `@page` margin boxが用紙設定変更後も適切に動くか。
5. Phase 2要件書内のPDF-09「Should/技術検証」は、別途Phase 3へ移す整合修正が必要。
