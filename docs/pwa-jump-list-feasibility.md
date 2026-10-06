# Windows PWA ジャンプリスト対応の実現性調査

作成日: 2026-08-20

実装参照・参考資料の再確認日: 2026-10-06。ジャンプリスト用の`shortcuts`と起動action処理は未実装です。以下のコード例、操作、テスト設計は導入案であり、OS上の実インストール確認は実施していません。

## 1. 結論

要望は、標準PWAの範囲では一部のみ実現可能である。

| 要望 | 標準PWAでの可否 | 結論 |
| --- | --- | --- |
| タスクバー／スタートメニューの右クリックメニューを追加 | 可能 | Web App Manifest の `shortcuts` を使用する。Windows版Edge／Chromeではジャンプリストとして表示される。 |
| `タスク > 新しいNote` | 可能 | 固定ショートカットから `/?action=new-note` を起動し、既存の新規Note作成処理へ渡す。 |
| `最近 > 更新5日以内、最大10件、日時降順` | 要件どおりには不可 | manifestのショートカットはアプリ配布物として扱われるフラットな配列であり、端末のIndexedDBを参照して即時更新する標準APIやグループ指定がない。 |
| `最近` 10件と`新しいNote` 1件を同時表示 | 不可 | Windows版Edge／Chromeのアプリショートカット表示上限は10件であり、合計11件になる。 |

推奨方針は次のとおり。

1. ジャンプリストには固定タスク `新しいNote` を追加する。
2. 必要であれば固定タスク `最近のNote` も追加し、アプリ内で「更新5日以内・最大10件・日時降順」の一覧を表示する。
3. Note Titleをジャンプリストの`最近`グループへ動的表示する要件を必須とする場合は、標準PWAではなく、Windowsネイティブのパッケージ化アプリとジャンプリスト連携を別プロジェクトとして検討する。

## 2. 標準PWAで可能なこと

Web App Manifest の `shortcuts` は、インストール済みPWAのアイコンを右クリックまたは長押ししたときに表示する、名前と起動URLの組を定義する。Microsoft EdgeはWindows上でこれをジャンプリストとして統合する。

`新しいNote` は、現在のmanifestへ次のような固定エントリを追加すれば実現できる。

```ts
shortcuts: [
  {
    name: "新しいNote",
    short_name: "新しいNote",
    description: "新しいNoteを作成",
    url: "/?action=new-note",
  },
]
```

現在のアプリには既に次の処理があるため、画面操作との処理共通化が可能である。

- `src/App.tsx` の `handleNewNote()` が未保存確認後に空のNote draftを生成する。
- 同ファイルの `handleKeyboardShortcut` が `Alt+N` から同じ処理を呼ぶ。
- サイドバーの `+ New Note` ボタンも `onClick={handleNewNote}` で同じ処理を呼ぶ。

実装時は、起動URLの解析だけを追加し、Note生成規則を別実装にしない。URLの`action`は一度処理したら`history.replaceState`で除去し、再読み込みで新規draftを重複生成しない設計にする。

## 3. `最近`を要件どおりに実現できない理由

### 3.1 manifestのショートカットは動的な端末内一覧ではない

標準の`shortcuts`はmanifestに記述する配列で、各要素は`name`、`short_name`、`description`、`url`、`icons`を持つ。Windowsジャンプリストの任意グループ名に相当する項目や、Webアプリからジャンプリストを直接追加・削除する標準APIはない。

本アプリのNoteは端末ローカルのIndexedDB `markdown-knowledge-board / notes` に保存される。サーバーが返す共通manifestは、利用者ごとの端末内Noteを参照できない。

Service Worker等でmanifestを端末ごとに生成する方法は技術的な試作余地があるが、採用しない。

- デスクトップChromeのmanifest確認は通常24時間単位で抑制され、変更反映は全PWAウィンドウ終了後になるため、Note更新直後のジャンプリスト同期を保証できない。
- Edgeを含む他ブラウザーの更新タイミングを統一できない。
- manifest更新失敗、オフライン、キャッシュ、複数ウィンドウ間で古いTitleが残り得る。
- manifestのフラットな`shortcuts`では`最近`と`タスク`を任意にグループ分けできない。

