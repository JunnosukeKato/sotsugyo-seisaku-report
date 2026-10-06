/**
 * 卒業制作報告書 作成ツール：管理ページ（Google Apps Script。スプレッドシートに付属させる）
 *
 * スプレッドシートの3つのシート
 *   年度設定 … 年度 | 状態（公開中・準備中・終了）| 設定（JSON）| 更新日時 | 更新者
 *   変更履歴 … 日時 | 更新者 | 年度 | 操作 | 設定（JSON）（管理者・先生の登録の変更は、年度と設定が空の行）
 *   管理者   … メールアドレス | メモ | 役割（管理者・先生。空なら管理者）
 *
 * ウェブアプリとして公開する（実行するユーザー：自分、アクセス：大学のドメイン内）。
 * 「管理者」シートに載っている人だけが使える。
 *   管理者 … 年度の設定をすべて変更・公開できる。先生を登録できる
 *   先生   … どのコースの「下書きのひな形」も編集できる（ほかの設定は変えられない）
 * 学生のツールへの配信は、別のプロジェクト（gas/api-project）が担う。
 *
 * このファイルは app/gas/admin-project/Code.js が元。scripts/build-gas.mjs で初期値を埋め込んで gas-dist に出力する。
 */

const SHEET_YEARS = '年度設定'
const SHEET_HISTORY = '変更履歴'
const SHEET_ADMINS = '管理者'
const STATUS_PUBLISHED = '公開中'
const STATUS_DRAFT = '準備中'
const STATUS_ENDED = '終了'
const ROLE_ADMIN = '管理者'
const ROLE_TEACHER = '先生'
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/

/** 下書きのひな形の部品の種類 */
const BLOCK_TYPES = ['chapter', 'subheading', 'paragraph', 'figure', 'materialTable']
/** 文字数・数の上限（学生のツールの src/config/validate.ts の LIMITS と同じ値にする） */
const LIMITS = { blocks: 100, name: 100, hint: 300, abstractExample: 500, notice: 1000, words: 300, word: 50, wordNote: 200 }

/** 初期値（2026年度）。ビルド時に app/src/config/2026.json の内容が入る */
const INITIAL_CONFIG = /*INITIAL_CONFIG*/ null

function doGet() {
  return HtmlService.createHtmlOutputFromFile('admin')
    .setTitle('卒業制作報告書 管理ページ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
}

/**
 * 最初に1回だけ、Apps Script の画面（エディタ）から実行する。担当が替わって配り直したときも、新しい担当者が実行する。
 * シートを作り、実行した人を管理者に登録し、初期値の年度設定を「公開中」で入れる。
 * 管理ページ（google.script.run）からも呼べてしまうため、デプロイした本人が実行したとき
 * （ログイン中の人と、プログラムを動かしている人が同じとき）だけ通す。
 * 有効な管理者が0人になっても（役割の書き間違い・シート名の変更など）、ほかの人が管理者になれないように。
 */
function setup() {
  const me = Session.getActiveUser().getEmail()
  const owner = Session.getEffectiveUser().getEmail()
  if (!me || me.toLowerCase() !== String(owner || '').toLowerCase()) {
    throw new Error('setup は、管理ページをデプロイした人が、Apps Script のエディタから実行してください（ログイン中：' + (me || '不明') + '）')
  }
  return withLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const ensure = (name, header) => {
      let sheet = ss.getSheetByName(name)
      if (!sheet) sheet = ss.insertSheet(name)
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(header)
        sheet.setFrozenRows(1)
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold')
      }
      return sheet
    }
    const years = ensure(SHEET_YEARS, ['年度', '状態', '設定（JSON）', '更新日時', '更新者'])
    ensure(SHEET_HISTORY, ['日時', '更新者', '年度', '操作', '設定（JSON）'])
    const admins = ensure(SHEET_ADMINS, ['メールアドレス', 'メモ', '役割'])
    // 役割の列がない古いシートには、見出しを足す
    if (!admins.getRange(1, 3).getValue()) admins.getRange(1, 3).setValue('役割')
    const register = !roleOf_(me)
    if (register) appendRow_(admins, [me, '初期設定で登録', ROLE_ADMIN])
    appendMemberHistory_(me, '初期設定（setup）を実行' + (register ? '：' + me + ' を管理者に登録' : ''))
    if (years.getLastRow() < 2 && INITIAL_CONFIG) {
      appendRow_(years, [INITIAL_CONFIG.fiscalYear, STATUS_PUBLISHED, JSON.stringify(INITIAL_CONFIG), new Date(), me])
      appendHistory_(me, INITIAL_CONFIG.fiscalYear, '初期設定', INITIAL_CONFIG)
    }
    const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1')
    if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet)
    // 配信用のプロジェクトがこのスプレッドシートを読めるよう、ID を表示する
    Logger.log('スプレッドシートの ID: ' + ss.getId())
  })
}

