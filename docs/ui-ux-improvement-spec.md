# UI/UX 改善仕様案

## 目的

現状の Markdown Knowledge Board に対して、利用時の迷い・データ消失リスク・モバイル操作性・アクセシビリティ上の弱点を改善するための仕様案を整理する。

本書は改善検討時の仕様案と実装段階の記録であり、その後に実装済みとなった項目を含む。現行動作・実装状態は[設計仕様](./design-spec.md)、各機能の詳細設計、[文書整合監査](./documentation-consistency-audit.md)を参照する。本書だけから未実装／対応済みを判定しない。

## 優先度定義

| 優先度 | 判断基準 | 対応目安 |
| --- | --- | --- |
| 致命 | 操作不能、データ消失、保存失敗の見落としにつながる | 最優先で対応 |
| 重大 | 主要操作の誤解、取り返しにくい操作、継続利用の阻害につながる | 次リリースで対応 |
| 中 | 効率低下、学習コスト、状態把握のしにくさにつながる | 順次改善 |
| 軽微 | 表示品質、文言統一、補助的な使い勝手の改善 | 余力で対応 |

## 改善方針サマリー

| No. | 改善テーマ | 優先度 | 主な対象 |
| --- | --- | --- | --- |
| 1 | モバイル表示で編集領域が操作不能になる問題の解消 | 致命 | レイアウト、スクロール、エディタ |
| 2 | 未保存ノートと保存済みノートの状態分離 | 致命 | 新規作成、保存、一覧表示 |
| 3 | 未保存変更がある状態での遷移確認の改善 | 重大 | ノート切替、インポート、削除、リロード |
| 4 | 保存失敗・DB 利用不可時の明示 | 重大 | 保存、IndexedDB、通知 |
| 5 | Backup All / Import の結果表示と失敗時導線 | 重大 | バックアップ、インポート、復元 |
| 6 | Preview 内タスクチェック操作のアクセシビリティ改善 | 重大 | Preview、キーボード操作、支援技術 |
| 7 | 表示言語と文言トーンの統一 | 中 | 全画面、通知、HTML 言語 |
| 8 | Search / Tags フィルタの状態把握性向上 | 中 | サイドバー、検索、タグ |
| 9 | Markdown ツールバーの無選択時挙動の明確化 | 中 | エディタ、ツールバー |
| 10 | 削除操作の取り消し導線追加 | 中 | Delete、Undo、履歴 |

## 1. モバイル編集レイアウト改善

### 現状課題

狭い画面ではサイドバーとエディタが縦積みになる一方で、各領域が `100vh` 前提の高さを維持するため、エディタ本文や Preview が画面外に押し出されやすい。`overflow: hidden` の指定により、利用者が目的の領域へスクロールできない状態が発生しうる。

### 改善方針

モバイルではアプリ全体を単一の縦スクロールではなく、操作対象を切り替える構造にする。ノート一覧、編集、Preview を同一画面に無理に詰め込まず、主要操作が常に到達可能な状態を保証する。

### 機能仕様案

- 画面幅 900px 未満では、表示モードを `Notes` / `Edit` / `Preview` の 3 つに分ける。
- 新規作成または既存ノート選択後は `Edit` を表示する。
- `Edit` から `Notes` に戻る場合、未保存変更があれば未保存確認ダイアログを表示する。
- `Preview` は `Edit` から切り替えられるタブとして扱う。
- ツールバー、保存ボタン、戻る導線はスクロール位置に依存せず操作できる。

### 画面仕様案

- モバイル上部に現在のノートタイトルと戻るボタンを表示する。
- 編集画面では本文 textarea が画面高に応じて十分な入力領域を持つ。
- Preview 画面では Markdown 表示領域のみが縦スクロールする。
- サイドバー一覧はノート検索、タグフィルタ、新規作成ボタンを含む独立ビューとする。

### 受け入れ条件

- 390px 幅の viewport で、新規作成、本文入力、保存、Preview 確認、一覧復帰がすべて実行できる。
- エディタ本文、保存ボタン、一覧復帰ボタンが画面外に固定されて操作不能にならない。
- Preview の長文コンテンツが最後までスクロールできる。
- 画面回転または viewport 変更後も表示モードが破綻しない。

### 検証観点

- 機能観点: 新規作成、既存ノート選択、保存、Preview 切替、一覧復帰を検証する。
- 非機能観点: 390px / 768px / 1024px でスクロール不能領域がないことを確認する。
- データ観点: 画面切替や viewport 変更で編集中の本文が失われないことを確認する。
- UI 観点: ボタン同士の重なり、本文の欠け、固定ヘッダーによる入力欄の隠れを確認する。
- 状態遷移: 未保存あり / 未保存なしで `Notes` へ戻る動作を切り分ける。

## 2. 未保存ノートと保存済みノートの状態分離

### 現状課題

新規ノート作成直後に、保存前のノートが一覧上は保存済みのように見える。実際には保存前にリロードすると失われるため、利用者は保存されたと誤認しやすい。

### 改善方針

ノートの保存状態を明示し、保存前のドラフトを保存済みノートと区別する。保存前のデータが失われる可能性を UI 上で把握できるようにする。

### 機能仕様案

- ノート状態を `draft` / `dirty` / `saved` / `saving` / `error` として扱う。
- 新規作成直後は `draft` とし、一覧では `Draft` を表示する。
- 保存完了後に `saved` へ遷移し、保存日時を更新する。
- 保存失敗時は `error` とし、再保存導線を表示する。
- リロードまたはブラウザ終了前に `draft` / `dirty` があれば確認を出す。

### 画面仕様案

- 一覧のノート行に保存状態を表示する。
- エディタヘッダーに `Saved`、`Unsaved`、`Saving`、`Save Failed` の状態ラベルを表示する。
- 保存失敗時は本文入力を維持し、利用者が再試行または Markdown ダウンロードを選べるようにする。

### 受け入れ条件

- 新規ノートは保存前に `Unsaved` と表示される。
- 保存完了後にのみ保存済み扱いになる。
- 保存失敗時に、一覧とエディタの両方で失敗状態が分かる。
- 保存失敗後も本文、タイトル、タグ、frontmatter が失われない。

### 検証観点

- 正常系: 新規作成から保存完了までの状態遷移を検証する。
- 異常系: IndexedDB 書き込み失敗時に `Save Failed` となることを検証する。
- 境界値: 空本文、長文、タグ多数、frontmatter 多数の保存状態表示を検証する。
- 状態遷移: `draft -> saving -> saved`、`dirty -> saving -> error -> saved` を確認する。

