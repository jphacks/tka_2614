import './style.css'
import { IMAGES, STATUS_LABELS, MESSAGES, ROCKET_IMAGES } from './config.js'
import { DAY, getJstDayStart, getJstDateKey, getStudyMsForDay, getDisplayStatus } from './timer.js'
import { ensureSignedIn } from './firebase.js'
import { createRoom, joinRoom, watchRoom, updateGoal } from './room.js'
import { startStudying, stopStudying, watchMembers, watchSessions, watchDay, lockDayGoal, fetchDayData } from './sync.js'

//時間の単位
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

//アプリの状態（すべてここにまとめる）
const ROOM_KEY = 'duo-pomodoro-room' // 参加中のルームコードを覚えておく場所
const LAST_ROOM_KEY = 'duo-pomodoro-last-room' // 前に入っていたルーム（離れた後も残す）
let currentUser = null               // ログイン中のユーザー（この端末）
let currentRoomCode = null           // 今いるルームのコード
let partnerId = null                 // 相手のID
let myName = ''                      // 自分の名前
let partnerName = ''                 // 相手の名前
let roomGoalMs = 4 * HOUR            // ルームに設定されている目標
let todayGoalMs = null               // 今日固定された目標（days/今日）。まだ無ければ null
let todayKey = null                  // 同期している日付（例：2026-10-17）
let members = {}                     // 2人の今の状態 { ID: { status, startedAt } }
let sessions = []                    // 勉強した区間の一覧 [{ uid, start, end }, ...]
let timerBusy = false                // ボタン操作の通信中かどうか
let stopWatchingRoom = null          // ルームの見張りをやめる関数
let stopSyncFns = []                 // 同期の見張りをやめる関数たち
let syncingCode = null               // 同期中のルームコード
let roomCreatedAt = 0                // ルームが作られた時刻
let lockRequestedFor = null          // 目標の固定を頼んだ日付（同じ処理の重複を防ぐ）
let resultCheckedFor = null          // 前日の結果を確認した「ルーム-日付」（重複を防ぐ）
let isOwner = false                  // 自分がルームの作成者かどうか
let currentScreen = 'loading'        // 今表示している画面
let introReturnTo = null             // 「？」から紹介を開いたときの戻り先
let introStartLabel = 'はじめる'      // 紹介画面のボタンの文字


//今日の目標：固定されていればそれを、まだならルームの目標を使う
function getGoalMs() {
  return todayGoalMs ?? roomGoalMs
}

// 数字を2桁にそろえる
function pad(number) {
  return String(number).padStart(2, '0')
}

// ミリ秒を「時:分」に変える
function formatHM(ms) {
  const totalMinutes = Math.floor(ms / MINUTE)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}:${pad(minutes)}`
}

//ミリ秒を「時:分:秒」に変える
function formatHMS(ms) {
  const totalSeconds = Math.floor(ms / SECOND)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${pad(minutes)}:${pad(seconds)}`
}

//左右のバーの長さ（%）を計算する
function calcBarPercents(myMs, partnerMs, goal) {
  const totalMs = myMs + partnerMs
  if (totalMs >= goal) {
    const mePercent = totalMs > 0 ? (myMs / totalMs) * 100 : 50
    return { me: mePercent, partner: 100 - mePercent }
  }
  return {
    me: (myMs / goal) * 100,
    partner: (partnerMs / goal) * 100,
  }
}

// 1人分の勉強スペース（状態の文字と画像）を描く
// achieved が true なら、画像だけ「達成」に切り替える（状態の文字はそのまま）
function renderSpace(who, status, achieved) {
  document.getElementById(`space-${who}`).dataset.status = status
  document.getElementById(`status-${who}`).textContent = STATUS_LABELS[status]

  const imageKey = achieved ? 'achieved' : status
  const label = achieved ? '目標達成' : STATUS_LABELS[status]
  const src = IMAGES[imageKey]
  document.getElementById(`placeholder-${who}`).textContent = `${label}の画像\npublic${src}`

  const img = document.getElementById(`img-${who}`)
  if (img.getAttribute('src') !== src) {
    img.setAttribute('src', src)
  }
}

