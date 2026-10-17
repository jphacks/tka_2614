// =============================================
// 勉強時間の「計算」だけを担当するファイル（セッション方式）
// ---------------------------------------------
// 画面のこともデータベースのことも知らない、純粋な計算係。
// =============================================

export const DAY = 24 * 60 * 60 * 1000
const JST_OFFSET = 9 * 60 * 60 * 1000 // 日本時間は、世界標準時より9時間進んでいる

// 指定した時刻が含まれる日の「日本時間0:00」を返す
export function getJstDayStart(ms) {
  return Math.floor((ms + JST_OFFSET) / DAY) * DAY - JST_OFFSET
}

// 指定した時刻の日付を「2026-10-17」の形で返す（日本時間）
export function getJstDateKey(ms) {
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 10)
}

// 区間 [start, end] のうち、範囲 [from, to] に入っている長さ
function overlap(start, end, from, to) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from))
}

// ある1人の、指定した日の勉強時間を計算する
// member  : { status, startedAt }（今の状態。まだ記録が無ければ undefined）
// sessions: その人の勉強区間の一覧 [{ start, end }, ...]
export function getStudyMsForDay(member, sessions, dayStart, now) {
  const dayEnd = dayStart + DAY
  let total = 0

  // 終わった区間のうち、その日に入っている部分を合計
  for (const s of sessions) {
    total += overlap(s.start, s.end, dayStart, dayEnd)
  }

  // 勉強中なら「開始時刻 〜 今」のうち、その日に入っている部分も足す
  if (member && member.status === 'studying') {
    total += overlap(member.startedAt, now, dayStart, dayEnd)
  }
  return total
}

// 画面に出す状態を決める
// 勉強中でなく、その日まだ1秒も勉強していなければ「未開始」とする
export function getDisplayStatus(member, studyMs) {
  if (member && member.status === 'studying') return 'studying'
  return studyMs > 0 ? 'break' : 'idle'
}