したがって、日常的に変わるNote一覧をmanifest更新へ流用するのは、再現性と原因切り分けの点で不適切である。

### 3.2 表示件数の上限

Windows版Chrome／Edgeはアプリショートカットを最大10件表示する。今回の要望は次の合計11件になる。

- 最近のNote: 最大10件
- 新しいNote: 1件

仮にTitleを動的に供給できても、標準PWAショートカットだけでは全項目を同時に表示できない。プラットフォームごとに表示件数が異なるため、manifest配列の順序を優先度順にする必要もある。

### 3.3 `最近`と`タスク`のセクション制御

WindowsネイティブのJumpList APIには、タスクとカスタムグループを分けて登録する機能がある。一方、Web App Manifestの`shortcuts`はフラットな配列であり、ショートカット単位のグループ名を指定できない。

WindowsネイティブAPIの利用にはpackage identityが必要であり、通常のEdge／ChromeからインストールしたPWAのJavaScriptから直接呼び出すことはできない。正確なセクション構成が必須なら、MSIX化だけでなく、WinUI／WebView2等のネイティブコードとWebアプリ間の連携が必要になる。

## 4. 現行実装との適合性

### 4.1 PWA

- `vite.config.ts` で `vite-plugin-pwa` のmanifestを定義済み。
- `id`、`start_url`、`scope` はいずれも `/` で、`display` は `standalone`。
- 現在は `shortcuts` を定義していない。
- 既存のPWA build、manifest検証、production-preview E2Eがあり、固定ショートカットを追加する土台はある。

### 4.2 Noteデータ

- `src/lib/types.ts` の `Note` は `id`、`title`、`updatedAt` を持つ。
- `src/lib/db.ts` の `getAllNotes()` で全Noteを取得できる。
- 同ファイルの `saveNote()` でIndexedDBへ保存する。
- `src/App.tsx` の `sortNotes()` が利用する `compareNotes()` の既存一覧ソートは「ピン留め優先、その後`updatedAt`降順」である。

ジャンプリスト要件の「日時の降順」はピン留めを考慮しないため、既存の`sortNotes()`をそのまま流用してはいけない。将来アプリ内に「最近のNote」を追加する場合は、専用の純粋関数を用意する。

```ts
const RECENT_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

function selectRecentNotes(notes: readonly Note[], now: number): Note[] {
  const threshold = now - RECENT_WINDOW_MS;
  return notes
    .filter((note) => Number.isFinite(note.updatedAt) && note.updatedAt >= threshold)
    .sort((left, right) =>
      right.updatedAt !== left.updatedAt
        ? right.updatedAt - left.updatedAt
        : left.id.localeCompare(right.id),
    )
    .slice(0, 10);
}
```

「5日以内」は現時点では「現在時刻から遡る120時間、境界を含む」と解釈する。暦日単位を意図する場合は要件を変更する必要がある。

## 5. 実装選択肢

### 案A: 固定の`新しいNote`だけを追加（推奨・最小）

変更範囲:

- `vite.config.ts`: manifestの`shortcuts`へ`新しいNote`を追加。
- 起動action解析を小さな純粋関数として追加。
- `src/App.tsx`: 初期化完了後、既存の新規Note処理へ1回だけ渡す。
- manifest検証、unit test、PWA E2Eを追加。

利点:

- Windows版Edge／Chromeで標準的に動作する。
- NoteデータやTitleをOS更新用に送信しない。
- 既存の未保存確認とdraft規則を維持できる。

注意点:

- 既存インストールではmanifest更新が即時反映されないことがある。
- 非対応ブラウザーでは項目が表示されないが、通常Web利用は維持する。
- PWAが既に開いている場合のウィンドウ再利用はブラウザーに依存する。既存ウィンドウへ遷移した場合も未保存確認を省略しない。

### 案B: `新しいNote`と固定の`最近のNote`を追加（推奨代替）