// ---- 管理ページから呼ぶ関数（google.script.run） ----
// 変更する関数は、役割の確かめも鍵（withLock_）の中で行う（2人が同時にお互いの役割を変えて、管理者が0人にならないように）

function getState() {
  const user = Session.getActiveUser().getEmail()
  const role = roleOf_(user)
  return { user: user, isAdmin: role === ROLE_ADMIN, role: role === ROLE_ADMIN ? 'admin' : role === ROLE_TEACHER ? 'teacher' : null, years: role ? readYears_() : [] }
}

/**
 * 下書きのひな形だけを保存する（先生も使える）。templates は { コースID: { template, abstractExample } }。
 * 年度の設定のうち、指定したコースのひな形と抄録の書き出し例だけを書き換え、ほかは変えない。
 */
function saveTemplates(year, templates) {
  return editYear_(year, null, (config) => {
    if (!templates || typeof templates !== 'object') throw new Error('ひな形の形が正しくありません')
    return '下書きのひな形を保存（' + applyTemplates_(config, templates).join('・') + '）'
  })
}

/**
 * コースのお知らせだけを保存する（先生も使える）。notices は { コースID: お知らせ }。
 * 指定したコースのお知らせだけを書き換え、ほかは変えない
 */
function saveNotices(year, notices) {
  return editYear_(year, null, (config) => {
    if (!notices || typeof notices !== 'object') throw new Error('お知らせの形が正しくありません')
    return 'お知らせを保存（' + applyNotices_(config, notices).join('・') + '）'
  })
}

/**
 * 書き間違えやすい語の一覧だけを保存する（先生も使える）。words は [{ wrong, right, note, severity }]。
 * 書き間違いか正しい語が空の行、2つが同じ行は捨てる。
 */
function saveWordChecks(year, words) {
  return editYear_(year, null, (config) => {
    config.wordChecks = cleanWords_(words)
    return '書き間違えやすい語を保存（' + config.wordChecks.length + '語）'
  })
}

/**
 * 先生の画面の「保存」：ひな形・お知らせ・書き間違えやすい語を、まとめて1回で保存する（先生も使える）。
 * 別々に送ると、途中で失敗したときに一部だけが保存されるため。edits は { templates?, notices?, words? }
 * expectedUpdatedAt は、画面を開いたときの更新日時（そのあとにほかの人が保存していたら、保存せずに知らせる）
 */
function saveTeacherEdits(year, edits, expectedUpdatedAt) {
  return editYear_(year, expectedUpdatedAt, (config) => {
    if (!edits || typeof edits !== 'object') throw new Error('保存する内容の形が正しくありません')
    const done = []
    if (edits.templates && typeof edits.templates === 'object' && Object.keys(edits.templates).length) {
      done.push('下書きのひな形を保存（' + applyTemplates_(config, edits.templates).join('・') + '）')
    }
    if (edits.notices && typeof edits.notices === 'object' && Object.keys(edits.notices).length) {
      done.push('お知らせを保存（' + applyNotices_(config, edits.notices).join('・') + '）')
    }
    if (edits.words !== undefined && edits.words !== null) {
      config.wordChecks = cleanWords_(edits.words)
      done.push('書き間違えやすい語を保存（' + config.wordChecks.length + '語）')
    }
    return done.join('・') || '保存（変更なし）'
  })
}

