// 画像の設定
// 画像ファイルは「public/images/」フォルダ
export const IMAGES = {
  idle: '/images/break.gif',            // 未開始
  studying: '/images/studying.gif',    // 勉強中
  break: '/images/break.gif',          // 休憩中
  achieved: '/images/achieved.png',    // 目標達成
  failed: '/images/failed.png',        // 目標未達成
}

// 状態の表示名
export const STATUS_LABELS = {
  idle: '未開始',
  studying: '勉強中',
  break: '休憩中',
}


// 結果画面のメッセージ
export const MESSAGES = {
  achieved: '達成！',
  failed: '失敗',
}

// ロケット（進捗バーの先頭）
// 右向きの画像。相手側は左右反転
export const ROCKET_IMAGES = {
  me: '/images/rocket.png',
  partner: '/images/rocket.png',
}