`最近のNote`はTitle一覧をジャンプリストへ並べず、`/?view=recent`でアプリ内一覧を開く。

利点:

- 更新直後でもIndexedDBの最新値を表示できる。
- 「更新5日以内・最大10件・日時降順」を正確に制御できる。
- OS上にNote Titleを露出しない。
- 2項目だけなのでプラットフォームごとの上限に強い。

### 案C: Windowsネイティブの動的ジャンプリスト（正確な要件が必須の場合）

WinUI／WebView2等でpackage identityを持つWindowsアプリを用意し、Web側からローカルNoteの`id`、表示Title、`updatedAt`をネイティブブリッジへ渡す。ネイティブ側はJumpList APIで`最近`カスタムグループと`タスク`を更新する。

これは通常のPWA機能追加ではなく、Windows専用配布、署名、更新、ブラウザープロファイル／IndexedDB共有、ブリッジ認証、障害時フォールバックを伴う別アーキテクチャである。MSIX化するだけでは不足する。

## 6. プライバシーとセキュリティ

Note Titleは個人情報や機密情報を含み得る。ジャンプリストへTitleを表示すると、アプリを開かず、認証や画面ロック解除後のアプリ内保護を経ずに第三者が閲覧できる。

- 動的Title表示を将来実装する場合は、既定OFFの明示的な利用者設定にする。
- TitleやNote本文をmanifest取得用サーバーへ送信しない。
- 起動URLにはTitleではなくランダムなNote IDだけを使う。
- 不明なaction、存在しないID、不正なURL値は副作用なく無視する。
- Note IDを受け取っても、同一OriginのIndexedDBに存在する保存済みNoteだけを開く。

## 7. テスト設計

### 7.1 テスト観点

| 観点 | 検証意図 |
| --- | --- |
| 機能 | manifestショートカット、起動action、新規draft、最近抽出、オフライン起動が要求どおり連携すること。 |
| 非機能 | manifest更新遅延、起動時間、ブラウザー差、Windows差、アクセシビリティ、プライバシー、フレーク要因を把握すること。 |
| データ | `updatedAt`の5日境界、件数上限、同一日時、欠損／不正値、削除済みID、保存前draftを正しく扱うこと。 |
| UI | タスクバーとスタートメニューの両方で表示され、ラベル省略、並び順、既存ウィンドウ／新規ウィンドウの挙動が理解可能であること。 |

### 7.2 正常系

1. 新規インストール後、タスクバーとスタートメニューの右クリックに`新しいNote`が表示される。意図は、OS統合がmanifestどおり成立することの確認。
2. アプリ終了中に`新しいNote`を選ぶと、空の新規draftが1件だけ開く。意図は、cold startでのaction処理確認。
3. アプリ起動中に`新しいNote`を選んでも既存の未保存確認規則を維持する。意図は、画面ボタン／`Alt+N`／ジャンプリストの処理一貫性確認。
4. オフラインで`新しいNote`を選んでもprecache済みアプリが起動し、新規draftを開始できる。意図は、PWAの主要価値を壊さないことの確認。
5. 案Bでは、対象Noteを`updatedAt`降順で最大10件表示する。意図は、ジャンプリスト制約からアプリ内へ移した要件が保持されることの確認。

### 7.3 異常系

1. 不明な`action`、空値、過大な値を無視して通常起動する。意図は、URL入力が副作用やクラッシュを起こさないことの確認。
2. IndexedDBのopen失敗時、recent一覧はエラーを表示し、0件と誤認しない。意図は、前提条件崩れの原因切り分け。
3. 起動後に対象Noteが削除済みなら、通常一覧へフォールバックして明示メッセージを出す。意図は、ジャンプリストの古い参照に耐えることの確認。
4. manifest更新取得に失敗しても、既存PWAとNote編集が継続する。意図は、OS統合機能を本体利用の必須条件にしないことの確認。
5. 非対応ブラウザーではジャンプリスト項目がなくても、通常Web機能とインストール済みPWA機能が退行しない。意図は、限定提供の安全な劣化確認。

