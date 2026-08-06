# Markdown Knowledge Board フェーズ3 PWA要件定義

作成日: 2026-08-04
文書状態: レビュー用初版
対象: Markdown Knowledge Board のインストール対応、オフライン再起動、Service Worker更新管理

---

## 1. 目的

フェーズ3では、現行のReact SPAをProgressive Web App（PWA）としてインストール可能にし、初回のオンライン準備完了後は、ネットワークがない状態でもアプリを新規起動・再読み込みしてローカル機能を利用できるようにする。

PWA対応後も、IndexedDBをローカルデータの正本とする。Service WorkerとCache Storageはアプリコードを配布するためだけに使用し、ノート本文、認証情報、クラウドバックアップ内容の保存先にはしない。

フェーズ3で最初に防ぐべき不具合は次の2点とする。

1. Service Worker更新による自動再読み込みで、未保存の編集内容を失うこと。
2. 認証・クラウドAPIの応答をキャッシュし、古い認証状態や他の操作結果を表示すること。

## 2. 要件サマリー

| 優先度 | 達成すること | 完了判断 |
| --- | --- | --- |
| P0 / 致命防止 | インストール・更新・失敗時にもIndexedDBと未保存編集を失わない | データ保全テストが全件成功 |
| P0 / 致命防止 | `/api/**`、OAuth、session、Gist、暗号化バックアップをService Workerでキャッシュしない | request/cache監査が成功 |
| P0 / 重大 | 初回オンライン準備後に、ブラウザやインストール済みアプリを閉じても完全オフラインで再起動できる | production buildの自動E2Eと実機手動確認が成功 |
| P1 / 重大 | 対応環境でインストールでき、非対応環境では通常のWebアプリとして利用できる | 環境マトリクスを満たす |
| P1 / 重大 | 新版を検出しても自動再読み込みせず、利用者の明示操作で安全に更新する | dirty／clean／複数タブの状態遷移が成功 |
| P1 / 重大 | オフライン中も既存のローカル機能を継続し、クラウド操作は安全に停止する | ローカル回帰と再接続テストが成功 |
| P2 / 軽微 | アイコン、テーマ色、standalone表示、端末別インストール案内が一貫する | 画面・manifest確認が成功 |

## 3. テスト観点（ケース詳細化より先に固定する観点）

### 3.1 観点一覧

| 分類 | 主な観点 | 特に疑う前提の崩れ |
| --- | --- | --- |
| 機能観点 | manifest、インストール、app shellキャッシュ、オフライン起動、更新、再接続、クラウド縮退 | Service Workerがreadyになる前の切断、更新待機中の操作、複数タブ |
| 非機能観点 | 信頼性、性能、容量、セキュリティ、プライバシー、アクセシビリティ、互換性 | 低速回線、quota不足、OS／ブラウザ差、Service Worker強制終了 |
| データ観点 | IndexedDB正本、Cache Storage分離、更新前後の不変性、Origin分離、アンインストール | 空DB／大量ノート／dirty draft／DB初期化失敗／site data消去 |
| UI観点 | Install、Install Help、Offline、Update available、standalone表示、focus | install prompt非対応、既にインストール済み、狭幅、キーボード操作 |

### 3.2 系統別の切り分け

| 系統 | 必ず含める対象 | 検証意図 |
| --- | --- | --- |
| 正常系 | 初回準備、インストール、オフライン再起動、ローカル編集、明示更新 | 想定導線が最後まで完結すること |
| 異常系 | precache失敗、registration失敗、quota不足、API offline、更新取得失敗 | PWA障害がローカル編集や旧版を壊さないこと |
| 境界値 | 初回準備前後、0件／多数ノート、cache上限、390px、複数Origin、複数タブ | 状態や容量の境目で誤判定しないこと |
| 状態遷移 | install、connectivity、update、dirty、modal、cloud operation | 非同期応答や競合で古い状態が新しい状態を上書きしないこと |

### 3.3 環境・タイミング・再現性

- Chromium、Firefox、WebKitの差を分け、インストールAPIの存在を前提にしない。
- desktop、Android Chrome、iPhone Safariの導線差を分ける。
- fast／slow／offline、切断中のinstall、update取得中の切断、再接続を分ける。
- Service Workerの`install`／`waiting`／`activate`／`controllerchange`と、画面のdirty／dialog／cloud operationを組み合わせる。
- 単体では成功し通しで失敗する原因として、Service Worker、Cache Storage、IndexedDB、同一Origin、ポートの使い回しを疑う。
- フレーク時は、待機条件不足、古いregistration、旧cache、非同期イベント順、テスト間のOrigin共有を仮説として記録する。
- 同一実機スマートフォンへのスクリプト並列実行は行わない。実機検証そのものはユーザーが手動で実施する。

