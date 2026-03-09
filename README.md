# 📘 学習記録ログ（Learning Log）

**local-first × 手動クラウド同期** を採用した、  
個人向けの学習・調査メモ管理 Web アプリです。

Google ログインでユーザーを識別し、  
**普段はローカル保存、必要なときだけ Firebase（Cloud Firestore）に同期**できます。

---

## ✨ 特徴

- ✅ **local-first 設計**
  - 編集・追加は常に `localStorage`
  - オフラインでも完全に利用可能
- ✅ **手動クラウド同期**
  - 任意のタイミングで Firestore に同期
  - 意図しない通信・書き込みを防止
- ✅ **Google ログイン（Firebase Authentication）**
  - `signInWithPopup` を使用
  - GitHub Pages でも安定動作
- ✅ **UID 単位での安全なデータ管理**
  - 自分のデータのみ read / write 可能
- ✅ **調査・学習向け UI**
  - タイトル / URL / タグ / 要点 / 追記メモ
  - 改行保持、検索、編集、削除対応
- ✅ **データの可搬性**
  - JSON エクスポート / インポート対応

---

## 🧠 設計コンセプト

### local-first + manual sync

```text
localStorage（常時）
     ▲
     │ 編集・保存
     │
[クラウド同期] ボタン
     │
     ▼
Cloud Firestore（任意）
