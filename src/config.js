// =============================================
// 画像の設定
// ---------------------------------------------
// 画像ファイルは「public/images/」フォルダに入れてください。
// 差し替えるときは、右側の '...' のファイル名だけを書き換えます。
// （PNG・JPG・GIF のどれでもOK）
// =============================================
export const IMAGES = {
  idle: '/images/idle.png',            // 未開始
  studying: '/images/studying.gif',    // 勉強中
  break: '/images/break.gif',          // 休憩中
  achieved: '/images/achieved.gif',    // 目標達成（STEP 7で使用）
  failed: '/images/failed.png',        // 目標未達成（STEP 7で使用）
}

// 状態の表示名
export const STATUS_LABELS = {
  idle: '未開始',
  studying: '勉強中',
  break: '休憩中',
}


// 結果画面のメッセージ（自由に書き換えてOK）
export const MESSAGES = {
  achieved: '達成！',
  failed: '失敗',
}