## 4. 現行仕様と前提

### 4.1 現行仕様

- React 19、Vite 7、TypeScriptのSPAである。
- IndexedDB `markdown-knowledge-board` の `notes` storeがローカルデータの正本である。
- GitHub認証と暗号化Gistバックアップは任意機能であり、明示操作でのみ開始する。
- オフラインからオンラインへ戻っても、クラウドバックアップ、復元、session再試行を自動開始しない。
- Productionは次の2 Originを正式に利用する。
  - `https://mkb.bamboosato.com/`
  - `https://markdown-knowledge-board.vercel.app/`
- 2 OriginのIndexedDB、Cache Storage、Service Worker、インストール状態は別物であり、自動共有しない。
- フェーズ2のoffline対応は「既に表示中の画面でローカル機能を継続できること」であり、Service Workerによる完全オフライン新規起動はフェーズ3で扱う。

### 4.2 実機検証の役割分担

- desktopおよびブラウザエミュレーションの検証は自動化する。
- Android Chrome／iPhone Safariの実機確認は、実装側が手順・期待結果・証跡テンプレートを用意し、ユーザーが手動実行する。
- 実機手動確認をProductionリリース判定のゲートとする。実行結果を受け取るまでは「実機確認待ち」と明示する。

## 5. スコープ

### 5.1 対象

- Web App ManifestとPWAアイコン
- ProductionのService Worker登録
- app shellと同一Originのbuild assetのprecache
- 初回オンライン準備後の完全オフライン新規起動／再読み込み
- インストール導線と端末別Install Help
- オフライン状態表示
- 新版検出、更新通知、安全な明示更新
- IndexedDB、Cache Storage、認証／クラウド境界の保護
- desktop自動テスト、Production smoke、実機手動チェックリスト
- README、現行設計仕様、運用／復旧手順の更新

### 5.2 対象外

- 初回アクセスを一度も成功していない端末でのオフライン起動
- ノートまたはクラウド操作の自動同期、Background Sync、Periodic Background Sync
- Push通知、OSバッジ、Web Share Target、File Handling API
- App Store／Google Play／Microsoft Store向けパッケージ化
- user-authoredな外部画像、外部font、外部script、外部iframeのオフライン保存
- GitHub認証、Gist backup／restoreのオフライン実行または自動再試行
- 2つのProduction Origin間のIndexedDB／cache／インストール状態の自動移行
- PWAアンインストール時のブラウザsite data保持保証
- Service Workerを利用したノート本文、token、passphrase、暗号鍵の保存

## 6. 対象環境

| 環境 | Web利用 | インストール | オフライン再起動 | 検証方法 |
| --- | --- | --- | --- | --- |
| Desktop Chrome／Edge current stable | 必須 | 必須 | 必須 | Chromium自動E2E＋desktop smoke |
| Desktop Firefox current stable | 必須 | ブラウザ提供範囲。独自install promptは必須にしない | 必須 | Firefox自動E2E |
| Desktop Safari current stable | 必須 | ブラウザ提供範囲 | 必須 | WebKit自動E2E＋必要時desktop手動 |
| Android Chrome current stable | 必須 | 必須 | 必須 | ユーザーによる実機手動 |
| iPhone Safari current stable | 必須 | 「ホーム画面に追加」案内 | 必須 | ユーザーによる実機手動 |
| Vercel Preview／localhost | 必須（local-only） | 正式対象外 | 明示的なPWA test buildだけ対象 | 自動テスト |

- current stableは実施日時点の安定版とし、証跡にOS／ブラウザversionを残す。
- install prompt非対応はWebアプリ失敗と扱わない。通常タブでローカル機能を利用できることを必須とする。
- Service Workerを使うE2EはVite dev serverではなくproduction buildを配信して実行する。

## 7. 機能要件

