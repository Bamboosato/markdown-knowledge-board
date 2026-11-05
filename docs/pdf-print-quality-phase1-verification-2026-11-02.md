# PDF品質改善 Phase 1 ローカル検証記録

2026-11-02。対象は `c2a4c5b` とその後のローカル差分。Windows・Playwright Chromium、A4 portrait。印刷ダイアログは代替し、PDFは `page.pdf` で生成した。Safari/iOS/Android実機、OSネイティブ印刷ダイアログ、本番環境は未検証。生成PDFとページ画像はローカルの `output/pdf-review/` に保存し、リポジトリには含めない。

## 観点と前提

- 機能: 2経路のready/fallback/failed/timeout、操作の再試行、画像・Mermaidの準備。
- 非機能: 大きな要素・長URLの改ページ、オフライン、単一HTMLの通信、印刷後の復帰。
- データ: 未保存draft、固定snapshot、出力の末尾と長大表・コードの連続性。
- UI: 390px、失敗理由、再試行、印刷対象外UI。正常・異常・境界・状態遷移を分け、各ブラウザは直列実行。

## 受け入れ条件の結果

| ID | 状態 | 検証と未確認事項 |
| --- | --- | --- |
| AC-01 | 人手確認待ち | Windows Chromiumの固定fixtureでは日本語禁則と長URLを全ページ画像・テキストで確認し、検出対象の行頭/行末禁則は0。別OS/ブラウザと文字種を変えた確認は未実施。 |
| AC-02 | 人手確認待ち | 両経路の100行コード・100行表と末尾を抽出確認し、全ページ画像を確認。表見出しの反復を確認。12組の見出しと後続本文は同ページ。ページ末尾に見出しを強制配置するfixture、長大引用の境界確認は未実施。 |
| AC-03 | 人手確認待ち | 60ノードの縦長Mermaidは警告付きソースfallbackで全ノードと後続本文を確認。100×3000の縦長SVG画像は印刷用の分割後、両経路の4ページで先頭・境界・末尾・後続本文を画像確認。後記の通りPixel実機の縦長画像PDFも確認済み。SVGの印刷用分割は元画像の自然ピクセル寸法でcanvasに描画するため、PDF内ではベクターを維持しない。 |
| AC-04 | 合格（対象ケース） | フォントPromiseを未完了にし、10秒で簡易印刷を抑止、理由表示、再試行可能をChromiumで確認。Styled初期化の未完了Mermaidでもtimeout・再試行を確認。 |
| AC-05 | 合格（対象ケース） | 読み込み失敗画像の印刷抑止、サイズ超過Mermaidのコードfallback、縦長SVG fallbackの警告と印刷を確認。すべての画像・フォント障害の組合せは未実施。 |
| AC-06 | 合格（対象ケース） | 保存済みノートを編集後、未保存draftを印刷し、画面上の未保存状態と入力値を確認。IndexedDB全体や全バックアップ経路の比較は未実施。 |
| AC-07 | 合格（対象ケース） | `window.print` の例外と`afterprint`欠落を代替し、busy解除・再試行をChromiumで確認。Windows Chromeではユーザーが簡易印刷・Styled出力のキャンセル後復帰を確認。すべてのOSと状態の組合せは未確認。 |
| AC-08 | 合格（対象ケース） | オフライン状態でテキストのみのStyled HTMLを出力し、ローカルファイルを開いたときHTTP/HTTPS要求0件。画像・Mermaidを埋め込んだ組合せは未実施。 |
| AC-09 | 合格（対象ケース） | PWAの保存済みノートを伴うオフライン再起動1件と、オフラインでのStyled HTML出力をChromiumで確認。全オフライン操作を保証しない。 |
| AC-10 | 合格（対象ケース） | Chromium E2Eと、Pixel 10a / Android 17 / Chromeの簡易・Styled出力を確認。Safari／iPhone実機はユーザー指定によりPhase 1対象外。Firefox・WebKitのPDF差異や他のAndroid実機は未確認。 |
| AC-11 | 合格（対象ケース） | 簡易印刷のフォント待機中にノートを切替えて旧試行が印刷されないことを確認。 |
| AC-12 | 合格（対象ケース） | StyledのMermaid初期化を未完了にしてノートを切替え、初期化完了後も元のsnapshotを表示することを確認。 |
| AC-13 | 合格（対象ケース） | Styled初期化の未完了Promiseで期限切れと理由を表示し、再試行で復帰することを確認。 |

## PDF比較と図の境界

