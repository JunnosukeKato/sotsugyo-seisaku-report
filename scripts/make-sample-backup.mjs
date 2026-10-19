// 見本の原稿（衣装コースの架空の学生「文化花子」。scripts/e2e/sampleReport.mjs の setupWriting）を、
// 作成ツールのバックアップファイル（.json）にする。先生が自分のアカウントでツールを開き、
// 「バックアップ・作り直す」→「バックアップファイルから復元」で読み込むと、見本の原稿で操作を試せる。
// 使い方: node scripts/make-sample-backup.mjs [出力先]（開発サーバーが http://localhost:5173 で動いていること）
//   出力先を書かなければ poc-output/見本の原稿_シンドバッド.json。Edge は EDGE_PORT（ふだんは 9461）で起動する
// Google のログインとドライブは偽物（本物の Google にはつながない）。見本の画像は docs/guide-images/sample/ のもの
import { writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9461'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool } = await import('./video/session.mjs')

const OUT = process.argv[2] ?? 'poc-output/見本の原稿_シンドバッド.json'

await withEdge(async (browser) => {
  const { page } = await openTool(browser, { device: 'pc' })
  // 見本の画像は、setupWriting では画面にだけ入り、端末の保存先（IndexedDB）には書かれない。同じ ID で読み直してファイルに入れる
  const result = await page.evaluate(async () => {
    const { createBackup } = await import('/src/model/backup.ts')
    const { usedImageIds } = await import('/src/model/storage.ts')
    const { importImage } = await import('/src/model/images.ts')
    const files = [
      ['g-design', 'design', 1200],
      ['g-mood', 'moodboard', 1200],
      ['g-process', 'process', 1200],
      ['g-photo1', 'photo-1', 1200],
      ['g-satin', 'swatch-satin', 800],
      ['g-chiffon', 'swatch-chiffon', 800],
      ['g-broad', 'swatch-broad', 800],
    ]
    const snap = window.__editor.getSnapshot()
    const used = new Set(usedImageIds(snap.report))
    const images = []
    for (const [id, file, max] of files) if (used.has(id)) images.push(await importImage(await (await fetch(`/docs/guide-images/sample/${file}.jpg`)).blob(), id, max))
    const missing = [...used].filter((id) => !images.some((img) => img.id === id))
    return { text: await createBackup(snap.report, images), findings: snap.findings.map((f) => `${f.severity}:${f.title}`), images: images.length, missing }
  })
  if (result.missing.length) throw new Error(`画像が足りません：${result.missing.join('、')}`)
  writeFileSync(OUT, result.text)
  console.log(`${OUT}（${Math.round(result.text.length / 1024)}KB・画像 ${result.images}枚・指摘 ${result.findings.length}件${result.findings.length ? `：${result.findings.join('、')}` : ''}）`)
})