### 7.1 Web App Manifest

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-MAN-001 | Must | HTMLから同一Originの`.webmanifest`を参照し、正しいmanifest MIME typeで配信する。 |
| PWA-MAN-002 | Must | `id`、`name`、`short_name`、`start_url`、`scope`、`display`、`theme_color`、`background_color`、`icons`を明示する。 |
| PWA-MAN-003 | Must | `id`／`start_url`／`scope`はルート配下の相対設計とし、2つのProduction Originのどちらでも同じbuildを安全に利用できるようにする。 |
| PWA-MAN-004 | Must | 192px、512px、maskable 512pxのPNG iconとApple touch iconを用意し、透明欠け、余白不足、文字潰れがないことを確認する。 |
| PWA-MAN-005 | Must | `display: standalone`とし、standalone／browser tabの両方で既存操作が完結する。 |
| PWA-MAN-006 | Should | theme／background色は現行UI tokenと整合し、起動時の不自然な白／黒flashを抑える。 |
| PWA-MAN-007 | Must | manifestやicon取得失敗が、通常のWebアプリ起動とローカル保存を妨げない。 |

### 7.2 Service Worker登録と環境境界

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-REG-001 | Must | 2つのProduction OriginでHTTPS配信時にService Workerを登録する。 |
| PWA-REG-002 | Must | localhost／Previewでは既定で登録せず、明示的なPWA test設定だけで有効化する。 |
| PWA-REG-003 | Must | registration、install、activateの失敗を画面初期化から分離し、IndexedDBの読込・編集・保存を継続する。 |
| PWA-REG-004 | Must | Service Workerのscopeをアプリルート内に限定し、想定外のpathを支配しない。 |
| PWA-REG-005 | Must | Service Worker scriptは更新検出を妨げる長期HTTP cacheの対象にしない。hash付きbuild assetとはcache policyを分ける。 |

### 7.3 Cache Storageとfetch方針

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-CACHE-001 | Must | HTML app shellと、オフラインのローカル機能に必要な同一Originのbuild assetをprecacheする。 |
| PWA-CACHE-002 | Must | scope内のnavigationは、オンライン時に新版確認ができ、ネットワーク失敗時に一貫したcached app shellへfallbackする。 |
| PWA-CACHE-003 | Must | hash付き静的assetはcache-firstで扱い、HTMLと異なるversionのassetを混在させない。 |
| PWA-CACHE-004 | Must | `/api/**`、OAuth、session、GitHub／Gist、Cloud Backup／Restore、暗号化payloadをnetwork-onlyとし、Cache Storageへ保存しない。 |
| PWA-CACHE-005 | Must | user-authoredな外部resourceをruntime cacheしない。offlineで取得不能でも、ノート本文の編集・保存を妨げない。 |
| PWA-CACHE-006 | Must | install／updateのprecacheが途中失敗した場合は不完全な新版をactivateせず、現在のactive版を維持する。 |
| PWA-CACHE-007 | Must | 不要cacheをversion単位で整理する。ただし旧画面を開いたタブを強制reloadせず、未保存編集を保持する。 |
| PWA-CACHE-008 | Must | cache名とversionは診断可能にするが、ノート名、本文、ユーザーID、tokenを含めない。 |

### 7.4 オフライン起動とローカル機能

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-OFF-001 | Must | 初回オンライン表示でService Workerがreadyになった後、全タブを閉じ、完全オフラインにしてもアプリを新規起動できる。 |
| PWA-OFF-002 | Must | オフライン再読み込みでもIndexedDBから既存ノートを読み込み、選択、検索、filter、編集、保存、新規作成、削除を利用できる。 |
| PWA-OFF-003 | Must | Markdown import/export、JSON backup/import、Edit／Preview／Slides、Body toolbar、metadata編集をオフラインで利用できる。 |
| PWA-OFF-004 | Must | bundledなMarkdown、Mermaid、Marp、CodeMirror処理はオフラインで動作する。外部resource失敗をアプリ全体の失敗にしない。 |
| PWA-OFF-005 | Must | オフライン中は非modalな`Offline`表示を出し、local機能が利用可能であることを伝える。 |
| PWA-OFF-006 | Must | GitHub／Cloud Backup／Restoreは既存のoffline表示と再試行導線を保ち、接続回復だけで自動実行しない。 |
| PWA-OFF-007 | Must | `navigator.onLine`だけで成功を断定せず、実request失敗もoffline／unavailableとして安全に扱う。 |
| PWA-OFF-008 | Must | Service Worker非対応、無効化、削除済みでも、オンライン時は従来のWebアプリとして利用できる。 |