/**
 * 年度の設定を読み、fn で書き換えて保存し、変更履歴に残す（先生も使える。fn は履歴に残す操作の名前を返す）。
 * fn の中で形の誤りが見つかったら（エラーを投げたら）、何も保存しない
 */
function editYear_(year, expectedUpdatedAt, fn) {
  return withLock_(() => {
    const user = requireTeacher_()
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(year)
    if (rowIndex < 0) throw new Error(year + '年度の設定がありません')
    checkNotChanged_(sheet, rowIndex, expectedUpdatedAt)
    const config = parseConfig_(sheet.getRange(rowIndex, 3).getValue(), year)
    const action = fn(config)
    checkConfig_(config)
    setRow_(sheet, rowIndex, 3, [JSON.stringify(config), new Date(), user])
    appendHistory_(user, year, action, config)
    return getState()
  })
}

/** 指定したコースのひな形と抄録の書き出し例を書き換える（形を確かめる）。書き換えたコースの名前を返す */
function applyTemplates_(config, templates) {
  const names = []
  config.courses.forEach((course) => {
    const t = templates[course.id]
    if (!t) return
    if (typeof t !== 'object') throw new Error('「' + course.name + '」のひな形の形が正しくありません')
    course.template = cleanTemplate_(t.template, course.name)
    course.abstractExample = t.abstractExample === undefined || t.abstractExample === null ? '' : checkText_(t.abstractExample, LIMITS.abstractExample, '「' + course.name + '」の抄録の書き出し例')
    names.push(course.name)
  })
  return names
}

/** 指定したコースのお知らせを書き換える（形を確かめる）。書き換えたコースの名前を返す */
function applyNotices_(config, notices) {
  const names = []
  config.courses.forEach((course) => {
    if (!Object.prototype.hasOwnProperty.call(notices, course.id)) return
    const notice = notices[course.id]
    course.notice = notice === null ? '' : checkText_(notice, LIMITS.notice, '「' + course.name + '」のお知らせ')
    names.push(course.name)
  })
  return names
}

/**
 * 下書きのひな形を確かめ、決まった項目だけの形にして返す。崩れていたら（種類が決まったもの以外、
 * 名前や説明が文字でない・長すぎる、名前が空、先頭が大見出しでない）エラーにする。
 * 学生のツールが崩れたひな形で止まらないように（学生のツールの src/config/validate.ts の templateProblems と同じ決まり）
 */
function cleanTemplate_(template, courseName) {
  const label = '「' + courseName + '」のひな形'
  if (!Array.isArray(template)) throw new Error(label + 'の形が正しくありません')
  if (template.length > LIMITS.blocks) throw new Error(label + 'の部品が多すぎます（' + LIMITS.blocks + '個まで）')
  const cleaned = template.map((block, i) => {
    const row = label + 'の' + (i + 1) + '行目'
    if (!block || typeof block !== 'object' || BLOCK_TYPES.indexOf(block.type) < 0) throw new Error(row + 'の形が正しくありません')
    const key = block.type === 'chapter' || block.type === 'subheading' ? 'title' : block.type === 'paragraph' ? 'hint' : 'caption'
    const text = checkText_(block[key], key === 'hint' ? LIMITS.hint : LIMITS.name, row)
    // 段落の説明は空でもよい（大見出し・小見出し・図・表の名前は空にしない）
    if (key !== 'hint' && !text.trim()) throw new Error(row + 'の名前が空です')
    const out = { type: block.type }
    out[key] = text
    return out
  })
  if (cleaned.length && cleaned[0].type !== 'chapter') throw new Error(label + 'は、大見出しから始めてください')
  return cleaned
}

/** 文字の項目を確かめる（文字でない・長すぎるときはエラー） */
function checkText_(value, max, label) {
  if (typeof value !== 'string') throw new Error(label + 'の形が正しくありません')
  if (value.length > max) throw new Error(label + 'が長すぎます（' + max + '字まで）')
  return value
}

/**
 * 書き間違えやすい語の一覧を確かめて整える（形が崩れていたらエラー。書き間違いか正しい語が空の行、2つが同じ行は捨てる。
 * 重さが「注意」でなければ「エラー」にする）
 */
