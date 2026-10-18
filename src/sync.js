// 勉強の開始・休憩の書き込みと、2人の状態の見張り
import { doc, collection, query, where, onSnapshot, runTransaction, getDoc, getDocs } from 'firebase/firestore'
import { db } from './firebase.js'
import { getJstDateKey } from './timer.js'

// 勉強開始・再開
// 成功したら、自分の新しい状態を返す（画面をすぐ更新するため）。何もしなかったら null
export async function startStudying(code, uid) {
  const now = Date.now()
  const roomRef = doc(db, 'rooms', code)
  const memberRef = doc(db, 'rooms', code, 'members', uid)
  const dayRef = doc(db, 'rooms', code, 'days', getJstDateKey(now))

  return runTransaction(db, async (tx) => {
    //必要な3つのデータを「同時に」読む（順番に読むより速い）
    const [memberSnap, daySnap, roomSnap] = await Promise.all([
      tx.get(memberRef),
      tx.get(dayRef),
      tx.get(roomRef),
    ])

    //すでに勉強中なら何もしない（二重起動の防止）
    if (memberSnap.exists() && memberSnap.data().status === 'studying') return null

    //今日最初の勉強なら、今日の目標を固定する（目標のロック）
    if (!daySnap.exists()) {
      tx.set(dayRef, { goalMs: roomSnap.data().goalMs })
    }

    //自分の状態を「勉強中」にする
    const member = { status: 'studying', startedAt: now }
    tx.set(memberRef, member)
    return { member }
  })
}

// 休憩（勉強を止める）
// 成功したら、自分の新しい状態と記録した区間を返す。何もしなかったら null
export async function stopStudying(code, uid) {
  const memberRef = doc(db, 'rooms', code, 'members', uid)

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(memberRef)

    // 勉強中でなければ何もしない（休憩中の時間加算・二重記録の防止）
    if (!snap.exists() || snap.data().status !== 'studying') return null

    const startedAt = snap.data().startedAt
    const end = Math.max(Date.now(), startedAt + 1) // 終了は必ず開始より後

    // 勉強した区間を1件記録（名前は「ID_開始時刻」→ 同じ区間は二度と記録できない）
    const session = { uid, start: startedAt, end }
    tx.set(doc(db, 'rooms', code, 'sessions', `${uid}_${startedAt}`), session)

    // 自分の状態を「休憩中」にする
    const member = { status: 'break', startedAt: null }
    tx.set(memberRef, member)
    return { member, session }
  })
}

// 2人の今の状態を見張る
export function watchMembers(code, onChange) {
  return onSnapshot(
    collection(db, 'rooms', code, 'members'),
    (snap) => {
      const members = {}
      snap.forEach((d) => {
        members[d.id] = d.data()
      })
      onChange(members)
    },
    (error) => console.error('メンバーの見張りでエラー', error)
  )
}

// 指定した時刻以降に終わった勉強区間を見張る
export function watchSessions(code, sinceMs, onChange) {
  const q = query(collection(db, 'rooms', code, 'sessions'), where('end', '>=', sinceMs))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (error) => console.error('勉強記録の見張りでエラー', error)
  )
}

// 指定した日の目標（days/日付）を見張る
export function watchDay(code, dateKey, onChange) {
  return onSnapshot(
    doc(db, 'rooms', code, 'days', dateKey),
    (snap) => onChange(snap.exists() ? snap.data() : null),
    (error) => console.error('日ごとの目標の見張りでエラー', error)
  )
}


// その日の目標がまだ固定されていなければ、固定する（0時をまたいで勉強中のときなど）
export async function lockDayGoal(code, dateKey) {
  const roomRef = doc(db, 'rooms', code)
  const dayRef = doc(db, 'rooms', code, 'days', dateKey)

  await runTransaction(db, async (tx) => {
    const daySnap = await tx.get(dayRef)
    const roomSnap = await tx.get(roomRef)
    if (daySnap.exists()) return // すでに固定済み
    tx.set(dayRef, { goalMs: roomSnap.data().goalMs })
  })
}

// ある日の結果を計算するためのデータを、1回だけまとめて読み込む
export async function fetchDayData(code, dateKey, dayStart) {
  const [daySnap, membersSnap, sessionsSnap] = await Promise.all([
    getDoc(doc(db, 'rooms', code, 'days', dateKey)),
    getDocs(collection(db, 'rooms', code, 'members')),
    getDocs(query(collection(db, 'rooms', code, 'sessions'), where('end', '>=', dayStart))),
  ])

  const members = {}
  membersSnap.forEach((d) => {
    members[d.id] = d.data()
  })

  return {
    day: daySnap.exists() ? daySnap.data() : null,
    members,
    sessions: sessionsSnap.docs.map((d) => d.data()),
  }
}