//今の状態で押せるボタンだけを有効にする（通信中はすべて押せない）
function renderButtons(status) {
  document.getElementById('btn-start').disabled = timerBusy || status !== 'idle'
  document.getElementById('btn-pause').disabled = timerBusy || status !== 'studying'
  document.getElementById('btn-resume').disabled = timerBusy || status !== 'break'
}

//結果画面を表示する（達成・未達成で共通）
// rows: [['ラベル', '値'], ...] の形で、表示する数字の一覧
function showResult({ type, title, message, rows }) {
  const img = document.getElementById('result-img')
  img.hidden = false
  img.src = IMAGES[type]
  document.getElementById('result-title').textContent = title
  document.getElementById('result-message').textContent = message

  const stats = document.getElementById('result-stats')
  stats.innerHTML = '' // 前回の表示を消す
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = label
    dd.textContent = value
    row.append(dt, dd)
    stats.append(row)
  }

  document.getElementById('result-overlay').hidden = false
}

//達成したら、お祝い画面を出す（1日1回だけ）
function maybeCelebrate(myStudyMs, partnerStudyMs, totalMs, goal) {
  const key = `duo-pomodoro-celebrated-${currentRoomCode}-${todayKey}`
  if (localStorage.getItem(key)) return // 今日はもう表示した
  localStorage.setItem(key, 'yes')

  showResult({
    type: 'achieved',
    title: 'ミッション達成！',
    message: MESSAGES.achieved,
    rows: [
      ['2人の合計', formatHMS(totalMs)],
      ['目標', formatHMS(goal)],
      [myName, formatHMS(myStudyMs)],
      [partnerName, formatHMS(partnerStudyMs)],
    ],
  })
}

// ===== データをもとに画面全体を描き直す =====
function render() {
  if (!currentUser) return

  const now = Date.now()
  const dayStart = getJstDayStart(now)

  //開いたまま日付が変わったら、新しい日のデータで同期し直し、前日の結果を確認する
  if (currentRoomCode && todayKey && getJstDateKey(now) !== todayKey) {
    const code = currentRoomCode
    stopSync()
    startSync(code)
    checkYesterdayOnce()
    return // 新しい日のデータが届いたら、見張りが render を呼び直す
  }

  // 自分と相手、それぞれの「今日の勉強時間」と「状態」を計算
  const myMember = members[currentUser.uid]
  const partnerMember = partnerId ? members[partnerId] : undefined
  const mySessions = sessions.filter((s) => s.uid === currentUser.uid)
  const partnerSessions = sessions.filter((s) => s.uid === partnerId)

  const myStudyMs = getStudyMsForDay(myMember, mySessions, dayStart, now)
  const partnerStudyMs = getStudyMsForDay(partnerMember, partnerSessions, dayStart, now)
  const myStatus = getDisplayStatus(myMember, myStudyMs)
  const partnerStatus = getDisplayStatus(partnerMember, partnerStudyMs)

  //達成判定：2人の合計で判定する
  const goal = getGoalMs()
  const totalMs = myStudyMs + partnerStudyMs
  const remainingMs = Math.max(goal - totalMs, 0)
  const achieved = totalMs >= goal

  // 上部の数字
  document.getElementById('goal-text').textContent = formatHM(goal)
  document.getElementById('total-text').textContent = formatHM(totalMs)
  document.getElementById('remaining-text').textContent = formatHM(remainingMs)
  document.getElementById('achieved-badge').hidden = !achieved // 
  renderGoalEdit() //目標変更の表示

  // 進捗バー
  const percents = calcBarPercents(myStudyMs, partnerStudyMs, goal)
  document.getElementById('progress-me').style.width = `${percents.me}%`
  document.getElementById('progress-partner').style.width = `${percents.partner}%`
  document.querySelector('.progress-bar').classList.toggle('achieved', achieved) //

  // 各自の時間・状態・画像
  document.getElementById('time-me').textContent = formatHMS(myStudyMs)
  document.getElementById('time-partner').textContent = formatHMS(partnerStudyMs)
  renderSpace('me', myStatus, achieved)           // 
  renderSpace('partner', partnerStatus, achieved) // 
  renderButtons(myStatus)

  //2人そろっているルームで達成したら、お祝い画面
  if (achieved && partnerId && todayKey) {
    maybeCelebrate(myStudyMs, partnerStudyMs, totalMs, goal)
  }
}

