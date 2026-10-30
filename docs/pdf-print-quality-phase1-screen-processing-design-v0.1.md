# MKB PDF出力品質改善 画面・処理設計書 v0.1
2026-10-29 / 対応: [追加要件定義書](./pdf-print-quality-phase1-requirements-v0.1.md) / レビュー用

## 画面設計
既存More actionsの `Print / PDF` と `Export Styled HTML / PDF…` を維持。簡易印刷は準備中のdisabled表示を維持し、失敗時のみ対象・理由・再試行を表示する。Styled ExportのColor/Design/Text size/Show tags、画像対応付け、HTML出力、スナップショット固定は変更しない。390pxでもメッセージと操作が画面内に収まること。印刷物にはエラーUIを出さない。

## 準備結果モデル（概念型）
```ts
type PrintReadiness =
  | { status: 'ready' }
  | { status: 'fallback'; issues: PrintIssue[] }
  | { status: 'failed'; issues: PrintIssue[] }
  | { status: 'timeout'; issues: PrintIssue[] };
type PrintIssue = { kind: 'font'|'image'|'mermaid'|'other'; target?: string; reason: string };
```

## 状態遷移
```mermaid
flowchart TD
 A[印刷操作] --> B[busy・準備開始]
 B --> C[フォント・画像・Mermaid確認]
 C --> D{判定}
 D -->|ready / 確認済fallback| E[window.print]
 D -->|failed / timeout| F[理由・再試行表示]
 E --> G[afterprint / 例外 / 復帰監視]
 G --> H[busy解除・状態復元]
 F --> H
```
二重クリックを防止。各試行に識別子を付け、古い非同期結果を破棄。ノート切替時に旧DOMを印刷しない。画像はnaturalWidth/decodeも確認。Mermaidのfallbackは代替コード等が実際に印刷可能な場合のみ許可。afterprint未発火でもbusyを解除するが保存完了は判定しない。

## CSS設計
`src/App.css` と `src/lib/styledExport/document.css` の既存規則を比較し、日本語改行、見出し孤立、長大要素の処理など意味の共通部分のみ再利用。色・余白・デザインは各経路固有。一律 `break-inside: avoid` による欠落を防ぐ。`@page` と印刷対象UI非表示が競合しないことを検証する。

## 変更候補
- `src/App.tsx`: readiness、エラー表示、cleanup、retry
- `src/App.css`: 簡易印刷の禁則・改ページ
- `src/lib/styledExport/document.css`: Styled印刷の禁則・改ページ
- `src/components/StyledExportView.tsx`: 必要な場合のみ既存判定との整合調整
- テスト: unit、Playwright E2E、固定Markdown fixtures
実際の変更ファイルはCodexが現行mainを確認して確定する。

## テストデータ
日本語句読点・括弧・長URL、2ページ超のコード/表、巨大Mermaid、画像失敗、フォント待機超過、空本文、未保存draft、オフライン、印刷キャンセル。Chromiumで自動検証し、Safari・iOS・Androidの手動検証を別ゲートにする。PDFの文字欠落、ページ数、可読性、UI混入を検査する。

## Phase 1 完了条件
要件ID→テストIDの対応表、変更前後の比較結果、ブラウザ別既知制約、未検証事項をPRに記載。CI失敗を黙認しない。

## v0.2追補（PR #55レビュー対応）
### 経路別失効規則（共通失効処理は禁止）
| イベント | 簡易Print / PDF | Styled Export |
|---|---|---|
| 印刷準備中の選択ノート変更 | 試行IDを失効し印刷しない | snapshotは維持し、選択変更のみでは失効しない |
| Styled画面終了/unmount | 対象外 | 非同期処理を失効し状態更新を抑止 |
| 新しい出力セッション | 現在ノートの新しい試行ID | 新snapshot/セッションIDに切替え、旧処理を失効 |
| タイムアウト | 理由表示・busy解除・再試行 | 初期化と印刷準備それぞれ理由表示・再試行 |

元の「ノート切替時に旧DOMを印刷しない」は簡易印刷にのみ適用する。Styledには既存設計のsnapshot固定を適用する。選択ノート変更と画面終了を同一キャンセルイベントとして扱わない。

### Styled初期化の状態遷移
Styled画面mount → snapshot固定 → Mermaid/画像等の初期化 → readyまたは安全なfallbackなら出力操作を有効化。failed/timeoutなら対象・理由・再試行操作を表示し、無期限にloadingを継続しない。初期化タイムアウトと印刷操作後の準備タイムアウトは別々に計測し、初期化待ち時間が印刷ハンドラの10秒制限で保護されると仮定しない。画面終了・再試行時には旧非同期結果を無視する。

### fixture・判定追加
- 行頭禁則（閉じ括弧、句読点）と行末禁則（開き括弧）の行境界fixture。
- ページ末尾に見出しを配置し、直後に本文を続けるfixture。見出しだけの最終ページと区別する。
- 簡易印刷の準備中にノート切替、Styledの準備中にノート切替（snapshot維持）、Styled初期化でMermaid Promiseが未解決のままになるfixture。
- PDFの行頭・行末およびページ境界は目視判定項目を記録。ブラウザ差異の例外はOS/版/再現条件/許容判断を文書化する。