## 3. 未保存変更の遷移確認改善

### 現状課題

未保存変更がある状態でノートを切り替える際、確認が保存するか中止するかの 2 択に寄っている。変更を破棄して移動したいケースが扱いにくく、Cancel の意味も分かりづらい。

### 改善方針

未保存変更がある状態で画面遷移を伴う操作を行う場合、`Save and Continue`、`Discard and Continue`、`Cancel` の 3 択を明示する。

### 機能仕様案

- 対象操作はノート切替、新規作成、インポート、削除、一覧復帰、ブラウザリロードとする。
- `Save and Continue` は保存成功後に次操作を実行する。
- `Discard and Continue` は最後に保存された状態へ戻して次操作を実行する。
- `Cancel` は現在の編集状態を維持する。
- 保存失敗時は次操作へ進まず、保存失敗状態を表示する。

### 画面仕様案

- ダイアログタイトルは `Unsaved Changes` とする。
- 本文には対象ノート名と、保存しない場合に変更が失われることを表示する。
- ボタン順は `Save and Continue`、`Discard and Continue`、`Cancel` とする。
- 破壊的な `Discard and Continue` は視覚的に警告色を使う。

### 受け入れ条件

- 未保存変更ありで別ノートを選ぶと 3 択が表示される。
- `Save and Continue` で保存成功後に選択先へ移動する。
- `Discard and Continue` で変更が保存されず選択先へ移動する。
- `Cancel` で現在のノートと編集内容が維持される。
- 保存失敗時は選択先へ移動しない。

### 検証観点

- 機能観点: すべての遷移元操作で同じ確認仕様になることを確認する。
- データ観点: 保存する場合と破棄する場合で IndexedDB の内容が期待通りか確認する。
- UI 観点: ボタン文言から結果が判断できることを確認する。
- 状態遷移: 保存成功、保存失敗、破棄、キャンセルを切り分ける。

## 4. 保存失敗・DB 利用不可時の明示

### 現状課題

IndexedDB が利用できない、または保存処理で例外が発生した場合に、利用者が保存失敗を見落とす可能性がある。保存ボタン押下後の結果が十分に明示されないと、データ消失につながる。

### 改善方針

保存処理は成功・失敗を UI に返す契約にし、失敗時は本文を保持したまま復旧操作を提示する。

### 機能仕様案

- 保存 API は成功可否、エラー種別、エラーメッセージを返す。
- 保存失敗時は画面上部またはエディタヘッダーにエラーを表示する。
- `Retry` と `Download Markdown` を提示する。
- DB 初期化失敗時はローカル保存不可モードとして起動し、保存ボタンを無効化または代替保存へ誘導する。
- 保存完了後は短時間の成功通知と保存日時を表示する。

### 画面仕様案

- 保存中は Save ボタンを `Saving` 状態にし、二重押下を防ぐ。
- 保存成功時は `Saved` と最終保存時刻を表示する。
- 保存失敗時は `Save failed` と原因の概要を表示する。

### 受け入れ条件

- IndexedDB 書き込み失敗を注入した場合、保存成功表示にならない。
- 保存失敗時も入力内容が失われない。
- 再試行で成功した場合、エラー表示が解除される。
- DB 初期化失敗時に、利用者が保存不能であることを認識できる。

### 検証観点

- 異常系: IndexedDB unavailable、quota exceeded、transaction error を想定する。
- 非機能観点: 低速環境で保存中表示が維持され、二重保存競合が起きないことを確認する。
- データ観点: 失敗時にメモリ上の編集内容が維持されることを確認する。
- 再現性: 失敗注入方法とログ確認手順をテストに残す。

## 5. Backup All / Import の結果表示改善

### 現状課題

Backup All はノート数分のファイルを連続ダウンロードするため、ブラウザによってはブロックや失敗が発生しても結果が分かりにくい。Import は成功件数、失敗件数、重複扱い、パース失敗の詳細が見えにくい。

### 改善方針

バックアップとインポートは一括操作として扱い、開始・進捗・完了・失敗を利用者へ明示する。データ復旧に関わる操作のため、成功可否を曖昧にしない。

### 機能仕様案

- Backup All は ZIP などの単一ファイル出力を基本とする。
- 出力ファイルには全ノート Markdown とバックアップメタデータを含める。
- Export / Backup 完了時はファイル名、件数、完了時刻を表示する。
- Import 完了時は追加件数、更新件数、スキップ件数、失敗件数を表示する。
- 重複判定は `id`、`title`、`createdAt` の優先順位を仕様化する。
- パース失敗したファイルはファイル名と理由を表示する。
- Edit の Body 領域へ `.md`、`.markdown`、`.txt` をドラッグ中はドロップ可能状態を表示し、ドロップ後は通常の Markdown Import と同じ追加／更新処理を行う。

### 画面仕様案

- バックアップ開始時は進捗表示または処理中表示を出す。
- インポート結果は閉じるまで確認できる結果ダイアログで表示する。
- 失敗がある場合は詳細を展開できる。
- インポート前に現在の未保存変更がある場合は未保存確認ダイアログを表示する。
- Body 以外へのドロップではインポートせず、Body へのファイルドロップではブラウザがファイルを直接開く既定動作を抑止する。

### 受け入れ条件

- 0 件、1 件、複数件の Backup All が明確な結果表示を返す。
- 複数ノートを含むバックアップを再インポートした場合の重複処理が仕様通りになる。
- 不正 Markdown または不正 frontmatter が混在しても、成功分と失敗分が区別される。
- インポート中に未保存ノートが暗黙に失われない。

### 検証観点

- 正常系: 単一ノート、複数ノート、frontmatter 付きノートの roundtrip を確認する。
- 異常系: YAML パース失敗、空ファイル、拡張子違い、巨大ファイルを確認する。
- 境界値: 0 件バックアップ、100 件以上のノート、同名タイトルを確認する。
- データ観点: インポート後の ID、タイトル、タグ、本文、日時の保持を確認する。

## 6. Preview 内タスクチェックのアクセシビリティ改善

### 現状課題

Preview 内のタスクチェックが視覚的にはクリック可能でも、キーボード操作や支援技術から操作可能な要素として認識されにくい。Markdown Preview 上でタスクを更新できる機能は便利だが、操作対象としての意味付けが不足している。

### 改善方針

タスクチェックはボタンまたはチェックボックス相当のセマンティクスを持つ UI として実装する。マウス、キーボード、支援技術で同じ操作結果になることを保証する。