// ===== 画像が読み込めたか・失敗したかで、表示を切り替える =====
for (const who of ['me', 'partner']) {
  const img = document.getElementById(`img-${who}`)
  img.addEventListener('load', () => img.parentElement.classList.add('has-image'))
  img.addEventListener('error', () => img.parentElement.classList.remove('has-image'))
}

//ロケット画像：読み込めたら画像、無ければ絵文字のまま
for (const who of ['me', 'partner']) {
  const img = document.getElementById(`rocket-img-${who}`)
  img.addEventListener('load', () => img.parentElement.classList.add('has-image'))
  img.addEventListener('error', () => img.parentElement.classList.remove('has-image'))
  img.src = ROCKET_IMAGES[who]
}

// ★ 紹介画面の画像（config.js の達成の画像を使う。無ければ隠す）
const introImg = document.getElementById('intro-img')
introImg.addEventListener('error', () => {
  introImg.hidden = true
})
introImg.src = IMAGES.achieved

//結果画面の画像が無いときは、画像の枠ごと隠す
document.getElementById('result-img').addEventListener('error', (event) => {
  event.target.hidden = true
})

//結果画面の「閉じる」ボタン
document.getElementById('btn-result-close').addEventListener('click', () => {
  document.getElementById('result-overlay').hidden = true
})

//目標変更の表示を更新する
function renderGoalEdit() {
  // 今日の目標が固定済みで、ルームの目標と違うなら「明日からの目標」を表示（2人とも見える）
  const nextGoalText =
    todayGoalMs !== null && roomGoalMs !== todayGoalMs
      ? `明日からの目標：${formatHM(roomGoalMs)}`
      : ''
  document.getElementById('goal-next').textContent = nextGoalText
  document.getElementById('goal-next').hidden = !nextGoalText

  // 変更ボタンは作成者だけ。作成者でも、表示する内容が無い相手側は枠ごと隠す
  document.getElementById('btn-goal-open').hidden = !isOwner
  document.getElementById('goal-edit').hidden = !isOwner && !nextGoalText

  // フォームの説明文：今日から変わるのか、明日からなのか
  document.getElementById('goal-form-note').textContent =
    todayGoalMs === null
      ? '今日の目標から変わります'
      : '今日はすでに勉強が始まっているため、明日から反映されます'
}

// 「目標を変更」ボタン：今のルームの目標を入力欄に入れてフォームを開く
document.getElementById('btn-goal-open').addEventListener('click', () => {
  document.getElementById('edit-goal-hours').value = Math.floor(roomGoalMs / HOUR)
  document.getElementById('edit-goal-minutes').value = Math.floor((roomGoalMs % HOUR) / MINUTE)
  document.getElementById('goal-form').hidden = false
  document.getElementById('btn-goal-open').disabled = true
})

//「やめる」ボタン
function closeGoalForm() {
  document.getElementById('goal-form').hidden = true
  document.getElementById('btn-goal-open').disabled = false
}
document.getElementById('btn-goal-cancel').addEventListener('click', closeGoalForm)

// 「保存」ボタン
document.getElementById('btn-goal-save').addEventListener('click', async () => {
  const hours = Number(document.getElementById('edit-goal-hours').value)
  const minutes = Number(document.getElementById('edit-goal-minutes').value)
  const goal = Math.round(hours * HOUR + minutes * MINUTE)
  if (!(goal > 0 && goal <= 24 * HOUR)) {
    alert('目標は1分〜24時間の間で設定してください')
    return
  }

  const saveButton = document.getElementById('btn-goal-save')
  saveButton.disabled = true
  try {
    await updateGoal(currentRoomCode, goal)
    closeGoalForm()
  } catch (error) {
    console.error(error)
    alert('目標を変更できませんでした')
  } finally {
    saveButton.disabled = false
  }
})

