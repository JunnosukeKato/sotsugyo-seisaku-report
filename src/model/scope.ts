/**
 * お試し（学生のツールを ?trial=1 で開いたもの：先生が、見本の原稿で学生の画面を試す。src/trial/）。
 * お試しでは、この端末に保存する名前（IndexedDB・localStorage・タブのロック）を変え、学生の原稿と混ざらないようにする。
 * 名前を変えるのは、原稿にかかわるもの（原稿・写真・控え・紙面の組み方・最後に見ていた所・案内・Word のつぎにすること）。
 * 欄の幅・表示の大きさなどの、見た目の好みは同じ名前のまま
 */

/** お試しで開く印（学生のツールの URL の ?trial=1） */
export const TRIAL_PARAM = 'trial'

/** お試しで開いているか */
export const trialMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has(TRIAL_PARAM)

/** この端末に保存する名前（お試しでは、後ろに -trial を付ける） */
export const scoped = (name: string): string => (trialMode ? `${name}-trial` : name)