### 7.5 インストール導線

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-INSTALL-001 | Must | ブラウザがapp側install promptを提供し、Service Workerがreadyで、未インストールの場合だけapplication menuに`Install App`を表示する。 |
| PWA-INSTALL-002 | Must | install promptは`Install App`の明示操作からだけ開始し、起動直後に自動表示しない。 |
| PWA-INSTALL-003 | Must | install成功後またはstandalone起動中は`Install App`を非表示にする。 |
| PWA-INSTALL-004 | Must | prompt拒否／取消後も編集状態とmenu状態を壊さず、繰り返し表示で利用者を妨げない。 |
| PWA-INSTALL-005 | Must | iPhone Safariなどapp側promptを提供しない対象環境では、利用可能な場合だけ`Install Help`を表示し、OS標準の「ホーム画面に追加」手順を案内する。 |
| PWA-INSTALL-006 | Must | 非対応環境では動作しないinstall controlを表示せず、通常Web利用へ自然にfallbackする。 |
| PWA-INSTALL-007 | Must | install前後でIndexedDBを作り直したりノートを複製したりしない。 |

### 7.6 更新管理

更新通知の確定copyは次のとおりとする。

- 見出し: `Update available`
- 主操作: `Restart to update`
- 保留操作: `Later`
- 未保存時の主操作: `Save and restart`
- 未保存時の取消: `Cancel`

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-UPD-001 | Must | 新しいService Workerがwaitingになったら、編集を遮らない非modalな更新通知を表示する。 |
| PWA-UPD-002 | Must | 新版検出だけでは`skipWaiting`、強制reload、draft破棄を行わない。 |
| PWA-UPD-003 | Must | cleanかつ主要operationがidleのとき、`Restart to update`で新版をactivateし、現在タブを1回だけreloadする。 |
| PWA-UPD-004 | Must | dirtyの場合は`Save and restart`／`Cancel`だけを提示する。破棄して更新する選択肢は設けない。 |
| PWA-UPD-005 | Must | 保存失敗時はactivate／reloadせず、draftと旧版を維持して原因を表示する。 |
| PWA-UPD-006 | Must | dialog操作、import/export、Cloud Backup／Restore適用中は更新を割り込ませず、操作終了後に適用可能とする。 |
| PWA-UPD-007 | Must | update download／install失敗時は旧版を継続し、成功した更新として表示しない。 |
| PWA-UPD-008 | Must | 複数タブの一方が更新しても、他タブを強制reloadせず、他タブの未保存編集を失わない。 |
| PWA-UPD-009 | Must | `controllerchange`の重複や遅延eventでreload loopを発生させない。 |
| PWA-UPD-010 | Must | 更新後もIndexedDB schemaと既存ノートを保持し、必要なDB migrationはtransactionalかつ後方互換にする。 |

### 7.7 ストレージとデータ保護

| ID | 優先度 | 要件 |
| --- | --- | --- |
| PWA-DATA-001 | Must | ノート、metadata、pin、設定の正本はIndexedDBとし、Cache Storageへ複製しない。 |
| PWA-DATA-002 | Must | PWA install、Service Worker update、cache cleanupでIndexedDBをdelete／clearしない。 |
| PWA-DATA-003 | Must | cache quota不足とIndexedDB save失敗を区別し、片方の失敗をもう片方の成功として表示しない。 |
| PWA-DATA-004 | Must | site data消去またはPWAアンインストール時のローカルデータ保持はブラウザ依存であることをヘルプ／READMEに明記する。 |
| PWA-DATA-005 | Should | `navigator.storage.persist()`が利用可能な場合は、利用者の明示的な保存またはinstall後にbest effortで永続化を要求できる。拒否／非対応はlocal機能を止めない。 |
| PWA-DATA-006 | Must | persistent storageの成否をbackup完了と表現しない。重要データにはMarkdown／JSON exportまたは明示的Cloud Backupが必要である。 |
| PWA-DATA-007 | Must | 2つのProduction Originのデータは分離されたままとし、PWA対応を自動移行と誤認させない。 |

## 8. 非機能要件

### 8.1 性能・容量

| ID | 要件 |
| --- | --- |
| PWA-NFR-001 | 初回precacheの圧縮転送量を5 MiB以下とする。超える場合はrelease blockerとしてbundle分割または対象見直しを行う。 |
| PWA-NFR-002 | warm cacheのオフライン起動は、基準desktopで5回測定し、操作可能までの中央値2秒以下、最大3秒以下を目標とする。 |
| PWA-NFR-003 | Service Worker登録／更新確認は最初のローカルノート表示をblockしない。 |
| PWA-NFR-004 | cacheは現行配布assetと更新に必要な最小世代に限定し、deploymentごとに無制限増加しない。 |