- 比較は現行DOMに親コミット `f708207` の印刷CSSを適用したもので、旧アプリ全体の再実行ではない。固定fixtureの `long-code` 2,000個について、PDFテキストの改行・ページ番号を正規化後、簡易印刷は旧CSSで1,000個、現CSSで2,000個、Styledは旧・現とも2,000個を抽出。両経路の表100行・コード100行・末尾文字列を確認。
- 巨大SVGの判定は、A4用紙幅約794 CSS pxを上回る800pxを描画幅の上限として見積もり、SVGに明示されたpx単位の最大幅がこれより小さい場合はその値を使う。高さ800pxを超える場合は、余白・警告用の余裕を見込んでコードfallbackとする。viewBox不明・不正もfallback。実寸はブラウザ・印刷設定に依存する。
- 模擬SVG viewBox 1200×1200は両経路で図・末尾・後続本文が1ページ内、1200×1800は両経路で警告・コード・後続本文が重ならないことをPDF画像で確認。実Mermaid 60ノードもコードfallback後の両PDFで全ノードを抽出し、後続本文が末尾以降にあることを確認。

## Pixel 10a 実機の追加確認（2026-11-05）

- 対象はローカルの `d5d728dd05000e54530f29da49727477dbb48f08`、USB経由のループバック接続、Pixel 10a / Android 17 / Chrome（PDFのUser-AgentはChrome 156）、簡易印刷。テスト専用ノートを使用。
- 英数字の未保存draftで印刷画面を開き、A4プレビュー1ページに本文を確認。キャンセル後にStatus: Draftと本文が保持され、印刷を再試行できた。PDF保存後のファイルはA4・1ページ、本文を画像で確認した。
- 別の日本語・3行表・100×3000の縦長SVG fixtureはA4・5ページのPDFとして保存し、全ページ画像で日本語、画像の先頭・750・1500・2250・末尾付近、後続本文、表、最終マーカーを確認。画像内の末尾テキストはfixtureのSVG幅に収まらず右端が切れているため、その文字列全体の表示は未確認。
- Styled出力の画像なし日本語fixtureはA4・1ページのPDFを保存し、見出し・本文・表・末尾を画像確認。印刷を再試行してキャンセル後、印刷ボタンが再び有効であることを確認。
- 画像付きStyled出力ではHTTP画像の代替に、200×6000の合成PNGをAndroid写真ピッカーで選択。変更前はA4・10ページのPDFで、1ページ目は見出し後に大きな空白が残り、画像は2ページ目から始まった。保存後に再印刷し、キャンセル後も印刷ボタンが有効だった。
- 上記の空白に対し、分割画像の先頭だけ最大240 CSS px相当にし、残りは最大720 CSS px相当とした。同じPixel・fixtureの変更後PDFも10ページで、画像先頭が1ページ目に入り、全ページ画像で途中・末尾と後続本文・表を確認した。1ページ目には余白が残り、文書のどの位置でも先頭片が同ページに入る保証はない。SVGを写真ピッカーで選択する経路は未確認。
- Windows Chromeでは、ユーザー提供の印刷ダイアログ画像（`output/pdf-review/windows-chrome-user-preview-20261105.png`）で、簡易印刷の日本語テスト文・表・末尾と1ページ表示、送信先「PDFに保存」を確認した。ユーザーが保存したPDF（`output/pdf-review/PDF印刷確認 - Markdown Knowledge Board.pdf`）はA4・1ページで、見出し・日本語本文・URL・表・末尾マーカーをレンダリング画像で確認した。キャンセル後に元画面へ戻り、本文が残り、再印刷できることはユーザーが操作して確認した（画面操作ツールがタイムアウトしたため、操作の自動証跡はない）。画像付き・StyledのWindows印刷、Safari/iPhone、別Android端末、実プリンターも未確認。上記実機結果は対象fixtureに限定し、AC-10全体の合格とはしない。
- PDFと画像は `output/pdf-review/` に保存。端末のDownloadにはテスト用Markdown、SVG、PNGと5つのPDFが残る。

## 実行と既知の制限

### 修正後Vercelプレビューでの追加確認（2026-11-05）