function cleanWords_(words) {
  if (!Array.isArray(words)) throw new Error('書き間違えやすい語の形が正しくありません')
  if (words.length > LIMITS.words) throw new Error('書き間違えやすい語が多すぎます（' + LIMITS.words + '語まで）')
  return words
    .map((w, i) => {
      const row = '書き間違えやすい語の' + (i + 1) + '行目'
      if (!w || typeof w !== 'object') throw new Error(row + 'の形が正しくありません')
      const text = (key, max) => (w[key] === undefined || w[key] === null ? '' : checkText_(w[key], max, row).trim())
      return { wrong: text('wrong', LIMITS.word), right: text('right', LIMITS.word), note: text('note', LIMITS.wordNote), severity: w.severity === 'warning' ? 'warning' : 'error' }
    })
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

/** 管理者と先生の一覧（管理者だけ） */
function getMembers() {
  requireAdmin_()
  return readMembers_()
}

/** 管理者・先生を登録する（管理者だけ）。すでに登録されていれば、役割とメモを書き換える */
function addMember(email, role, memo) {
  return withLock_(() => {
    const user = requireAdmin_()
    const address = String(email || '').trim()
    if (!EMAIL_PATTERN.test(address)) throw new Error('メールアドレスが正しくありません')
    if (role !== ROLE_ADMIN && role !== ROLE_TEACHER) throw new Error('役割が正しくありません')
    const sheet = sheet_(SHEET_ADMINS)
    const values = sheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim().toLowerCase() === address.toLowerCase()) {
        if (address.toLowerCase() === user.toLowerCase() && role !== ROLE_ADMIN) throw new Error('自分を管理者から外すことはできません')
        const before = roleOfCell_(values[i][2])
        const next = values.slice()
        next[i] = [values[i][0], String(memo || values[i][1] || ''), role]
        keepAdmin_(next)
        setRow_(sheet, i + 1, 2, [next[i][1], role])
        appendMemberHistory_(user, (before === role ? '登録を更新：' : '役割を変更：') + address + '（' + (before && before !== role ? before + '→' : '') + role + '）')
        return readMembers_()
      }
    }
    appendRow_(sheet, [address, String(memo || ''), role])
    appendMemberHistory_(user, '登録：' + address + '（' + role + '）')
    return readMembers_()
  })
}

/**
 * まとめて登録する（管理者だけ）。entries は [{ email, memo }]。すでに登録されている人は、そのままにする（役割もメモも変えない）
 */
function addMembers(entries, role) {
  return withLock_(() => {
    const user = requireAdmin_()
    if (!Array.isArray(entries)) throw new Error('登録する人の形が正しくありません')
    if (role !== ROLE_ADMIN && role !== ROLE_TEACHER) throw new Error('役割が正しくありません')
    const list = entries
      .map((e) => ({ email: String((e && e.email) || '').trim(), memo: String((e && e.memo) || '').trim() }))
      .filter((e) => EMAIL_PATTERN.test(e.email))
    const sheet = sheet_(SHEET_ADMINS)
    const values = sheet.getDataRange().getValues()
    const known = values.slice(1).map((r) => String(r[0]).trim().toLowerCase())
    const added = []
    list.forEach((e) => {
      if (known.indexOf(e.email.toLowerCase()) >= 0) return
      added.push([e.email, e.memo, role])
      known.push(e.email.toLowerCase())
    })
    keepAdmin_(values.concat(added))
    added.forEach((row) => appendRow_(sheet, row))
    if (added.length) appendMemberHistory_(user, 'まとめて登録：' + added.map((r) => r[0]).join('、') + '（' + role + '）')
    return readMembers_()
  })
}

