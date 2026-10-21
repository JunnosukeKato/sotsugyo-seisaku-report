/**
 * お試し（?trial=1）の上の帯：お試し中であることと、試した内容がどこにも届かないこと、「見本に戻す」（依頼者の選択 2026-10-22 案1）。
 * スマホなど狭い画面では、説明の文を省いて、お試し中であることとボタンだけにする（index.css）
 */
export function TrialBanner({ onReset }: { onReset?: () => void }) {
  return (
    <div className="trial-band" role="note">
      <b>お試し中（見本の原稿）</b>
      <span className="trial-note">変更はこのブラウザにだけ残り、提出・ドライブには届きません</span>
      <button className="trial-reset" disabled={!onReset} onClick={onReset}>
        見本に戻す
      </button>
    </div>
  )
}