### 8.2 信頼性

| ID | 要件 |
| --- | --- |
| PWA-NFR-005 | install、activate、fetch handlerは冪等にし、ブラウザによるService Worker途中終了後も再実行できる。 |
| PWA-NFR-006 | cache miss、破損、quota不足、更新失敗のいずれでも、利用可能な旧版またはオンラインWebへfallbackする。 |
| PWA-NFR-007 | offline／online event、update event、DB responseの順序が逆転しても、古い応答で新しい状態を上書きしない。 |

### 8.3 セキュリティ・プライバシー

| ID | 要件 |
| --- | --- |
| PWA-SEC-001 | Productionではsecure contextと同一OriginだけでService Workerを利用する。 |
| PWA-SEC-002 | auth／session／CSRF／token／passphrase／derived key／encrypted backup responseをCache Storageへ保存しない。 |
| PWA-SEC-003 | cross-origin requestをruntime cacheせず、CORS opaque responseを蓄積しない。 |
| PWA-SEC-004 | diagnostics、cache名、更新versionにユーザーデータや秘密情報を含めない。外部analyticsをPWA対応のために追加しない。 |
| PWA-SEC-005 | manifestの名前、icon、start URL、Originが正規アプリと識別でき、別サービスを装わない。 |

### 8.4 アクセシビリティ・UI

| ID | 要件 |
| --- | --- |
| PWA-UI-001 | Install／Update／Offline UIをキーボード操作可能にし、visible focusと適切なaccessible nameを持たせる。 |
| PWA-UI-002 | OfflineとUpdate availableは`aria-live`で重複通知を抑え、表示時にeditorからfocusを奪わない。 |
| PWA-UI-003 | 390×844で横scroll、本文遮蔽、操作重なりを発生させない。safe areaを考慮する。 |
| PWA-UI-004 | browser tab／standalone、light／dark、online／offlineで文字と操作のcontrastをWCAG 2.2 AA相当に保つ。 |
| PWA-UI-005 | install／update API非対応時にもconsole errorや空のdialogを出さない。 |

## 9. 状態遷移

### 9.1 初回準備

```text
unsupported                         -> web-only usable
unregistered -> registering -> ready -> offline-capable
unregistered -> registering -> failed -> web-only usable
registering -> install-failed       -> web-only usable
```

- `ready`になる前にオフラインとなった場合、完全オフライン対応済みと表示しない。
- `failed`でもIndexedDBの初期化と通常のオンラインWeb利用を継続する。

### 9.2 インストール

```text
unavailable -> prompt-available -> prompting -> installed
unavailable -> prompt-available -> prompting -> dismissed
installed   -> standalone-launched
```

- `dismissed`はerror扱いにしない。
- `installed`判定だけでデータbackup済みとは表示しない。

### 9.3 接続状態

```text
online -> offline -> online
online -> request-failed -> unavailable -> explicit retry -> online
```

- `offline -> online`だけでsession、Cloud Backup、Restoreを自動開始しない。
- online表示中のrequest失敗も、local機能を止めない。

### 9.4 更新

```text
idle -> checking -> no-update -> idle
idle -> checking -> downloading -> waiting
waiting -> Later -> waiting
waiting + clean + idle -> Restart to update -> activating -> reload-once -> ready
waiting + dirty -> Save and restart -> saving -> activating -> reload-once -> ready
waiting + dirty -> Save and restart -> saving-failed -> waiting + dirty
waiting + dirty -> Cancel -> waiting + dirty
checking | downloading | activating -> failed -> current-version
```

- late responseは新しいupdate stateを上書きしない。
- dirty、dialog、cloud operationの状態をupdate stateとは独立に保持する。

## 10. エラー・異常系仕様