### 機能仕様案

- タスク行のチェック操作要素に `role="checkbox"` または実際の checkbox/button を使用する。
- `aria-checked`、`aria-label` を設定する。
- Space / Enter でチェック状態を切り替えられる。
- Preview で切り替えた結果は Markdown 本文へ即時反映し、未保存状態にする。
- 読み取り専用表示では操作不可状態を明示する。

### 画面仕様案

- チェック対象は十分なクリック領域を持つ。
- フォーカス時のアウトラインを表示する。
- チェック済み / 未チェックの視覚差を保つ。

### 受け入れ条件

- キーボードのみで Preview のタスクを切り替えられる。
- スクリーンリーダーがチェック状態と操作対象を読み上げられる。
- タスク切替後、Markdown 本文の該当行が更新される。
- タスク切替後は保存状態が `Unsaved` になる。

### 検証観点

- UI 観点: フォーカス可視化、クリック領域、チェック状態の視認性を確認する。
- 機能観点: Preview 操作と Markdown 本文の同期を確認する。
- 状態遷移: saved 状態からタスク切替後に dirty へ遷移することを確認する。
- 環境差異: Chrome / Edge / Firefox のキーボード操作を確認する。

## 7. 表示言語と文言トーンの英語統一

### 現状課題

操作ラベルは英語中心である一方、一部通知や確認文言が日本語になる可能性がある。表示言語が混在すると、利用者が操作結果を判断しづらくなり、支援技術やブラウザ翻訳の挙動とも整合しにくい。

### 改善方針

アプリ画面に表示される UI 言語は英語で統一する。日本語併記は行わず、ボタン、通知、確認ダイアログ、空状態、エラー文言をすべて英語のプロダクトコピーとして整える。仕様書本文、テスト名、開発者向けコメントや内部識別子は本項目の対象外とする。

### 機能仕様案

- HTML の `lang` は `en` にする。
- 主要操作ラベル、通知、確認ダイアログ、空状態、エラー文言を英語に統一する。
- Markdown、Preview、Import、Export、Backup、Slides などの機能名は英語表記のみとする。
- 日本語併記、日英併記、画面内の補足的な日本語説明は行わない。
- エラー文言は英語で原因と次の操作が分かる形にする。
- 仕様書本文、テスト名、コード内の内部識別子は対象外とする。

### 画面仕様案

- 主要操作は `Save`、`New Note`、`Delete`、`Import`、`Export`、`Backup All` などの英語表記で統一する。
- 成功通知、失敗通知、確認ダイアログのトーンを簡潔な英語に揃える。
- 破壊的操作は `Delete note?`、`Discard changes?` など、結果が明確に分かる英語文言にする。

### 受け入れ条件

- 主要画面に日本語 UI 文言が残っていない。
- HTML 言語指定が画面表示と一致する。
- すべての確認文言が英語で操作結果を明示している。
- 日本語併記が表示されない。
- 仕様書本文やテスト名に日本語が残っていても、本項目の未完了条件にはしない。

### 検証観点

- UI 観点: ラベル、通知、ダイアログ、空状態の文言を確認する。
- 非機能観点: 支援技術やブラウザ翻訳で英語 UI として認識されることを確認する。
- データ観点: ノート本文やタグなどユーザ入力値は翻訳・変換しないことを確認する。

## 8. Search / Tags フィルタの状態把握性向上

実装状態: 実装済み（2026-08-04、NOTES見出し小型ツール再設計を含む）

### 現状課題

タグフィルタがカンマ区切り入力であるため、利用者は指定中の条件や解除方法を直感的に把握しづらい。検索結果が 0 件の場合も、条件が厳しすぎるのかデータがないのか判断しにくい。

### 改善方針

Search / Tags をサイドバーへ常時表示せず、`Filter` ボタンから開く modal dialog で条件設定する。Note 一覧の表示領域を確保しつつ、適用中の条件数、検索結果件数、解除導線を確認できるようにする。

### テスト設計観点

| 分類 | 観点 | 検証意図 |
| --- | --- | --- |
| 機能 | Filter dialog起動、条件数更新、Clear、一覧先頭復帰 | 見出しツールの再設計後も既存の絞り込み処理を維持する |
| 非機能 | desktop、390px、320px、連続Apply / Clear、focus復帰、多件数時のscrollbar可視性 | 狭幅や状態切替で折り返し、競合、focus消失を発生させず、OSの自動配色に依存せず一覧をスクロールできるようにする |
| データ | 全件数、絞り込み件数、Search 1件、Tag件数 | `NOTES`件数と`Filter · n`がそれぞれ正しい意味の数値を表示する |
| UI | 高さ32px、14px Medium、16px Filterアイコン、アイコンと文字の6px間隔、通常時の透明背景、淡い適用背景、左右端と視覚的な中央揃え | Filterをセクション付随の小型ツールとして識別でき、通常時と適用時で内部基準位置がずれないようにする |

正常系は未適用→Apply→Clear、異常系は結果0件と保存済み条件なし、境界値は0件・複数条件・大きな件数・320px幅、状態遷移は通常button→適用中chip→通常buttonを対象とする。

### 機能仕様案

- サイドバーの Notes ヘッダーに `Filter` ボタンを表示する。
- Search または Tag filter が有効な場合、`Filter · n`として有効条件数を表示する。Searchは入力有無を1件、Tagは選択数を件数へ加算する。
- Search または Tag filter が有効な場合、Notes ヘッダーに `Clear` ボタンを表示し、modal を開かずに全条件を解除できる。
- `Filter` ボタン押下で Search / Tags 条件設定 modal を表示する。
- modal 内で既存ノートのタグ一覧から候補を表示する。
- 選択済みタグは modal 内でチップとして表示し、個別に解除できる。
- タグ候補は最大 8 件、タグ名昇順、大小文字を区別しない並び順とする。
- タグ候補は入力文字で絞り込み、選択済みタグを除外する。
- 検索文字列とタグ条件の AND 条件で絞り込む。
- `Apply Filters` で modal 内の一時条件を Note 一覧へ反映する。
- `Cancel`、背景クリック、Esc では modal 内の変更を破棄する。
- `Clear Filters` ボタンで検索文字列とタグ条件をまとめて解除する。
- 検索結果件数を `filtered of total notes` 形式で表示する。

### 画面仕様案

