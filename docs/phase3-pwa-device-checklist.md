# フェーズ3 PWA 実機手動チェックリスト

## 1. 目的と実施境界

自動化では代替できないlauncher、standalone表示、OSによるアプリ終了、端末固有のinstall導線をAndroid ChromeとiPhone Safariで確認する。実機操作はユーザーが実施し、実装側は手順、期待結果、証跡様式、失敗時の切り分け情報を提供する。

- 同一実機に対して複数の検証を並列実行しない。
- 実運用ノートではなく、削除可能な専用ノートを使用する。
- 開始前に必要なローカルノートを`Backup All Notes`で退避する。
- AndroidとiPhoneは別々に初期化・実行・記録する。

## 2. テスト観点

ケース詳細化より先に、次の観点を固定する。

| 分類 | 観点 | まず防ぐ不具合 |
| --- | --- | --- |
| 機能 | install、launcher起動、standalone、offline再起動、保存、更新 | install不能、offline起動不能 |
| 非機能 | OS／browser差、低速／切断、Storage、safe area、再現性 | 起動loop、操作不能、見切れ |
| データ | install前後、offline編集、更新前後、アンインストール | ノート消失、dirty draft消失 |
| UI | icon、app名、status、focus、390px相当の狭幅 | 誤認、操作重なり、横scroll |

系統は正常系、異常系、境界値、状態遷移に分ける。失敗時は再現回数、online／offline切替時点、最後に成功した手順を記録し、再現性のないまま結論を出さない。

## 3. 共通前提条件

- 対象URL: `https://mkb.bamboosato.com/`
- secondary Origin確認時: `https://markdown-knowledge-board.vercel.app/`
- Production buildで`VITE_PWA_ENABLED=true`が設定されている。
- 端末日時が自動設定され、browserが最新版である。
- 端末の省電力、VPN、Private Relay、コンテンツブロッカーの有無を記録する。
- browserの対象site dataと既存ホーム画面iconの初期状態を記録する。既存PWAがある場合は、削除可否を確認してから初期化する。

## 4. Android Chrome

| ID | 系統 | 前提／操作 | 期待結果・検証意図 |
| --- | --- | --- | --- |
| AND-01 | 正常 | onlineでURLを開き、`Android online note`を保存する | 保存済み表示となり、install前データを準備できる |
| AND-02 | 正常 | Application menuの`Install App`を選び、native promptを承認する | app名とA案iconでホーム画面／launcherへ追加される |
| AND-03 | UI | launcherから起動し、縦横表示と390px相当の狭幅を確認する | browser address barなしのstandaloneで、横scroll・操作重なり・status遮蔽がない |
| AND-04 | 状態遷移 | standaloneで`Android installed note`を保存し、アプリとChromeを終了する | install前後の2件が保存される |
| AND-05 | 境界 | 機内モードにし、launcherから新規起動する | app shellが起動し、Offline表示と2件のノートが確認できる |
| AND-06 | 正常 | offlineで本文を変更して保存し、Previewを開く | ローカル編集・保存・Previewが成功する |
| AND-07 | 異常 | offlineでGitHub／Cloud操作を確認する | 成功扱い、cached session、automatic retryを発生させず、ローカル操作は継続する |
| AND-08 | 状態遷移 | onlineへ戻し、アプリを閉じて再起動する | offline保存内容が維持され、cloud actionを自動開始しない |
| AND-09 | 異常 | install promptを一度キャンセルした新規profileで再確認する | error alertを出さず通常Webとして利用できる。browserが再提示した場合だけInstall Appが戻る |
| AND-10 | 更新 | 新版配信後、`Update available`で`Later`、次回は`Restart to update`を選ぶ | Laterで即reloadせず、明示更新後だけ新版になる。保存済みノートは不変 |

## 5. iPhone Safari

| ID | 系統 | 前提／操作 | 期待結果・検証意図 |
| --- | --- | --- | --- |
| IOS-01 | 正常 | SafariでURLを開き、`iPhone online note`を保存する | 保存済み表示となる |
| IOS-02 | UI | Application menuの`Install Help`を開き、Escape相当の閉じる操作も確認する | Add to Home Screen手順が表示され、閉じた後にmenu triggerへ戻れる |
| IOS-03 | 正常 | 共有→`Add to Home Screen`→`Open as Web App`→`Add`を実行する | app名とA案iconでホーム画面へ追加される |
| IOS-04 | UI | ホーム画面から起動し、portrait／landscapeとsafe areaを確認する | standalone表示となり、notch／home indicatorとstatus・buttonが重ならない |
| IOS-05 | 状態遷移 | `iPhone installed note`を保存し、app switcherからSafariとPWAを終了する | install前後の2件が保存される |
| IOS-06 | 境界 | 機内モードにし、ホーム画面から新規起動する | app shell、Offline表示、保存済み2件が確認できる |
| IOS-07 | 正常 | offlineで本文変更、保存、Previewを実施する | ローカル機能が継続し、画面が白画面にならない |
| IOS-08 | 異常 | offlineでGitHub／Cloud操作を確認する | cached成功や自動再試行をせず、ノート操作は継続する |
| IOS-09 | 状態遷移 | onlineへ戻して再起動する | offline保存内容を維持し、cloud actionを自動開始しない |
| IOS-10 | 更新 | 新版配信後にLaterと明示更新を分けて確認する | dirty draftを無断破棄せず、保存成功後だけ更新する |

## 6. アンインストール／site data境界

この確認は端末差が大きく、データ消失を伴うため、必ずJSON backup取得後に最後に実施する。

1. PWAをアンインストールし、Safari／Chromeのsite dataを消去していない状態でWebを開く。
2. ノート保持の有無を記録する。保持を製品保証とは扱わない。
3. site dataを明示的に消去し、ノートが消えることを確認する。
4. JSON backupから復元し、復旧手段が機能することを確認する。

## 7. 証跡テンプレート

```text
実施日時:
端末名:
OS version:
browser / version:
対象Origin:
install前の既存PWA / site data:
VPN・Private Relay・省電力設定:

Case ID:
結果: Pass / Fail / Blocked
実施回数 / 再現回数:
最後に成功した手順:
実際の表示・動作:
期待結果との差:
online / offline切替方法と時点:
スクリーンショットまたは画面録画:
回避策:
```

## 8. 失敗時の分類と優先度

| 優先度 | 例 | 初動 |
| --- | --- | --- |
| 致命 | ノート消失、dirty強制reload、認証response再利用 | 以降の実施を止め、backupと再現情報を保全する |
| 重大 | install不能、offline起動不能、白画面、更新loop | 同一条件で1回だけ再現確認し、端末／worker状態を記録する |
| 軽微 | icon余白、copy差、非主要向きの配置差 | screenshot、向き、表示倍率を記録して継続可否を判断する |

不具合は`テスト観点不足`、`データ問題`、`環境問題`、`実装問題`に分類し、「なぜ検出できたか／なぜ自動検証で検出できなかったか」と再発防止テスト候補を残す。