| ID | 状況 | 期待結果 | 検証意図 |
| --- | --- | --- | --- |
| PWA-ERR-001 | Service Worker API非対応 | 通常Webとして起動 | PWA非対応でlocal機能を失わない |
| PWA-ERR-002 | registration失敗 | local UI継続、診断可能なwarning | 起動全体の失敗にしない |
| PWA-ERR-003 | precache途中で切断 | 不完全新版をactivateしない | broken offline版を配布しない |
| PWA-ERR-004 | Cache Storage quota不足 | 旧版／online Web継続、IndexedDB不変 | cache障害とデータ障害を分離する |
| PWA-ERR-005 | offlineで`/api/**`実行 | cached successを返さずoffline表示 | 古い認証・cloud結果を使わない |
| PWA-ERR-006 | update待機中にSave失敗 | reloadせずdraft保持 | 更新によるデータ消失を防ぐ |
| PWA-ERR-007 | activate後のasset miss | reload loopを起こさず復旧案内 | 復旧不能ループを防ぐ |
| PWA-ERR-008 | IndexedDB初期化失敗 | cache済み画面で成功を装わず既存error表示 | app shell成功とデータ成功を混同しない |
| PWA-ERR-009 | 外部画像がoffline | 画像だけ失敗し、本文編集・保存は継続 | 外部依存をlocal coreへ波及させない |
| PWA-ERR-010 | 別Originをインストール | 独立アプリ／独立データとして扱う | Origin間の暗黙共有を防ぐ |

## 11. テストケース一覧

各ケースは前提条件、操作、期待結果、検証意図を必須項目とする。ここでは実装前に固定する主要ケースを示す。

### 11.1 正常系

| ID | 前提 | 操作 | 期待結果 | 検証意図 |
| --- | --- | --- | --- | --- |
| PWA-N-01 | clean browser、online | 初回表示しSW readyを待つ | app shellがprecacheされる | オフライン準備完了条件を保証する |
| PWA-N-02 | PWA-N-01完了 | 全pageを閉じofflineで新規起動 | UIと既存ノートが表示される | 完全オフライン新規起動を保証する |
| PWA-N-03 | offline起動済み | 新規、編集、保存、検索、削除 | IndexedDBへ反映しreload後も残る | local coreが通信不要で完結する |
| PWA-N-04 | offline、fixtureあり | import、Preview、Slides、export | local処理が完結する | bundled機能のcache漏れを検出する |
| PWA-N-05 | prompt available | Install Appを実行 | native prompt、install後control非表示 | 明示install導線を保証する |
| PWA-N-06 | installed、offline | launcherから起動 | standaloneでlocal機能利用可能 | インストール価値を保証する |
| PWA-N-07 | v1 active、v2 waiting、clean | Restart to update | 1回reloadしv2表示 | 安全な明示更新を保証する |
| PWA-N-08 | v1 active、v2 waiting、dirty | Save and restart | save後に1回reloadし編集保持 | dirty更新のデータ保全を保証する |
| PWA-N-09 | offline表示中 | 接続回復 | Offline表示解除、cloud自動処理なし | 再接続の副作用を防ぐ |
| PWA-N-10 | Production 2 Origin | 各Originで準備／起動 | 各々独立して成功 | 相対manifestとOrigin分離を保証する |

### 11.2 異常系

| ID | 注入 | 期待結果 | 検証意図 |
| --- | --- | --- | --- |
| PWA-E-01 | register reject | Web利用／IndexedDB保存可能 | PWA障害の分離 |
| PWA-E-02 | precache asset 404 | 新SW不成立、旧版維持 | 不完全版のactivate防止 |
| PWA-E-03 | install中network切断 | online復帰後に再試行可能 | タイミング依存からの復旧 |
| PWA-E-04 | Cache.putでQuotaExceededError | DB不変、旧版継続 | cacheとdataの障害分離 |
| PWA-E-05 | offlineでsession／Gist request | cached responseなし | security境界の保証 |
| PWA-E-06 | dirty saveをreject | update不実行、draft保持 | データ消失防止 |
| PWA-E-07 | update check reject | 現行版継続 | 更新失敗を起動失敗にしない |
| PWA-E-08 | stale controllerchangeを重複送出 | reloadは最大1回 | reload loop防止 |
| PWA-E-09 | external image timeout | 本文操作継続 | 外部resource障害の局所化 |
| PWA-E-10 | SW／cacheを手動削除 | online Webへ復旧可能 | 利用者操作後の回復性 |

### 11.3 境界値・データ