- サイドバー上部には Search / Tag filter 入力欄を常時表示しない。
- `NOTES`、件数、`Filter`、`Clear`を同じflex行へ配置し、`align-items: center`を基本に文字とアイコンが視覚的に同じ水平線へ見えるよう調整する。左端と右端は直下のノートカードに揃える。
- 右側の操作群は`margin-left: auto`で右寄せし、`Filter`と`Clear`の間隔を8pxとする。
- 通常の`Filter`は高さ32px、14px、font-weight 500、枠線なし、透明背景のコンパクトbuttonとする。hover時だけ既存quiet icon buttonと同じ`#f1f1f1`背景、`#c7c7c7`の細い内側縁、8px角丸を表示する。keyboard focus時は背景を透明のまま維持し、focus-visibleのアウトラインで示す。ラベル左側に`lucide-react`の`Filter`アイコンを16px、stroke-width 2、`currentColor`で表示する。
- Filter内部は`inline-flex`、`align-items: center`、`justify-content: center`、`gap: 6px`とし、アイコンとラベルを一つのグループとして中央へ揃える。
- 条件適用中の`Filter · n`は同じ32px高のbuttonを枠線なしの淡い青灰色背景とpill形状で表示し、押下すると条件を編集できるdialogを開く。
- 通常時と適用時でFilterの高さ、padding、アイコンとラベルの相対位置、垂直位置を変えない。Clear表示時は操作群右端を維持するためFilter全体の左移動を許容する。
- 条件適用中の`Clear`は高さ32px、14px、font-weight 500、枠と通常背景を持たないtext buttonとする。
- Clear後は非表示になるClearへfocusを残さず、`Filter`buttonへfocusを戻す。
- desktop、390px、320pxでheaderを折り返さず、`NOTES`件数と各操作を1行に維持する。
- ノート一覧が縦方向にoverflowする場合は12px幅のscrollbarを表示し、透明track上に通常`#858585`、hover時`#666666`のpill形状thumbを表示する。thumbとtrackの配色はOS既定へ依存させない。
- modal 内に Search 欄、選択中タグ、タグ入力欄、候補ドロップダウン、件数を配置する。
- 0 件時は `No notes match your filters` と表示し、条件解除導線を出す。
- タグ候補はノート件数が多い場合でも折り返しまたはスクロールで破綻しない。

### 受け入れ条件

- `Filter` ボタンから Search / Tags 条件を設定できる。
- タグをクリックしてフィルタ追加・解除ができる。
- modal 入力中は Note 一覧へ反映されず、`Apply Filters` 後に反映される。
- 複数タグ指定時の条件が仕様通り AND になる。
- 検索条件をすべて解除できる。
- 0 件時に状態と次の操作が分かる。
- 通常Filterが32px・14px Medium・枠線なし・透明背景で、16pxアイコンとラベルが6px間隔で中央に揃い、適用中は内部配置を維持した淡い背景の`Filter · n`chip、Clearは8px離れた枠なしtext buttonとして同じ行に揃う。
- 見出し行と直下のノートカードの左右端差が1px以内であり、320px幅でも折り返しや横overflowが発生しない。
- headerまたは0件表示のClear後にFilterへfocusが戻る。

### 検証観点

- 正常系: 単一タグ、複数タグ、検索語との組み合わせを確認する。
- 境界値: タグ 0 件、長いタグ名、大量タグを確認する。
- UI 観点: 32px高、14px Medium、16pxアイコン、6pxの内部gap、8pxの操作間gap、通常時とkeyboard focus時の透明背景、quiet iconと同じhover背景・内側縁・8px角丸、focus outline、chip背景、枠なしClear、1行表示、見出しとカードの左右端、視覚的な中央揃え、overflow時のscrollbar thumbを確認する。
- データ観点: 大文字小文字、前後空白、重複タグの扱いを確認する。

### 実装・検証結果

- 通常Filterを枠線なし・透明背景とし、hover時だけquiet iconと同じ薄いグレー背景・内側縁・8px角丸を表示した。keyboard focus時は背景を変えずアウトラインだけを表示し、`Filter · n`は枠線なしの淡い背景chipとして状態を区別した。
- `Filter`アイコンを16px、ラベルとの間隔を6px、Clearとの間隔を8pxへ統一し、desktopと320pxで中央揃え、カードとの左右端差1px以内、横overflowなしを確認した。
- ノート一覧のscrollbar thumbを明示的に配色し、20件・高さ500pxの実ブラウザで可視性、縦overflow、スクロール可能性、見出しとカードの右端整列を確認した。
- Clear後はFilterへfocusを戻し、結果0件の`Clear Filters`からも同じfocus契約を適用した。
- lint、unit 184件、production build、Playwright E2E全体回帰（単一worker）143件成功・2件skipを確認した。skipはFirefox / WebKitで対象外のChromium専用IME testである。

## 9. Markdown ツールバーの無選択時挙動明確化

Phase 3 では本項目の実装を保留する。現時点では Bold / Italic / Strike / Code は選択範囲がある場合のみ適用対象とし、無選択時のプレースホルダー挿入または disabled 表示は後続改善で扱う。

### 現状課題

ツールバー操作は選択範囲がある場合に分かりやすい一方、無選択時に何が起きるべきかが曖昧になりやすい。利用者はボタンが効かないと感じる可能性がある。

### 改善方針

本項目は保留とする。後続改善で再開する場合は、以下の案を再評価する。

無選択時はテンプレート挿入として動作するか、選択が必要な操作として無効化するかを操作種別ごとに定義する。

### 機能仕様案

- Bold / Italic / Code は無選択時にプレースホルダー付きの Markdown を挿入する。
- Heading は現在行へ見出し記号を付与する。
- Link は `[text](url)` を挿入し、`text` を選択状態にする。
- Quote / List / Task は現在行または新規行に記法を挿入する。
- 操作後はエディタにフォーカスを戻す。

### 画面仕様案

- ツールバーボタンには tooltip を表示する。
- 無効化する操作がある場合は disabled 状態を明示する。
- 操作結果が分かるようにカーソル位置を適切に設定する。

### 受け入れ条件

- 無選択状態でも主要ボタンの結果が一貫している。
- 選択状態では選択範囲を期待通りラップする。
- 操作後に入力フォーカスが失われない。
- Undo でツールバー操作前の状態へ戻せる。

### 検証観点

- 機能観点: 選択あり / 無選択で各ボタンの挙動を確認する。
- 境界値: 空本文、行頭、行末、複数行選択を確認する。
- UI 観点: tooltip、disabled、フォーカス移動を確認する。
- 状態遷移: ツールバー操作後に dirty 状態になることを確認する。