- 対象はPR #56の `bdfece56608fdc13dd0de3d375aca29d5f9d75ff` から作成されたVercel Preview、Pixel 10a / Android 17 / Chrome 156。前回と同じ日本語・表・縦長画像のテスト用Markdownを取り込み、200×6000pxの合成PNGをローカル画像として選択。Styled出力、A4、PDF保存。
- PDFは10ページ。画像の先頭が1ページ目に表示され、画像の途中・末尾、後続本文、表と最終マーカーをページ画像で確認。1ページ目には引き続き余白が残る。保存後に再度印刷画面を開き、キャンセル後にStyled画面に戻り、印刷ボタンが有効なことを確認。
- **原因を確認、対策未適用**: 出力PDFの各ページに円形表示と影が印刷される。プレビューのDOMでは `vercel-live-feedback` 要素が `body` の直接の子として存在し、アプリ内要素を非表示にする印刷CSSの対象外だった。同じ端末・文書・印刷設定で、ブラウザーに一時的な `@media print { vercel-live-feedback { display: none !important; } }` を追加して再出力すると、円形表示が消えた。両PDFはA4・10ページで、72dpiの各ページ画像の差分は10ページすべて同じ円形表示と影の範囲（x=304–380、y=327–403 px）に限られた。実験後に一時スタイルとデバッグ接続を取り除いた。比較前PDFは `output/pdf-review/pixel-vercel-bdfece5.pdf`、比較後は `output/pdf-review/pixel-vercel-toolbar-hidden.pdf`（リポジトリ外のローカル検証データ）。この比較は対象Pixel・Styled・対象fixtureに限る。
- Windows Chrome 156の対象プレビューでは、ユーザー提供の印刷ダイアログ画像（`output/pdf-review/windows-vercel-preview-bdfece5.png`）で、送信先「PDFに保存」、1ページ、「TEST」の見出しと本文を確認。ユーザーが保存したPDF（`output/pdf-review/windows-vercel-bdfece5.pdf`）はA4・1ページで、レンダリング画像に同じ内容を確認。Pixelで見られた円形表示はこの画像とPDFには見当たらない。画像を含まない短文のため、画像付きStyled出力への一般化はできない。再印刷を開いてキャンセル後、本文が残り再印刷できることはユーザーが確認した。
- 今回のPixel結果だけでは他端末、他設定、Mermaidタイムアウト後の実機再試行を保証しない。

### Vercel表示要素の印刷抑止（2026-11-05）

- 対象は `ebf2950537ed3b12e39463f6bd30ac61e007aef4` のVercel Preview。`body` 直下の `vercel-live-feedback` を印刷時のみ非表示にする。画面表示は維持する。Vercel設定や依存関係は変更していない。
- Pixel 10a / Android 17 / Chrome 156: Vercelの円形表示が通常画面にあることを確認。日本語・表の簡易印刷はA4・1ページ、画像付きStyled出力は200×6000pxの合成PNGを埋め込んだ文書でA4・10ページ。両PDFの全ページで円形表示がないことと末尾を確認。Styledは画像の先頭・途中・末尾と後続本文を確認。簡易印刷は保存後に再印刷を開いてキャンセルし、本文への復帰を確認。PDFは `output/pdf-review/pixel-ebf2950-simple.pdf` と `output/pdf-review/pixel-ebf2950-styled.pdf`（ローカル検証データ）。
- Windows / Chrome 156: ユーザー操作で同じ日本語・表の簡易印刷と画像付きStyled出力をそれぞれPDFに保存。簡易1ページ、Styled 10ページの全ページ画像で円形表示がなく、本文・表・末尾を確認。Styledは画像の先頭・途中・末尾と後続本文も確認。PDFは `output/pdf-review/windows-ebf2950-simple.pdf` と `output/pdf-review/windows-ebf2950-styled.pdf`（ローカル検証データ）。通常画面にVercelの丸いツールバーは表示されていなかったとユーザーが確認したため、Windowsで実際のツールバーを非表示にできるかは未確認。簡易・Styled両経路のキャンセル後の復帰はユーザーが確認済み。
- 回帰テストは模擬された閉じたshadow root付きのVercel要素を使い、通常画面で表示され、簡易・Styled双方の印刷時に非表示となり、通常画面に戻ることをChromium・Firefox・WebKitで確認（3件成功）。単体テスト260件、lint、ローカルbuildも成功。全E2E、iOS/Safari実機、実プリンターは今回未実施。