/** 管理者・先生の登録を外す（管理者だけ。自分は外せない） */
function removeMember(email) {
  return withLock_(() => {
    const user = requireAdmin_()
    const address = String(email || '').trim().toLowerCase()
    if (address === user.toLowerCase()) throw new Error('自分の登録は外せません')
    const sheet = sheet_(SHEET_ADMINS)
    const values = sheet.getDataRange().getValues()
    const matches = (r) => String(r[0]).trim().toLowerCase() === address
    keepAdmin_(values.filter((r, i) => i === 0 || !matches(r)))
    let removed = 0
    for (let i = values.length - 1; i >= 1; i--) {
      if (!matches(values[i])) continue
      sheet.deleteRow(i + 1)
      removed++
    }
    if (removed) appendMemberHistory_(user, '登録を外す：' + address)
    return readMembers_()
  })
}

/**
 * 年度の設定を丸ごと保存する（管理者だけ）。
 * expectedUpdatedAt は、画面を開いたときの更新日時。そのあとにほかの人（先生など）が保存していたら、
 * 丸ごと書き戻すとその変更が消えるので、保存せずに知らせる
 */
function saveYear(config, expectedUpdatedAt) {
  return withLock_(() => {
    const user = requireAdmin_()
    checkConfig_(config)
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(config.fiscalYear)
    if (rowIndex > 0) {
      checkNotChanged_(sheet, rowIndex, expectedUpdatedAt)
      setRow_(sheet, rowIndex, 3, [JSON.stringify(config), new Date(), user])
    } else {
      appendRow_(sheet, [config.fiscalYear, STATUS_DRAFT, JSON.stringify(config), new Date(), user])
    }
    appendHistory_(user, config.fiscalYear, '保存', config)
    return getState()
  })
}

/**
 * 年度を学生に公開する（管理者だけ。今公開中の年度は「終了」になる）。
 * expectedUpdatedAt は、画面を開いたときの更新日時（そのあとにほかの人が保存していたら、見ていない内容を公開しないよう、公開せずに知らせる）
 */
function publishYear(year, expectedUpdatedAt) {
  return withLock_(() => {
    const user = requireAdmin_()
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(year)
    if (rowIndex < 0) throw new Error(year + '年度の設定がありません')
    checkNotChanged_(sheet, rowIndex, expectedUpdatedAt)
    const config = parseConfig_(sheet.getRange(rowIndex, 3).getValue(), year)
    const values = sheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (Number(values[i][0]) === Number(year)) sheet.getRange(i + 1, 2).setValue(STATUS_PUBLISHED)
      else if (values[i][1] === STATUS_PUBLISHED) sheet.getRange(i + 1, 2).setValue(STATUS_ENDED)
    }
    appendHistory_(user, year, '公開', config)
    return getState()
  })
}

function createYear(fromYear, newYear) {
  return withLock_(() => {
    const user = requireAdmin_()
    // 年度は、西暦4桁の整数だけ（スプレッドシートに数式などが入らないように）
    if (!/^[1-9]\d{3}$/.test(String(newYear).trim())) throw new Error('新しい年度は、西暦4桁の数字で入力してください')
    const year = Number(newYear)
    if (findYearRow_(year) > 0) throw new Error(year + '年度はすでにあります')
    const fromIndex = findYearRow_(fromYear)
    if (fromIndex < 0) throw new Error(fromYear + '年度の設定がありません')
    const config = parseConfig_(sheet_(SHEET_YEARS).getRange(fromIndex, 3).getValue(), fromYear)
    config.fiscalYear = year
    appendRow_(sheet_(SHEET_YEARS), [year, STATUS_DRAFT, JSON.stringify(config), new Date(), user])
    appendHistory_(user, year, Number(fromYear) + '年度からコピーして作成', config)
    return getState()
  })
}

function getHistory(year) {
  requireTeacher_()
  const values = sheet_(SHEET_HISTORY).getDataRange().getValues().slice(1)
  const rows = []
  for (let i = values.length - 1; i >= 0 && rows.length < 50; i--) {
    const r = values[i]
    if (r[2] === '' || Number(r[2]) !== Number(year)) continue
    // 書き損じた行（設定の JSON や日時が読めない行）は飛ばす
    const config = parseJson_(r[4])
    const at = isoOf_(r[0])
    if (!config || !at) continue
    rows.push({ at: at, user: r[1], year: Number(r[2]), action: r[3], config: config })
  }
  return rows
}