## 10. 削除操作の取り消し導線追加

### 現状課題

削除は確認後ただちに実行され、取り消し導線がない。ノート管理アプリでは誤削除の影響が大きく、確認ダイアログだけでは防ぎきれない。

### 改善方針

削除直後に Undo できる短時間の復元導線を追加する。将来的には Trash ビューを検討するが、初期改善では軽量な Undo を優先する。

### 機能仕様案

- 削除実行後、一定時間 `Undo` を表示する。
- Undo 期間中は削除対象をメモリ上に保持する。
- Undo した場合、元のノート一覧位置と選択状態を復元する。
- Undo 期間を過ぎた場合に完全削除する。
- アプリ終了やリロードを跨ぐ復元は初期仕様では対象外とする。

### 画面仕様案

- 削除後に画面下部または上部へ通知を表示する。
- 通知文言は `Note deleted`、操作は `Undo` とする。
- Undo 不可になった後は通知を自動で閉じる。

### 受け入れ条件

- 削除直後に Undo が表示される。
- Undo 実行でノートが一覧とエディタに復元される。
- Undo 期間後は復元できない。
- 削除対象が選択中ノートの場合、削除後の選択状態が破綻しない。

### 検証観点

- 正常系: 削除、Undo、完全削除を確認する。
- 状態遷移: 選択中ノート削除、非選択ノート削除、未保存ノート削除を切り分ける。
- データ観点: Undo 後に ID、本文、タグ、日時が保持されることを確認する。
- タイミング観点: Undo 期限直前・期限後の操作を確認する。

## 共通テスト観点

改善実装時は、個別仕様に加えて以下の観点を先に列挙し、ケース化する。

### 機能観点

- 新規作成、編集、保存、削除、Undo、検索、タグフィルタ、Import、Export、Backup All が期待通り動作する。
- Preview と Markdown 本文の同期が維持される。
- 未保存確認が対象操作すべてに一貫して適用される。

### 非機能観点

- モバイル、タブレット、デスクトップで主要操作がスクロール不能にならない。
- 大量ノート、長文ノート、巨大 import ファイルでも UI が固まり続けない。
- 低速環境や保存中の二重操作で状態競合が起きない。

### データ観点

- `draft`、`dirty`、`saved`、`saving`、`error` の状態遷移で本文が失われない。
- Import / Export / Backup の roundtrip で ID、タイトル、本文、タグ、frontmatter、日時が維持される。
- 不正データ混入時に成功分と失敗分が分離される。

### UI 観点

- 操作ボタン、通知、ダイアログの文言から結果が判断できる。
- キーボードのみで主要操作を完了できる。
- フォーカス、エラー、保存状態、検索条件が視覚的に把握できる。

### 異常系・境界値・状態遷移

- IndexedDB 初期化失敗、保存失敗、容量不足、import パース失敗を確認する。
- 0 件、1 件、100 件以上のノートで表示と操作を確認する。
- 未保存あり / なし、保存中、保存失敗、削除直後、Undo 期限切れを切り分ける。
- 同一操作を連打した場合や、保存中に画面遷移した場合の競合を確認する。

## 段階的実装案

### Phase 1: データ消失と操作不能の防止

優先対象:

- モバイル編集レイアウト改善
- 未保存ノートと保存済みノートの状態分離
- 未保存変更の 3 択確認
- 保存失敗・DB 利用不可時の明示

完了条件:

- 主要操作でデータ消失につながる誤認が解消される。
- モバイルで編集、保存、Preview、一覧復帰が完了できる。

### Phase 2: 一括操作とアクセシビリティ改善

優先対象:

- Backup All / Import の結果表示改善
- Preview 内タスクチェックのアクセシビリティ改善
- 削除操作の Undo 導線

完了条件:

- 復旧・移行に関わる操作の成功失敗が明確になる。
- キーボード操作で Preview タスクを更新できる。
- 誤削除から短時間復元できる。

### Phase 3: 操作効率と文言品質の改善

優先対象:

- 表示言語と文言トーンの統一
- Search / Tags フィルタの状態把握性向上

保留対象:

- Markdown ツールバーの無選択時挙動明確化

完了条件:

- 初見利用者でも検索条件と保存状態を理解しやすい。
- 文言と画面状態が一貫している。

## 将来拡張仕様案

Mermaid 対応、Marp によるスライド表示、PDF / PPT 出力は、Markdown ノートを「読む」「編集する」だけでなく「構造化して発表・共有する」ための拡張機能として扱う。

これらは依存ライブラリ、レンダリング方式、セキュリティ、出力品質への影響が大きいため、既存の保存・編集 UX 改善とは別フェーズで設計する。

### 拡張テーマ

| No. | 拡張機能 | 優先度 | 目的 |
| --- | --- | --- | --- |
| A1 | Preview の Mermaid 表示対応 | 中 | Markdown 内の図表・フローを視覚化する |
| A2 | Marp によるスライド表示 | 中 | Markdown をプレゼンテーションとして閲覧する |
| A3 | PDF 出力 | 中 | ノートやスライドを配布用ファイルに変換する |
| A4 | PPT 出力 | 低 | スライドを PowerPoint 編集可能形式として共有する |

### A1. Preview の Mermaid 表示対応

#### 現状課題

Markdown Preview はテキスト主体の表示であり、`mermaid` コードブロックを図として表示できない。設計メモ、業務フロー、状態遷移、ER 図などを Markdown 内で扱う場合、視覚的な確認がしづらい。

#### 改善方針

Preview レンダリング時に `mermaid` コードブロックを検出し、図としてレンダリングする。通常のコードブロック表示と Mermaid 図表示を明確に分け、レンダリング失敗時も Markdown 本文が読める状態を維持する。

初期仕様では Preview 体験の拡張に限定し、保存形式、Import / Export / Backup の Markdown データ構造は変更しない。Mermaid 図は表示時にのみ生成され、ノート本文には生成結果を保存しない。

#### 対象範囲

- 対象は fenced code block の言語指定が `mermaid` の場合のみとする。
- 言語指定は大小文字を区別せず、` ```mermaid `、` ```Mermaid ` を同じ扱いにする。
- inline code、通常の code block、言語指定なし code block、`mermaid` 以外の code block は既存の code 表示を維持する。
- Preview タブ内のみで動作する。Edit 画面の textarea、Markdown toolbar、保存処理は変更しない。
- Mermaid 図の表示状態、`Diagram` / `Code` 切替状態、エラー状態は保存対象外とする。