- `npm ci --no-audit`、`npm run test:unit`（260件成功）、lint、型チェック付きbuild、印刷対象Chromium E2E（32件成功）、PWAオフライン再起動の対象1ケース（成功）を実行。印刷以外の全E2Eや他ブラウザーのPDF生成は対象外。
- 追加試験の初回は9,000行のエディター入力でタイムアウト。51,200文字超の少数行fixtureへ変更し再現性を確保した。別のE2E初回ページ読み込みtimeoutは単独再実行で成功した。いずれも製品の印刷失敗と断定しない。
- 依存監査はproduction 0件、全依存low 2件/moderate 19件で失敗。lockfile・依存は今回変更しておらず、既存開発依存の問題として別途扱う。
- 印刷境界の追加確認と依存監査が残るため、Phase 1の完了判定は保留。Safari／iPhone実機確認はユーザー指定でPhase 1対象外。

## 縦長画像の追加調査

- 再現: 100×3,000pxの合成SVG、後続本文、Windows Chromium・A4。実画像取得はPlaywrightで固定応答を返し、外部送信しない。既存CSSでは簡易5ページ、Styled 6ページとなり、それぞれ先頭付近に大きな空白が生じた。
- 画像に `break-inside: auto` を適用してもページ数・空白は変わらなかった。画像の比率を維持して `max-height: 245mm` とした場合は簡易2ページ・Styled 3ページになったが、先頭の空白は残り、画像幅は約31 CSS pxとなって文字が読みにくい。両案とも試験用の一時CSSであり製品CSSには適用していない。
- 400×300pxと300×400pxの合成SVGでは通常Preview、簡易・Styled印刷、保存したStyled HTMLで縦横比を確認。Styled HTMLの再表示時の外部HTTP/HTTPS要求は0件。
- 比較PDFはローカルの `output/pdf-review/image-trials/` にある。承認された方針に従い、印刷中だけ自然寸法の画像を分割canvasに描画し、元画像の画面・HTML表示を維持する。前・同値・直後の1972px閾値、PNG/JPEG/SVG合成画像の全画素、table/blockquote内の幅、`afterprint`・例外時の後始末、`no-store`外部画像の追加取得0をChromiumで確認。通常の高解像度JPEGと表内に収まるSVGは分割せず元画像を維持する。
- A4の印刷CSSと幅で実際の画像幅を同期的に計測し、表示高が印刷可能領域2ページ分を超える場合のみ分割する。各片は最大720 CSS px相当で連続する整数の元画像行を使い、親幅が狭い場合も縦横比を維持する。閾値はA4高さ297mmから上下各18mmを引いた領域の2ページ分をCSS pxに換算し、切り捨てた1972px。文書全体32,000,000画素・100片、片ごと16,000,000画素・辺8192pxの上限を事前検査し、超過時は理由を表示して印刷を中止する。途中失敗・印刷例外・afterprint・Styled画面終了時はcanvasを解放する。準備中のdraft変更やノート切替では旧試行を中断する。
- 高解像度の通常縦JPEG（2000×3000）と印刷領域内に収まる表セルSVG（1000×2500）は、両経路でcanvas分割されず元の画像要素を維持した。親コミットのCSSとの同一DOM比較では、JPEGの先頭・末尾が次ページへ流れる既存のChromium改ページ挙動は変わらず、表部分のページ配置は変更された。これは旧アプリ全体を実行した比較ではない。

## GitHub送信前の自動プレビュー確認（未適用）

- 接続先はGitHub `Bamboosato/markdown-knowledge-board`、Vercelプロジェクト `markdown-knowledge-board`。ローカルoriginには旧名 `set3-markdown-knowledge-board` が設定され、GitHub APIは現在のリポジトリへ移転応答を返す。既存の非mainブランチからのVercel Preview生成履歴がある。現在取得できたプロジェクト情報ではVercel認証が `all_except_custom_domains` で有効。今回のブランチやPRはリモート検索で見つからなかった。リポジトリ内workflow・package・設定の文字列検索では別のデプロイ処理は見つからなかったが、外部連携をすべて網羅した証明ではない。
- 既存 `vercel.json` に `git.deploymentEnabled` はない。[Vercel公式Git設定](https://vercel.com/docs/project-configuration/git-configuration)では未指定ブランチはデフォルト有効で、pushによる自動デプロイをブランチ単位で無効化できる。取得した情報だけでは他のプロジェクト側ルールすべてを確定できないため、実際の生成有無はpush後に確認が必要。
- 対象ブランチのプレビューを抑止する案は、既存JSONのルートに `"git": { "deploymentEnabled": { "feat/pdf-print-quality-phase1": false } }` を追加すること。これは設定変更を含む案であり、**未適用**。その後、既存設定のままプレビュー生成する方針について承認された。マージ・本番デプロイは対象外。