// ---- 内部の処理 ----

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  if (!sheet) throw new Error('シート「' + name + '」がありません。setup を実行してください')
  return sheet
}

/**
 * 年度の設定の一覧。書き損じた行（年度・設定の JSON・更新日時が読めない行）は飛ばす
 * （1行が壊れていても、ほかの年度は使えるように。直すときは、変更履歴のシートから設定の JSON を写す）
 */
function readYears_() {
  const years = []
  sheet_(SHEET_YEARS)
    .getDataRange()
    .getValues()
    .slice(1)
    .forEach((r, i) => {
      if (r[0] === '') return
      const year = Number(r[0])
      const config = parseJson_(r[2])
      const updatedAt = isoOf_(r[3])
      if (!Number.isInteger(year) || !config || !updatedAt) {
        Logger.log('「' + SHEET_YEARS + '」シートの ' + (i + 2) + ' 行目は読めないため、飛ばしました')
        return
      }
      years.push({ year: year, status: r[1], config: config, updatedAt: updatedAt, updatedBy: r[4] })
    })
  return years.sort((a, b) => b.year - a.year)
}

function findYearRow_(year) {
  const values = sheet_(SHEET_YEARS).getDataRange().getValues()
  for (let i = 1; i < values.length; i++) if (Number(values[i][0]) === Number(year)) return i + 1
  return -1
}

/** JSON を読む（読めない・オブジェクトでないときは null） */
function parseJson_(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch (e) {
    return null
  }
}

/** 年度の設定のセルを読む（壊れていたらエラー） */
function parseConfig_(text, year) {
  const config = parseJson_(text)
  if (!config) throw new Error(year + '年度の設定（スプレッドシートの「' + SHEET_YEARS + '」シート）が壊れていて読めません。「' + SHEET_HISTORY + '」シートから、前の設定を写してください')
  return config
}

/** 日時を ISO の形の文字列にする（日時として読めなければ null） */
function isoOf_(value) {
  if (value === '' || value === null || value === undefined) return null
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * 画面を開いたあとに、ほかの人がこの年度の設定を保存していないか確かめる（保存していたらエラー）。
 * expectedUpdatedAt は、画面を開いたときの更新日時（空なら確かめない）
 */
function checkNotChanged_(sheet, rowIndex, expectedUpdatedAt) {
  if (!expectedUpdatedAt) return
  const [updatedAt, updatedBy] = sheet.getRange(rowIndex, 4, 1, 2).getValues()[0]
  if (isoOf_(updatedAt) !== expectedUpdatedAt) {
    throw new Error(
      'この画面を開いたあとに、ほかの人（' + updatedBy + '）がこの年度の設定を保存しました。そのまま保存すると、その変更が消えてしまうため、保存しませんでした。ページを読み込み直してから、もう一度変更してください',
    )
  }
}

/** 役割の欄の読み方：「管理者」「先生」のどちらか（空欄は管理者）。それ以外（書き間違いなど）は null */
function roleOfCell_(value) {
  const role = String(value || '').trim()
  return role === ROLE_TEACHER ? ROLE_TEACHER : role === ROLE_ADMIN || role === '' ? ROLE_ADMIN : null
}

/** 管理者シートの行（見出しを除く）を一覧にする。役割を書き間違えた行は、使えないようにする（間違って管理者にならないように） */
function parseMembers_(rows) {
  return rows.map((r) => ({ email: String(r[0]).trim(), memo: String(r[1] || ''), role: roleOfCell_(r[2]) })).filter((m) => m.email && m.role)
}

/**
 * 管理者シートの一覧。役割は「管理者」「先生」のどちらか（役割の列がなかった頃の行＝空欄は管理者）。
 * それ以外（書き間違いなど）の行は、使えないようにする（間違って管理者にならないように）
 */
function readMembers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ADMINS)
  if (!sheet) return []
  return parseMembers_(sheet.getDataRange().getValues().slice(1))
}

