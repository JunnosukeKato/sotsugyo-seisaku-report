import { FROM_ADMIN, FROM_TOOL, isAllowedParentOrigin, NONCE_PATTERN, readInitPayload, type InitPayload, type ToolEnvelope, type ToolMessage } from './protocol'

/**
 * ひな形を作る画面（学生のツールの ?template=1）の、管理ページとの窓口（ツールの側。protocol.ts）。
 * 読み込んですぐ（React の画面を作る前に：main.tsx）聞き始める。管理ページは iframe が読み込めたら init を送るので、取りこぼさないように。
 * 受け取るのは、親の窓が、決まった場所（isAllowedParentOrigin）から送った、形の正しい init だけ。最初の init の場所と合言葉を覚え、
 * そのあとの返事は、その場所へだけ、その合言葉を付けて送る
 */

let parent: { origin: string; nonce: string } | null = null
let received: InitPayload | null = null
const listeners = new Set<(payload: InitPayload) => void>()

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 管理ページへ送る（init を受け取る前は送らない） */
export function sendToAdmin(message: ToolMessage): void {
  if (!parent) return
  const envelope: ToolEnvelope = { ...message, source: FROM_TOOL, nonce: parent.nonce }
  window.parent.postMessage(envelope, parent.origin)
}

/** 受け取った init（まだなら null） */
export function initPayload(): InitPayload | null {
  return received
}

/** init を受け取ったら呼ぶ（もう受け取っていれば、すぐ呼ぶ）。やめる関数を返す */
export function onInit(listener: (payload: InitPayload) => void): () => void {
  if (received) listener(received)
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** iframe の中で開いているか（ひな形を作る画面は、管理ページの中でだけ使う） */
export const inFrame = (): boolean => window.parent !== window

/** 聞き始める（dev：開発中。手元の開発サーバーの管理ページからも受け取る） */
export function startBridge(dev: boolean): void {
  window.addEventListener('message', (e: MessageEvent) => {
    if (!inFrame() || e.source !== window.parent || !isAllowedParentOrigin(e.origin, dev)) return
    const data: unknown = e.data
    if (!isObj(data) || data.source !== FROM_ADMIN || data.type !== 'init' || typeof data.nonce !== 'string' || !NONCE_PATTERN.test(data.nonce)) return
    // 2回目からは、最初と同じ場所・合言葉の init にだけ、受け取ったと返事をする（中身は入れ替えない）
    if (parent) {
      if (parent.origin === e.origin && parent.nonce === data.nonce) sendToAdmin({ type: 'ack' })
      return
    }
    const payload = readInitPayload(data.payload)
    if (!payload) return
    parent = { origin: e.origin, nonce: data.nonce }
    received = payload
    sendToAdmin({ type: 'ack' })
    for (const listener of listeners) listener(payload)
  })
}