//タイマーのボタン操作（Firestoreに書き込む）
async function runTimerAction(action) {
  if (timerBusy || !currentRoomCode) return
  timerBusy = true
  render()
    try {
    const result = await action(currentRoomCode, currentUser.uid)

    // 書き込みが成功したら、サーバーからの知らせを待たずに、自分の画面をすぐ更新する
    if (result) {
      members = { ...members, [currentUser.uid]: result.member }
      // 記録した区間も、まだ一覧に無ければ加える（同じ区間を2回足さないように確認）
      const s = result.session
      if (s && !sessions.some((x) => x.uid === s.uid && x.start === s.start)) {
        sessions = [...sessions, s]
      }
    }
  } catch (error) {
    console.error(error)
    alert('操作に失敗しました。通信状態を確認して、もう一度押してください')
  } finally {
    timerBusy = false
    render()
  }
}

document.getElementById('btn-start').addEventListener('click', () => runTimerAction(startStudying))
document.getElementById('btn-pause').addEventListener('click', () => runTimerAction(stopStudying))
document.getElementById('btn-resume').addEventListener('click', () => runTimerAction(startStudying))

// 1秒ごとに表示を更新する
setInterval(render, SECOND)
document.addEventListener('visibilitychange', render)
// アプリ（タブ）に戻ってきたとき：表示を更新し、5秒以上離れていたら同期をつなぎ直す
let hiddenAt = null
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now() // 裏に回った時刻を覚えておく
    return
  }
  if (hiddenAt && Date.now() - hiddenAt > 5 * SECOND) {
    restartSync()
  }
  hiddenAt = null
  render()
})

// 通信が切れて、また戻ったとき（電波が悪い場所など）も、つなぎ直す
window.addEventListener('online', restartSync)

// Safariで「戻る」ボタンなどからページに戻ったときも、つなぎ直す
window.addEventListener('pageshow', (event) => {
  if (event.persisted) restartSync()
})

// 2人の状態の同期
function stopSync() {
  for (const stop of stopSyncFns) stop()
  stopSyncFns = []
  syncingCode = null
  members = {}
  sessions = []
  todayGoalMs = null // 
  todayKey = null    // 
}

function startSync(code) {
  if (syncingCode === code) return
  stopSync()
  syncingCode = code

  const now = Date.now()
  todayKey = getJstDateKey(now)

  stopSyncFns.push(
    watchMembers(code, (newMembers) => {
      members = newMembers
      maybeLockTodayGoal() // 
      render()
    })
  )
  stopSyncFns.push(
    watchSessions(code, getJstDayStart(now), (newSessions) => {
      sessions = newSessions
      render()
    })
  )
  stopSyncFns.push(
    watchDay(code, todayKey, (day) => {
      todayGoalMs = day ? day.goalMs : null
      maybeLockTodayGoal() // 
      render()
    })
  )
}

// 同期をつなぎ直す（スマホでアプリに戻ってきたときなど）
function restartSync() {
  if (!currentRoomCode) return
  const code = currentRoomCode

  // つなぎ直しの間に表示が0に戻らないよう、手元のデータを残しておく
  const keep = { members, sessions, todayGoalMs }
  stopSync()
  startSync(code)
  members = keep.members
  sessions = keep.sessions
  todayGoalMs = keep.todayGoalMs
  render()
  // この後、サーバーから最新の状態が届くと、見張りが自動で上書きする
}

//誰かが勉強中なのに今日の目標が未固定なら、固定する（0時をまたいだ場合など）
function maybeLockTodayGoal() {
  if (!currentRoomCode || !todayKey || todayGoalMs !== null) return
  if (lockRequestedFor === todayKey) return // すでに頼んである

  const someoneStudying = Object.values(members).some((m) => m.status === 'studying')
  if (!someoneStudying) return

  lockRequestedFor = todayKey
  lockDayGoal(currentRoomCode, todayKey).catch((error) =>
    console.error('今日の目標を固定できませんでした', error)
  )
}