/** 有効な管理者の人数（同じアドレスの行がいくつかあれば、roleOf_ と同じく最初の行の役割で数える） */
function adminCount_(members) {
  const seen = {}
  let count = 0
  members.forEach((m) => {
    const key = m.email.toLowerCase()
    if (seen[key]) return
    seen[key] = true
    if (m.role === ROLE_ADMIN) count++
  })
  return count
}

/** 変更したあとの管理者シート（見出しを含む）で、有効な管理者が0人になるならエラーにする */
function keepAdmin_(values) {
  if (adminCount_(parseMembers_(values.slice(1))) === 0) throw new Error('有効な管理者が1人もいなくなるため、変更しませんでした。管理者を1人以上残してください')
}

/** その人の役割（管理者・先生）。登録されていなければ null */
function roleOf_(email) {
  if (!email) return null
  const member = readMembers_().find((m) => m.email.toLowerCase() === email.toLowerCase())
  return member ? member.role : null
}

function requireAdmin_() {
  const user = Session.getActiveUser().getEmail()
  if (roleOf_(user) !== ROLE_ADMIN) throw new Error('管理者だけが変更できます（ログイン中：' + (user || '不明') + '）')
  return user
}

/** 管理者か先生 */
function requireTeacher_() {
  const user = Session.getActiveUser().getEmail()
  if (!roleOf_(user)) throw new Error('登録された先生だけが使えます（ログイン中：' + (user || '不明') + '）')
  return user
}

function appendHistory_(user, year, action, config) {
  appendRow_(sheet_(SHEET_HISTORY), [new Date(), user, Number(year), action, JSON.stringify(config)])
}

/** 管理者・先生の登録の変更を、変更履歴に残す（年度と設定の欄は空） */
function appendMemberHistory_(user, action) {
  appendRow_(sheet_(SHEET_HISTORY), [new Date(), user, '', action, ''])
}

/**
 * セルに書く値。先頭が = + - @ の文字は、数式として動かないよう ' を付けて文字として書く
 * （' はスプレッドシートの画面にも、読み出した値にも出ない）
 */
function cell_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value
}

function appendRow_(sheet, row) {
  sheet.appendRow(row.map(cell_))
}

/** row 行目の col 列から右へ、values を書く */
function setRow_(sheet, row, col, values) {
  sheet.getRange(row, col, 1, values.length).setValues([values.map(cell_)])
}

/**
 * 保存する設定の形を確かめる（形が崩れていたらエラー）。学生のツールが崩れた設定で止まらないように、
 * コースの項目・下書きのひな形・お知らせ・書き間違えやすい語の型と長さを確かめる。
 * 題目や締切が空かどうかなどの細かい確認は、管理ページの画面で行う（準備中の年度は、途中でも保存できるように）
 */
function checkConfig_(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('設定の形が正しくありません')
  if (!Number.isInteger(config.fiscalYear) || config.fiscalYear < 1000 || config.fiscalYear > 9999) throw new Error('年度が正しくありません')
  if (!Array.isArray(config.courses)) throw new Error('コースの一覧がありません')
  config.courses.forEach((course, i) => {
    const name = course && typeof course.name === 'string' && course.name ? course.name : (i + 1) + '番目のコース'
    if (
      !course ||
      typeof course !== 'object' ||
      typeof course.id !== 'string' ||
      !course.id ||
      typeof course.name !== 'string' ||
      typeof course.subtitleTemplate !== 'string' ||
      !Array.isArray(course.advisors) ||
      course.advisors.some((a) => typeof a !== 'string')
    ) {
      throw new Error('「' + name + '」の形が正しくありません')
    }
    if (course.template !== undefined && course.template !== null) cleanTemplate_(course.template, name)
    if (course.abstractExample !== undefined && course.abstractExample !== null) checkText_(course.abstractExample, LIMITS.abstractExample, '「' + name + '」の抄録の書き出し例')
    if (course.notice !== undefined && course.notice !== null) checkText_(course.notice, LIMITS.notice, '「' + name + '」のお知らせ')
  })
  if (config.wordChecks !== undefined && config.wordChecks !== null) cleanWords_(config.wordChecks)
  if (JSON.stringify(config).length > 45000) throw new Error('設定が大きすぎます')
}

function withLock_(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}
