// ルームの作成・参加・見張り（Firestoreとのやりとり）
import { doc, runTransaction, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase.js'

// ルームコードに使う文字（見間違えやすい I・O・0・1 は除外）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

// ランダムな6文字のコードを作る
function generateCode() {
  const values = crypto.getRandomValues(new Uint32Array(CODE_LENGTH))
  return Array.from(values, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('')
}

// ルームを作る（作ったコードを返す）
export async function createRoom(uid, name, goalMs) {
  for (let i = 0; i < 5; i++) {
    const code = generateCode()
    const ref = doc(db, 'rooms', code)

    const created = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists()) return false // 偶然同じコードがあったら別のコードで作り直す
      tx.set(ref, {
        ownerUid: uid,
        memberIds: [uid],
        memberNames: { [uid]: name },
        goalMs: goalMs,
        createdAt: serverTimestamp(),
      })
      return true
    })

    if (created) return code
  }
  throw new Error('ルームを作れませんでした。もう一度試してください')
}

// コードでルームに参加する
export async function joinRoom(uid, code, name) {
  const ref = doc(db, 'rooms', code)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('そのコードのルームは見つかりませんでした')

    const room = snap.data()
    if (room.memberIds.includes(uid)) return // すでに参加している
    if (room.memberIds.length >= 2) throw new Error('このルームはすでに2人そろっています')

    tx.update(ref, {
      memberIds: [...room.memberIds, uid],
      [`memberNames.${uid}`]: name,
    })
  })
}

// ルームを見張る（内容が変わるたびに onChange が呼ばれる）
export function watchRoom(code, onChange, onError) {
  return onSnapshot(
    doc(db, 'rooms', code),
    (snap) => onChange(snap.exists() ? snap.data() : null),
    onError
  )
}


// ルームの目標を変更する（作成者だけ）
export async function updateGoal(code, goalMs) {
  await updateDoc(doc(db, 'rooms', code), { goalMs })
}