//"2026-10-17" → "10月17日"
function formatDateLabel(dateKey) {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}月${Number(day)}日`
}

// ある日の結果を確認して、未達成なら結果画面を出す
// force が true なら「表示済み」の記録を無視する（テスト用）
async function checkDayResult(code, dayStart, force = false) {
  const dateKey = getJstDateKey(dayStart)
  const seenKey = `duo-pomodoro-result-${code}-${dateKey}`
  if (!force && localStorage.getItem(seenKey)) return // この日の結果はもう見た
  if (dayStart + DAY <= roomCreatedAt) return          // ルームを作る前の日は対象外

  const data = await fetchDayData(code, dateKey, dayStart)
  const now = Date.now()

  // 2人それぞれの、その日の勉強時間を合計する
  let totalMs = 0
  for (const uid of [currentUser.uid, partnerId]) {
    const userSessions = data.sessions.filter((s) => s.uid === uid)
    totalMs += getStudyMsForDay(data.members[uid], userSessions, dayStart, now)
  }
  const goal = data.day ? data.day.goalMs : roomGoalMs

  localStorage.setItem(seenKey, 'yes')

  if (totalMs >= goal) {
    console.log(`${formatDateLabel(dateKey)}は達成しています（合計 ${formatHMS(totalMs)}）`)
    return
  }

  showResult({
    type: 'failed',
    title: `${formatDateLabel(dateKey)}は目標に届きませんでした`,
    message: MESSAGES.failed,
    rows: [
      ['2人の合計', formatHMS(totalMs)],
      ['目標', formatHMS(goal)],
      ['足りなかった時間', formatHMS(goal - totalMs)],
      ['日付', formatDateLabel(dateKey)],
    ],
  })
}

//前日の結果の確認を、ルームと日付の組み合わせごとに1回だけ行う
function checkYesterdayOnce() {
  if (!currentRoomCode || !partnerId || !todayKey) return
  const key = `${currentRoomCode}-${todayKey}`
  if (resultCheckedFor === key) return
  resultCheckedFor = key

  const yesterdayStart = getJstDayStart(Date.now()) - DAY
  checkDayResult(currentRoomCode, yesterdayStart).catch((error) =>
    console.error('前日の結果を確認できませんでした', error)
  )
}

// ルームと画面の切り替え
 function showScreen(name) {
  currentScreen = name
  for (const id of ['screen-loading', 'screen-intro', 'screen-entry', 'screen-waiting', 'screen-main']) {
    document.getElementById(id).hidden = id !== `screen-${name}`
  }
  // 「？」ボタンは、読み込み中と紹介画面では隠す
  document.getElementById('btn-info').hidden = name === 'loading' || name === 'intro'
  // 入口画面を出すときは、「前に入っていたルーム」の表示を更新する
  if (name === 'entry') {
    renderLastRoom()
  } else {
    document.getElementById('last-room').hidden = true
  }
}

//前に入っていたルーム」を、覚えているときだけ表示する
function renderLastRoom() {
  const code = localStorage.getItem(LAST_ROOM_KEY)
  document.getElementById('last-room').hidden = !code
  if (code) {
    document.getElementById('last-room-code').textContent = code
  }
}

// ルームの画面（待機・メイン）を出す
// 「？」から紹介を読んでいる途中なら、画面は切り替えずに、戻り先だけ更新する
function showRoomScreen(name) {
  if (currentScreen === 'intro' && introReturnTo) {
    introReturnTo = name
    return
  }
  showScreen(name)
}

function showMessage(text) {
  document.getElementById('entry-message').textContent = text
}

function backToEntry(message) {
  if (stopWatchingRoom) stopWatchingRoom()
  stopWatchingRoom = null
  stopSync()
  currentRoomCode = null
  partnerId = null
  localStorage.removeItem(ROOM_KEY)
  showScreen('entry')
  showMessage(message)
}

function enterRoom(code) {
  localStorage.setItem(ROOM_KEY, code)
  // アドレス欄の ?room=○○ を消す（ページの再読み込みはしない）
  history.replaceState(null, '', location.pathname)
  if (stopWatchingRoom) stopWatchingRoom()

  stopWatchingRoom = watchRoom(
    code,
    (room) => {
            if (!room || !room.memberIds.includes(currentUser.uid)) {
        // もう戻れないルームなので、「前に入っていたルーム」からも消す
        if (localStorage.getItem(LAST_ROOM_KEY) === code) {
          localStorage.removeItem(LAST_ROOM_KEY)
        }
        backToEntry('前回のルームに戻れませんでした')
        return
      }

      currentRoomCode = code
      localStorage.setItem(LAST_ROOM_KEY, code) // 前に入っていたルームとして覚える
      roomGoalMs = room.goalMs // 
      roomCreatedAt = room.createdAt ? room.createdAt.toMillis() : Date.now()
      isOwner = room.ownerUid === currentUser.uid
      startSync(code)
      myName = room.memberNames[currentUser.uid] // 
      document.getElementById('name-me').textContent = myName

      partnerId = room.memberIds.find((id) => id !== currentUser.uid) ?? null
      if (!partnerId) {
        document.getElementById('waiting-code').textContent = code
        document.getElementById('invite-url').value = `${location.origin}/?room=${code}&openExternalBrowser=1`
        
        showRoomScreen('waiting')
        return
      }

      partnerName = room.memberNames[partnerId] // 
      document.getElementById('name-partner').textContent = partnerName
      document.getElementById('room-code-main').textContent = code
      showRoomScreen('main')
      render()
      checkYesterdayOnce() //  前日が未達成なら結果画面を出す
    },
    (error) => {
      console.error(error)
      backToEntry('ルームを読み込めませんでした')
    }
  )
}

function readName() {
  const name = document.getElementById('input-name').value.trim()
  if (!name) {
    showMessage('名前を入力してください')
    return null
  }
  return name
}

function setEntryBusy(busy) {
  document.getElementById('btn-create').disabled = busy
  document.getElementById('btn-join').disabled = busy
}

document.getElementById('btn-create').addEventListener('click', async () => {
  const name = readName()
  if (!name) return

  const hours = Number(document.getElementById('input-goal-hours').value)
  const minutes = Number(document.getElementById('input-goal-minutes').value)
  const goal = Math.round(hours * HOUR + minutes * MINUTE)
  if (!(goal > 0 && goal <= 24 * HOUR)) {
    showMessage('目標は1分〜24時間の間で設定してください')
    return
  }

  setEntryBusy(true)
  showMessage('ルームを作っています…')
  try {
    const code = await createRoom(currentUser.uid, name, goal)
    showMessage('')
    enterRoom(code)
  } catch (error) {
    console.error(error)
    showMessage(`作成できませんでした：${error.message}`)
  } finally {
    setEntryBusy(false)
  }
})

document.getElementById('btn-join').addEventListener('click', async () => {
  const name = readName()
  if (!name) return

  const code = document.getElementById('input-code').value.trim().toUpperCase()
  if (code.length !== 6) {
    showMessage('ルームコードは6文字です')
    return
  }

  setEntryBusy(true)
  showMessage('参加しています…')
  try {
    await joinRoom(currentUser.uid, code, name)
    showMessage('')
    enterRoom(code)
  } catch (error) {
    console.error(error)
    showMessage(`参加できませんでした：${error.message}`)
  } finally {
    setEntryBusy(false)
  }
})

document.getElementById('btn-copy').addEventListener('click', async () => {
  const url = document.getElementById('invite-url').value
  await navigator.clipboard.writeText(url)
  document.getElementById('btn-copy').textContent = 'コピーしました！'
})

//「このルームに戻る」ボタン（すでにメンバーなので、名前の入力はいらない）
document.getElementById('btn-last-room').addEventListener('click', () => {
  const code = localStorage.getItem(LAST_ROOM_KEY)
  if (!code) return
  showMessage('ルームに戻っています…')
  enterRoom(code)
})

//「？」ボタン → 紹介画面を開く（どの画面から開いたかを覚えておく）
document.getElementById('btn-info').addEventListener('click', () => {
  introReturnTo = currentScreen
  document.getElementById('btn-intro-start').textContent = '戻る'
  showScreen('intro')
  window.scrollTo(0, 0)
})

//紹介画面のボタン
//「？」から開いたとき → 元の画面に戻る
//最初に開いたとき→ 入口画面へ
document.getElementById('btn-intro-start').addEventListener('click', () => {
  const next = introReturnTo ?? 'entry'
  introReturnTo = null
  document.getElementById('btn-intro-start').textContent = introStartLabel // 文字を元に戻す
  showScreen(next)
  window.scrollTo(0, 0)
})


//「この端末でルームを離れる」ボタン
document.getElementById('btn-leave').addEventListener('click', async () => {
  const code = currentRoomCode
  const ok = confirm(
    `ルーム ${code} を離れて、最初の画面に戻りますか？\n` +
      '（勉強中の場合は休憩にしてから離れます。記録は消えず、コードを入れればいつでも戻れます）'
  )
  if (!ok) return

  // 勉強中なら、先に休憩にする（離れた後に時間が増え続けないように）
  const myMember = members[currentUser.uid]
  if (myMember && myMember.status === 'studying') {
    try {
      await stopStudying(code, currentUser.uid)
    } catch (error) {
      console.error(error)
      alert('休憩にできなかったため、離れるのを中止しました。通信状態を確認してください')
      return
    }
  }

  // 開いていたフォームや結果画面を閉じてから、入口画面へ
  document.getElementById('result-overlay').hidden = true
  closeGoalForm()
  backToEntry(`ルーム ${code} を離れました。コードを入れれば、いつでも戻れます`)
})

async function start() {
  //LINEの中のブラウザで開かれたら、Safariなどの普段のブラウザで開き直す
  //    （LINEの中で参加すると、後でSafariから同じルームに戻れなくなるため）
  const params = new URLSearchParams(location.search)
  if (/ Line\//i.test(navigator.userAgent) && params.get('openExternalBrowser') !== '1') {
    params.set('openExternalBrowser', '1')
    location.replace(`${location.pathname}?${params}`)
    return
  }

  //招待URL（?room=コード）から開いたら、コード欄に入れておく
  const codeFromUrl = params.get('room')
  const invitedCode = codeFromUrl ? codeFromUrl.toUpperCase() : null
  if (invitedCode) {
    document.getElementById('input-code').value = invitedCode
  }

  //匿名ログイン
  try {
    currentUser = await ensureSignedIn()
  } catch (error) {
    console.error(error)
    document.getElementById('screen-loading').textContent =
      'ログインできませんでした。再読み込みしてください'
    return
  }

  //どの画面から始めるかを決める
  const savedCode = localStorage.getItem(ROOM_KEY)
  if (savedCode && (!invitedCode || invitedCode === savedCode)) {
    // 招待URLが無い、または覚えているルームと同じ → そのルームに戻る
    enterRoom(savedCode)
    } else if (!invitedCode && localStorage.getItem(LAST_ROOM_KEY)) {
    // ★ 前にルームに入ったことがある人 → 紹介を飛ばして入口画面へ（前のルームにすぐ戻れる）
      showScreen('entry')
    } else {
    // 初めて、または別のルームに招待された → まず紹介画面を出す
      showScreen('intro')
    if (invitedCode) {
      // 入口画面に出す案内を先に準備して、紹介画面のボタンの文字も変える
      showMessage(`ルーム ${invitedCode} に招待されています。名前を入れて「参加する」を押してください`)
      introStartLabel = '招待されたルームに参加する'
      document.getElementById('btn-intro-start').textContent = introStartLabel
    }
  }
}
//開発中だけ使えるテスト用の命令（公開版では無効になる）
// コンソールで debugCheckToday() と打つと、「今日がもう終わった」とみなして結果を判定する
if (import.meta.env.DEV) {
  window.debugCheckToday = () => checkDayResult(currentRoomCode, getJstDayStart(Date.now()), true)
}

start()