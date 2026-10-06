// 自動テストでは、学科の設定を配信の窓口（Apps Script）から読み込まず、決まった設定（config-fixture.json）を返す。
// 窓口の返事の速さに左右されず、テストのたびに窓口を呼ばないようにするため。
// config-fixture.json は、公開中の設定の写し（コースを足すなどしたら取り直す）
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))

export async function stubConfig(page) {
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (/script\.google(usercontent)?\.com/.test(request.url())) {
      return request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: true, year: config.fiscalYear, config }),
      })
    }
    return request.continue()
  })
}