#### 設定仕様案

- Mermaid renderer は Preview 内に `mermaid` code block が存在する場合のみ lazy load する。
- renderer 設定は初期仕様では固定値とし、ユーザー設定画面は追加しない。
- Mermaid theme はアプリのライト UI と整合する light/default 系を初期値にする。
- Mermaid の自動起動は使わず、Preview 側が対象 code block 単位で明示的に render する。
- Mermaid の security level は strict 相当とし、ユーザー入力由来の HTML、script、event handler、外部リソース読み込みを許可しない。
- SVG を DOM に挿入する場合は、script、foreignObject、event handler 属性、危険な URL を除去する。
- レンダリングは本文変更から 300ms debounce して実行する。
- 複数 Mermaid block がある場合は block 単位で独立して処理し、1 つの失敗が他の block や Preview 全体へ波及しないようにする。
- 同一 Preview 内で Mermaid code が変わっていない場合は、可能な範囲で直前の SVG を再利用する。
- 初期の安全上限として、1 block あたり 50KB を超える Mermaid code は自動 render せず、code fallback と警告を表示する。

#### 機能仕様案

- fenced code block の言語が `mermaid` の場合に図として表示する。
- 初期表示は `Diagram` 表示とする。
- `Show Code` 操作で元の Mermaid code を確認できる。
- `Show Diagram` 操作で図表示へ戻せる。
- 図のレンダリング中は block 内に `Rendering diagram...` を表示する。
- Mermaid code が空の場合は render せず、`Empty Mermaid diagram.` を表示する。
- 図のレンダリングに失敗した場合は、block 内に `Unable to render Mermaid diagram.` とエラー概要を表示し、元コードを確認できるようにする。
- 図は Preview 内で横スクロールできる。Preview 全体や画面幅を突き破らない。
- Markdown 本文を編集して Preview に戻った場合、変更後の Mermaid code で再レンダリングする。
- レンダリング失敗、表示切替、code fallback はノートの dirty 状態を変更しない。

#### 画面仕様案

- Mermaid block は通常 code block と区別できる枠として表示する。
- block header の左側に `Mermaid` ラベルを表示する。
- block header の右側に `Diagram` / `Code` の切替ボタンを表示する。
- エラー時は図領域を error 状態として表示し、`Code` 表示へ切り替えられるようにする。
- モバイルでは header 操作が折り返しても本文や図と重ならない。
- 横長の図は block 内で横スクロールさせ、ページ全体の横スクロールは発生させない。
- 図の SVG は Preview の本文色、枠線、背景と違和感が出ない配色にする。

#### アクセシビリティ仕様案

- `Diagram` / `Code` 切替は button として実装し、キーボード操作と focus 表示に対応する。
- Mermaid 図の container には `role="img"` または SVG 側の適切な accessible name を付与する。
- accessible name は `Mermaid diagram` を基本とし、複数 block がある場合も識別できるようにする。
- 図の内容を読み取れない利用者向けに、常に元の Mermaid code へ切り替えられる導線を提供する。
- レンダリング失敗時のエラーは screen reader で把握できるようにする。

#### エラー・境界仕様案

- Mermaid 構文エラーは block 単位で表示し、Preview 全体を blank にしない。
- renderer の lazy load 失敗時は全 Mermaid block を code fallback とし、Preview 全体は継続表示する。
- 50KB 超の Mermaid block は `Diagram is too large to render automatically.` を表示し、元コードを表示できるようにする。
- 空 code block は `Empty Mermaid diagram.` を表示する。
- 同じ本文内に Mermaid block が複数ある場合、各 block の表示状態とエラー状態を独立させる。
- レンダリング中に本文が変わった場合、古い render 結果を後から反映しない。

#### 受け入れ条件

- flowchart、sequenceDiagram、stateDiagram の基本構文が Preview に表示される。
- 不正な Mermaid 構文でも Preview 全体が落ちない。
- 長い図や横長の図でも画面操作不能にならない。
- Markdown 本文を編集すると、Preview の図が更新される。
- `Show Code` / `Show Diagram` をキーボードで操作できる。
- Mermaid 図の表示失敗時も元コードを確認できる。
- Mermaid 表示状態の変更でノートが未保存状態にならない。

#### 検証観点

- 機能観点: flowchart、sequenceDiagram、stateDiagram、複数 Mermaid block、通常 code block との混在を確認する。
- 非機能観点: lazy load、300ms debounce、複数 block、50KB 上限、長文ノートで UI が固まり続けないことを確認する。
- データ観点: Mermaid code を含むノートの保存、再読み込み、Import / Export / Backup で Markdown 本文が変形しないことを確認する。
- UI 観点: Diagram / Code 切替、モバイル表示、横スクロール、エラー表示、loading 表示、focus 表示を確認する。
- 正常系: 有効な Mermaid code を Preview で図表示し、Code 表示へ切り替え、再度 Diagram 表示へ戻せることを確認する。
- 異常系: 構文エラー、renderer load 失敗、空 code block、50KB 超 code block を確認する。
- 境界値: Mermaid block 0 件、1 件、複数件、横長図、長いラベル、同一 code の重複を確認する。
- 状態遷移: Edit / Preview 切替、本文変更後の再レンダリング、render 中の本文変更、エラーから code 表示への切替を確認する。

### A2. Marp によるスライド表示

#### 現状課題

Markdown ノートをプレゼンテーションとして表示するモードがない。会議資料、説明資料、手順書をそのままスライド化したい場合、外部ツールへの移動が必要になる。

#### 改善方針

Marp 記法を含む Markdown をスライドとして表示する専用モードを追加する。通常 Preview と Slides を切り替えられるようにし、ノート用途とプレゼン用途を混同しない。

初期仕様では閲覧体験の拡張に限定し、スライド生成結果や現在のスライド番号はノート本文へ保存しない。一方で Marp の有効状態、size、theme、page number 表示、heading divider はノートのメタデータとして YAML frontmatter に統合して保存する。

#### 対象範囲