| ID | 条件 | 期待結果 | 検証意図 |
| --- | --- | --- | --- |
| PWA-B-01 | ready直前／直後にoffline化 | 前は未準備、後はoffline起動成功 | 完了境界の誤判定防止 |
| PWA-B-02 | 0 notes | offline起動・新規作成可能 | 初期データ依存の排除 |
| PWA-B-03 | 多数／大容量notes | cache量と無関係にDB読込 | user dataをprecacheしない保証 |
| PWA-B-04 | precache 5 MiB直下／超過 | 直下成功、超過release block | 容量budgetの保証 |
| PWA-B-05 | 390×844／desktop | control重なりなし | viewport境界の保証 |
| PWA-B-06 | install eventなし／あり | HelpまたはInstallを適切に表示 | capability分岐の保証 |
| PWA-B-07 | browser tab／standalone | 同じデータと機能 | display mode差の回帰防止 |
| PWA-B-08 | custom domain／Vercel domain | 独立cache／DB | Origin境界の保証 |
| PWA-B-09 | 1 tab／2 tabs dirty | 他tabを強制reloadしない | 複数client競合の保証 |
| PWA-B-10 | current／waiting／failed cache世代 | 不要cacheが増え続けない | cleanup境界の保証 |

### 11.4 状態遷移・競合

| ID | 遷移 | 期待結果 | 検証意図 |
| --- | --- | --- | --- |
| PWA-S-01 | install prompt available→dismissed→再訪 | editor継続、強制再promptなし | 利用者選択の尊重 |
| PWA-S-02 | online→offline→online | local継続、cloud自動処理なし | 接続event副作用の防止 |
| PWA-S-03 | update waiting中にdirty化 | Save and restartへ切替 | stale clean判定防止 |
| PWA-S-04 | Save and restart中にsave失敗 | waiting＋dirtyへ戻る | error回復の保証 |
| PWA-S-05 | dialog open中にupdate waiting | focusを奪わず後で通知可能 | 非同期UI競合の防止 |
| PWA-S-06 | cloud upload中にupdate waiting | upload完了まで更新保留 | operation中断防止 |
| PWA-S-07 | v2取得中にv3公開 | 最終的に一貫した1 versionをactivate | version混在防止 |
| PWA-S-08 | 2 tabsの片方でupdate適用 | 他tabのdirty保持 | client間データ損失防止 |
| PWA-S-09 | activate→controllerchange重複 | 1回だけreload | event重複耐性 |
| PWA-S-10 | update後にDB migration失敗 | transaction rollback、診断可能 | 部分migration防止 |

## 12. テスト実行設計

### 12.1 自動化レイヤー

| レイヤー | 対象 | 手段 |
| --- | --- | --- |
| unit | capability判定、update reducer、cache除外規則、copy、manifest値 | Vitest |
| build検査 | manifest、icon、Service Worker、precache量、禁止URL | production build artifact検査 |
| browser E2E | offline再起動、dirty update、API非cache、複数tab | Playwright Chromium、production preview server |
| cross-browser E2E | local回帰、offline fallback、非対応API縮退 | Chromium／Firefox／WebKit |
| Production smoke | 2 Originのmanifest、SW、offline起動、API非cache | 破壊しない専用データ、serial |
| 実機手動 | install、launcher、standalone、OS終了後offline起動 | ユーザーがAndroid Chrome／iPhone Safariで実施 |

### 12.2 前提条件と初期化

- PWA E2Eは明示的な`PLAYWRIGHT_PORT`を使い、対象portでproduction buildが配信されていることを確認する。
- 各テストはbrowser context、Service Worker registration、Cache Storage、IndexedDBの初期状態を宣言する。
- 原則はcontextを分離する。update／migration試験だけは意図的にv1状態を残してv2へ遷移する。
- offline化前に`navigator.serviceWorker.ready`と対象cache entryを待つ。固定sleepだけで成立させない。
- 同一Originのupdate fixtureはserial実行し、他テストとserver／cacheを共有しない。
- 実機手動試験は1台ずつ順番に実行し、同一端末へ並列に操作しない。

### 12.3 ログ・証跡

- 自動E2E失敗時はPlaywright trace、page console、Service Worker state、registration scope、cache key一覧、request URL／response sourceを保存する。
- 証跡にノート本文、token、passphrase、暗号化payloadを含めない。
- update試験はv1／v2の画面version、worker state、reload回数、dirty状態を記録する。
- offline試験はService Worker ready時刻、offline化時刻、起動完了時刻を記録する。
- フレーク再実行だけで成功扱いにせず、原因仮説を「テスト観点不足／データ問題／環境問題／実装問題」に分類する。

## 13. 実機スマートフォン手動検証

### 13.1 共通記録項目

