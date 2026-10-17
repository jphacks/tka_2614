// =============================================
// Firebase に接続するためのファイル
// =============================================
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// ▼▼▼ Firebaseコンソールに表示された firebaseConfig の中身に置き換える ▼▼▼
const firebaseConfig = {
  apiKey: 'AIzaSyAG8s2TLU3LsLNhq3BA3AMO47VDeOGc6GI',
  authDomain: 'duo-pomodoro.firebaseapp.com',
  projectId: 'duo-pomodoro',
  storageBucket: 'duo-pomodoro.firebasestorage.app',
  messagingSenderId: '661779256741',
  appId: '1:661779256741:web:8690aa0ba7fbb6133a444c',
}
// ▲▲▲ ここまで ▲▲▲

const app = initializeApp(firebaseConfig) // Firebaseに接続する
export const auth = getAuth(app)          // ログイン機能
export const db = getFirestore(app)       // データベース機能

// 匿名ログインして、この端末のユーザー情報を返す
export async function ensureSignedIn() {
  await auth.authStateReady()   // 前回のログイン情報の読み込みが終わるのを待つ
  if (!auth.currentUser) {
    await signInAnonymously(auth) // 初めてのブラウザなら、匿名ログインしてIDをもらう
  }
  return auth.currentUser
}