- 対象は YAML frontmatter の `marp: true` を持つノートとする。
- Marp 設定は Body には表示せず、Edit 画面の Slides 設定 UI から編集する。
- YAML frontmatter は app metadata と Marp metadata を統合して扱う。
- Import / Export / Backup では Marp metadata を frontmatter に含めて roundtrip する。
- 外部 Marp Markdown の frontmatter に `marp`、`theme`、`size`、`paginate`、`headingDivider` が含まれる場合は、可能な範囲でノートの Marp 設定として取り込む。
- 既存互換として、本文先頭の HTML comment directive に `marp: true` がある Markdown を import した場合は、後続実装で frontmatter metadata へ変換することを検討する。
- Slides は Preview と同じ draft body と draft Marp 設定を表示対象にする。Markdown toolbar、本文保存処理は変更しない。
- PDF / PPTX export、presenter mode、speaker notes UI、custom theme 管理、fullscreen presentation は A2 初期仕様の対象外とする。
- Mermaid 図の Slides 内レンダリングは A2 初期仕様では対象外とし、`mermaid` code block として表示する。Slides 内 Mermaid 図化は後続拡張で扱う。

Export / Backup で出力する frontmatter 例:

```markdown
---
id: note-example
title: Example
tags:
  - slides
updatedAt: 2026-07-10T00:00:00.000Z
marp: true
theme: default
size: 16:9
paginate: true
headingDivider: 1
---
# Slide 1
```

#### 設定仕様案

- Marp renderer は Slides 表示が必要になった時のみ lazy load する。
- 依存ライブラリは `@marp-team/marp-core` とし、Markdown から HTML / CSS を生成して表示する。
- renderer に渡す Markdown は、draft Marp 設定から内部的に YAML frontmatter を組み立て、draft body と結合して生成する。
- renderer 設定 UI は Edit 画面に表示する。
- Marp On/Off は toggle とする。
- Size は select とし、初期候補は `16:9`、`4:3` とする。
- Theme は select とし、初期候補は `default`、`gaia`、`uncover` とする。
- Page numbers は toggle とし、frontmatter の `paginate` として保存する。
- Heading divider は toggle と見出しレベル `1`〜`6` の select とし、On の場合は frontmatter の `headingDivider` として保存する。値が指定されている場合は On とみなす。
- 初期値は Marp Off、size `16:9`、theme `default`、paginate `true`、heading divider Off とする。Heading divider を初めて On にした直後のレベルは `1` とし、一度レベルを選択した後は Off / On を切り替えても直前の値を保持する。
- Marp Off の場合、size / theme / paginate は UI 上 disabled または補助設定として表示する。
- custom theme CSS の追加・保存は対象外とする。
- slide viewport の縦横比は size に合わせ、`16:9` では `16 / 9`、`4:3` では `4 / 3` に切り替える。
- render 結果は app DOM へ直接混ぜず、`iframe srcdoc` で隔離して表示する。
- iframe には `sandbox` を設定し、script 実行を許可しない。
- render は本文変更から 300ms debounce して実行する。
- 同一 draft body で Slides を再表示する場合は、可能な範囲で直前の render 結果を再利用する。
- 初期の安全上限として、本文が 100KB を超える場合は自動 render せず、`Slide deck is too large to render automatically.` を表示する。

#### 機能仕様案

- draft Marp 設定の On/Off が On の場合に Slides を有効化する。
- Marp On/Off、size、theme、paginate、heading divider を変更した場合は未保存変更として扱う。
- `---` によるスライド区切りを解釈する。
- Slides 表示では 1 枚表示、前後移動、先頭・最後移動、全体枚数表示を提供する。
- 通常の Markdown Preview と Slides を切り替えられる。
- Slides 表示へ切り替えた時点で slide index は 1 枚目に初期化する。
- ノート切替、本文変更、Marp render 再実行時は slide index を有効な範囲へ丸める。
- `ArrowLeft` / `ArrowRight` で前後移動、`Home` / `End` で先頭・最後へ移動できる。
- Slides の表示、移動、render error はノートの dirty 状態を変更しない。
- Marp Off のノートで Slides を開いた場合は、`Slides unavailable for this note.` と表示し、Edit 画面の Marp toggle を On にする導線を案内する。
- render 中は `Rendering slides...` を表示する。
- render に失敗した場合は `Unable to render slides.` とエラー概要を表示し、通常 Preview / Edit へ戻れるようにする。

#### 画面仕様案

- エディタ上部の表示切替を `Edit` / `Preview` / `Slides` にする。
- Edit 画面の metadata area に Slides 設定を表示する。
- Slides 設定には `Marp` toggle と設定アイコンを配置する。設定メニューには `Slide Settings` ヘッダーを設け、右揃えの固定幅コントロールとして `Size` select、`Theme` select、`Page Numbers` switch、`Heading Divider` checkbox と見出しレベル select を配置する。
- Marp 設定は Body textarea の中には表示しない。
- Slides では `First`、`Previous`、`Next`、`Last` ボタンで移動できる。
- 現在のスライド番号を `3 / 12` のように表示する。
- 1 枚のスライドは選択中の size に応じたステージとして表示し、横幅に合わせて縮小する。
- PC では Slides 操作バーをスライド上部に固定し、スライド本体の表示領域を確保する。
- モバイルではスライド全体を縮小して収め、必要に応じて縦スクロールする。
- 横長コードや画像でページ全体の横スクロールが発生しないよう、スライド viewport 内に収める。
- Marp Off、render error、too large は通常 Preview と区別できる案内 panel として表示する。

#### アクセシビリティ仕様案

- `Edit` / `Preview` / `Slides` 切替は button として実装し、現在選択中の mode を視覚と `aria-pressed` または同等の状態で示す。
- Slides 操作ボタンは keyboard focus と disabled 状態を明示する。
- 現在位置は `Slide 3 of 12` のように screen reader で理解できる文言を持つ。
- スライド viewport には `aria-label="Slide preview"` を付与する。
- iframe を使う場合、`title` を設定する。
- Marp Off、render error、too large の案内は screen reader で把握できるようにする。

#### エラー・境界仕様案

- Marp Off の場合は render せず、Slides unavailable 状態を表示する。
- 不正な Marp metadata は採用せず、既定値に fallback する。
- 未対応 theme / size が import された場合は既定値に fallback する。
- renderer の lazy load 失敗時は `Unable to load slide renderer.` を表示し、Preview 全体は継続表示する。
- render 中に本文が変わった場合、古い render 結果を後から反映しない。
- 本文が 100KB を超える場合は自動 render しない。
- slide count が 0 件相当の場合は `No slides to display.` を表示する。
- slide index が範囲外になった場合は、最も近い有効な slide index に補正する。
- iframe 内で script が実行されないことを前提にし、ユーザー入力由来の HTML が app 本体 DOM に影響しないようにする。
- 外部画像 URL はブラウザが読み込む可能性があるため、プライバシー観点の警告または制御は後続検討とする。