### 7.4 境界値

1. `updatedAt === now - 5日`は含み、1ms古いNoteは除外する。
2. 対象0、1、9、10、11件で件数と順序を確認する。
3. 同一`updatedAt`では`id`をタイブレークに使い、実行ごとの順序揺れを防ぐ。
4. `NaN`、`Infinity`、負数、未来日時をデータ異常としてどう扱うかを固定する。少なくとも非有限値は除外する。
5. 空Titleは保存規則と同じ`Untitled`表示に統一する。

### 7.5 状態遷移

1. 未インストール → 新規インストール → ショートカット表示。
2. 旧manifestのインストール済みPWA → 更新検出 → 全ウィンドウ終了 → 新ショートカット表示。
3. アプリ終了中 → ジャンプリスト起動 → action消費 → URL正規化 → 再読み込み。
4. clean編集 → 新規Note、dirty編集 → 確認で破棄／キャンセル／保存失敗。
5. online → offline → ジャンプリスト起動 → online復帰。
6. 連続クリック／複数ウィンドウ起動時に新規draftを意図せず複数生成しない。

### 7.6 環境差と実行範囲

実装時の推奨範囲:

- unit: action解析、1回限りの消費、recent抽出、境界値、異常値。
- build検証: 生成manifestの`shortcuts`、URL scope、既存manifest項目、precache。
- 対象E2E: production PWA buildでcold start、offline、URL再読み込み、既存画面の新規Note処理。
- 実機手動: Windows 11の最新EdgeとChromeで、それぞれ新規インストールと既存インストール更新、タスクバーとスタートメニューを確認する。
- 必要に応じてWindows 10も確認する。管理ポリシーや「最近使った項目」設定の差を証跡に残す。

全E2Eは既定としない。変更範囲がmanifestと起動actionに限定されるため、PWA対象ケースと既存の新規Noteケースを実行し、通常のMarkdown編集、Cloud backup、Marp全件は未実施範囲として明記する。ただし、OSジャンプリストはPlaywrightだけでは保証できないため、Edge／Chromeの実インストール確認を必須にする。同一実機へのスクリプト並列実行は行わない。

失敗時は、ブラウザー名／バージョン、Windows build、インストールOrigin、manifest内容、manifest最終確認時刻、PWA起動状態、ショートカット選択URL、Service Worker状態を記録する。manifest更新待ちを固定sleepだけで判定せず、DevToolsのApplicationパネルとChrome系のweb app内部情報で切り分ける。

この調査では実装変更とテスト実行は行っていない。

## 8. まず防ぐべき不具合

| 優先度 | 不具合 | 理由 |
| --- | --- | --- |
| 重大 | ジャンプリスト起動で編集中の未保存内容が確認なしに失われる | ユーザーデータ損失に直結する。 |
| 重大 | actionの再処理で空draftが複数生成される | 再読み込みや複数起動で再現し、Note一覧を汚染する。 |
| 重大 | Note Titleをサーバーへ送り、manifestを利用者別生成する | local-first方針とプライバシー境界を破る。 |
| 軽微 | manifest更新直後にショートカットが見えない | ブラウザーの更新抑制に起因し得るため、実装不具合と区別する必要がある。 |
| 軽微 | 長いTitleや空Titleが読みにくい | 表示品質の問題だがデータ損失はない。 |

## 9. 参考資料

- [Microsoft Edge: アプリのショートカットを定義する](https://learn.microsoft.com/ja-jp/microsoft-edge/progressive-web-apps/how-to/shortcuts)
- [MDN: Web App Manifest `shortcuts`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts)
- [web.dev: Get things done quickly with app shortcuts](https://web.dev/articles/app-shortcuts)
- [web.dev: How Chrome handles updates to the web app manifest](https://web.dev/articles/manifest-updates)
- [W3C: Web Application Manifest - shortcuts](https://www.w3.org/TR/appmanifest/#shortcuts-member)
- [Microsoft Learn: Add items to the Windows jump list](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/jump-list)