- 実施日
- 端末名、OS version、ブラウザversion
- 対象Origin
- install前の既存ノート有無
- online／offlineの切替方法
- 各手順のPass／Fail、再現手順、スクリーンショットまたは画面録画
- Fail時の「どの時点まで成功したか」と再現回数

### 13.2 Android Chrome

1. onlineで対象Originを開き、既存ノートを1件保存する。
2. `Install App`からinstallし、ホーム画面／launcherの名前とiconを確認する。
3. Chromeとインストール済みアプリを完全終了する。
4. 機内モードにし、launcherから起動する。
5. standalone表示、既存ノート表示、新規作成、編集、保存、Preview、再起動後保持を確認する。
6. onlineへ戻し、Cloud Backup／Restoreが自動開始しないことを確認する。
7. 更新版公開時に`Update available`から安全に更新できることを確認する。

### 13.3 iPhone Safari

1. onlineで対象OriginをSafariで開き、既存ノートを1件保存する。
2. `Install Help`の案内に従い、共有メニューから「ホーム画面に追加」し、「Webアプリとして開く」を有効にする。
3. SafariとWebアプリを完全終了する。
4. 機内モードにし、ホーム画面のiconから起動する。
5. standalone表示、safe area、既存ノート表示、新規作成、編集、保存、Preview、再起動後保持を確認する。
6. onlineへ戻し、Cloud Backup／Restoreが自動開始しないことを確認する。
7. 更新版公開後の再起動または更新通知で、新版へ移行しデータを保持することを確認する。

## 14. 完了条件

### 14.1 PR完了条件

- 本書のMust要件と実装／テストのトレーサビリティがある。
- `npm run lint`、`npm run test:unit`、`npm run build`が成功する。
- PWA専用E2Eをproduction buildかつisolated portで実行し、成功する。
- Chromiumの全回帰と、PWA影響範囲のFirefox／WebKit回帰が成功する。
- build artifactからprecache量、manifest、icon、API非cacheを確認する。
- `git diff --check`が成功し、READMEと現行設計仕様が実装と一致する。

### 14.2 Productionリリース完了条件

- 2つのProduction Originでmanifest、Service Worker、offline新規起動、更新、local-only回帰を確認する。
- auth／session／Cloud Backup／RestoreのresponseがCache Storageに存在しない。
- ユーザーによるAndroid Chrome／iPhone Safari実機手動チェックが完了し、結果と環境情報が共有される。
- 重大Failが0件である。軽微な既知制約は影響、回避策、後続対応を記録する。
- rollbackとしてService Worker停止、registration／cache復旧、新版再配信の手順が文書化されている。

## 15. 不具合分析と優先度

### 15.1 分類

| 分類 | 例 |
| --- | --- |
| テスト観点不足 | dirty＋waiting＋複数tabの組合せを未実施 |
| データ問題 | 0件だけで試験し、大容量DBでのみ失敗 |
| 環境問題 | dev serverで試験し、production Service Workerを通していない |
| 実装問題 | API routeをnavigation fallbackまたはruntime cacheへ含めた |

### 15.2 優先度

| 重要度 | 判断基準 | 例 |
| --- | --- | --- |
| 致命 | データ消失、秘密情報漏えい、古い認証結果の再利用 | dirty強制reload、API response cache |
| 重大 | install不能、offline起動不能、更新不能、復旧不能loop | broken precache、controllerchange loop |
| 軽微 | icon余白、案内文、非主要環境の表示差 | maskable iconの見切れ |

不具合票には「なぜ検出できたか／なぜ事前に検出できなかったか」、再現回数、環境、worker state、cache世代、データ状態を残し、個別修正だけでなく同種パターンの再発防止テストを追加する。

## 16. 参照資料

- [Web Application Manifest (W3C)](https://www.w3.org/TR/appmanifest/)
- [Service Workers (W3C)](https://www.w3.org/TR/service-workers/)
- [Handling service worker updates with immediacy (Chrome for Developers)](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
- [iPhoneのSafariでWebサイトをアプリにする (Apple Support)](https://support.apple.com/ja-jp/guide/iphone/iphea86e5236/ios)
- [フェーズ2 認証・クラウドバックアップ要件定義](./phase2-auth-cloud-backup-requirements.md)
- [フェーズ2 認証・クラウドバックアップ基本設計](./phase2-auth-cloud-backup-architecture.md)
- [現行設計仕様](./design-spec.md)