#### 受け入れ条件

- Marp 対応 Markdown がスライド単位で表示される。
- 通常 Preview と Slides を切り替えても編集内容が失われない。
- スライド移動がキーボードで操作できる。
- Marp Off のノートでは案内付きで表示される。
- Body textarea に Marp frontmatter や HTML comment directive が自動表示されない。
- Marp On/Off、size、theme、page numbers を UI から変更でき、保存後に Export / Backup の frontmatter に反映される。
- スライド移動、表示切替、render error でノートが未保存状態にならない。
- render 失敗時も Edit / Preview へ戻れる。
- モバイルでもスライドと操作ボタンが重ならない。

#### 検証観点

- 機能観点: Marp toggle、size select、theme select、page numbers toggle、`---` 区切り、前後移動、先頭・最後移動、Preview との切替を確認する。
- 非機能観点: lazy load、300ms debounce、100KB 上限、多数スライドで UI が固まり続けないこと、iframe 隔離を確認する。
- データ観点: Marp metadata を含むノートの保存、再読み込み、Import / Export / Backup で frontmatter が roundtrip し、Body が変形しないことを確認する。
- UI 観点: Body に Marp metadata が表示されないこと、Slides 設定 UI、スライド番号、移動ボタン、disabled 表示、モバイル縮小表示、focus 表示を確認する。
- 正常系: 1 枚、複数枚、画像付き、コードブロック付きのスライドを確認する。
- 異常系: Marp Off、不正 Marp metadata、未対応 theme / size、renderer load 失敗、render 失敗、100KB 超本文を確認する。
- 境界値: スライド 0 枚相当、1 枚のみ、50 枚以上、長い見出し、横長コード、16:9 / 4:3 切替を確認する。
- 状態遷移: Edit / Preview / Slides 切替、本文変更後の再 render、Marp 設定変更後の再 render、ノート切替時の slide index reset、未保存状態での表示切替を確認する。

### A3. PDF 出力

#### 現状課題

ノートやスライドを配布用の固定レイアウトファイルとして出力できない。共有先が Markdown やアプリを前提にできない場合、別ツールでの変換が必要になる。

#### 改善方針

通常ノート PDF とスライド PDF を分けて出力する。ブラウザ印刷に依存するだけでなく、出力対象、ページサイズ、余白、ファイル名を明示して利用者が結果を予測できるようにする。

#### 機能仕様案

- 現在のノートを PDF 出力対象にする。
- 出力形式は `Document` と `Slides` を選択可能にする。
- PDF 出力前にプレビューまたは出力設定を表示する。
- ファイル名はノートタイトルと日時から生成する。
- 出力失敗時はエラーを表示し、再試行できる。

#### 画面仕様案

- Export メニューに `Export PDF` を追加する。
- 出力設定として形式、ページサイズ、向き、余白を表示する。
- 出力中は処理中表示を出し、二重実行を防ぐ。

#### 受け入れ条件

- 通常ノートを PDF として保存できる。
- Marp スライドをスライドレイアウトの PDF として保存できる。
- 出力ファイル名が空または不正文字を含まない。
- 出力失敗時にアプリの編集状態が失われない。

#### 検証観点

- 機能観点: ノート形式、スライド形式の PDF 出力を確認する。
- データ観点: タイトル、本文、見出し、コード、Mermaid 図の出力を確認する。
- 境界値: 長文、画像多数、横長 Mermaid 図、長いファイル名を確認する。
- 非機能観点: 出力中の UI 応答性とブラウザ差異を確認する。

### A4. PPT 出力

#### 現状課題

Markdown スライドを PowerPoint で再編集可能な形式として出力できない。社内共有や既存資料への統合では PPT 形式が必要になる場合がある。

#### 改善方針

PPT 出力は PDF 出力より後のフェーズとする。表示再現性だけでなく、PowerPoint 上で編集可能なテキスト、画像、図形としてどこまで変換するかを事前に定義する。

#### 機能仕様案

- Marp スライドを PPT 出力対象にする。
- 初期仕様ではテキスト、見出し、箇条書き、画像、コードブロックを対象にする。
- Mermaid 図は初期仕様では画像として埋め込む。
- 複雑な HTML、カスタム CSS、アニメーションは対象外とする。
- 出力前に、再現対象外の要素がある場合は警告を表示する。

#### 画面仕様案

- Export メニューに `Export PPT` を追加する。
- 出力前に `Editable First` と `Visual Fidelity First` の方針を表示する。
- 変換できない要素がある場合は出力前確認に表示する。

#### 受け入れ条件

- 基本的な Marp スライドを PPT ファイルとして出力できる。
- PowerPoint で開いたときにスライド枚数と順序が維持される。
- テキスト要素が可能な範囲で編集可能な状態になっている。
- Mermaid 図が画像として表示される。
- 未対応要素がある場合、出力前に警告される。

#### 検証観点

- 機能観点: 見出し、本文、箇条書き、画像、コード、Mermaid 図の出力を確認する。
- データ観点: スライド順、テキスト、画像、ファイル名を確認する。
- UI 観点: 出力警告、処理中表示、失敗表示を確認する。
- 環境差異: PowerPoint、LibreOffice、ブラウザ環境で開いた結果を確認する。

### 将来拡張の実装順序案

1. Preview の Mermaid 表示対応
2. Marp による Slides 表示
3. PDF 出力
4. PPT 出力

この順序にする理由は、PDF / PPT 出力の品質が Preview と Slides の表示品質に依存するためである。まず画面上で正しく表示できる状態を作り、その表示結果を出力機能へ展開する。

## 非対象・保留

- アカウント管理、ログイン、クラウド同期は本改善仕様案の対象外とする。
- 複数端末同期、共同編集、変更履歴の永続化は将来検討とする。
- リロードを跨ぐ Trash 機能は初期改善では対象外とし、必要性が高い場合に別仕様として扱う。

## 実装時の注意点

- 既存 IndexedDB データを破壊しないことを最優先にする。
- 保存状態を追加する場合も、既存ノートデータのマイグレーション要否を明示する。
- UI 文言変更はテスト期待値やスクリーンショット差分へ影響するため、まとめて実施する。
- ZIP バックアップを導入する場合は依存ライブラリ追加の必要性、ブラウザ互換性、ファイルサイズ上限を確認する。
- 失敗系の再現性を確保するため、IndexedDB 失敗や import 失敗を注入できるテスト補助を用意する。
