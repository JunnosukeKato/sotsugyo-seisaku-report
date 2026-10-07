import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../app/icons'
import { useDialogFocus } from '../app/useDialogFocus'
import { deviceName } from '../drive/device'
import type { HelpDevice, HelpTopic } from './helpTopics'
import { highlightParts, searchTopics, termsOf } from './search'
import './help.css'

/**
 * 使い方（ヘルプ）の欄（mockups/v27 案A「右の欄が切り替わる」）。
 * 上に「言葉で探す」、下に項目の一覧。項目を押すと中身（ひとこと・手順・画面の写真）、「← 一覧へ」で戻る。
 * variant：side（PC の学生用ツール。右の欄がまるごと使い方に替わる）・sheet（スマホ。画面いっぱいの欄）・dock（管理ページ。右の端に重ねる）
 * 「言葉で探す」は、入れた言葉が項目の文に入っているかを調べるだけ（search.ts。どこにも送らない）
 */

type View = { kind: 'list' } | { kind: 'topic'; id: string; from: 'list' | 'search' }

interface Props {
  topics: HelpTopic[]
  /** student：学生用ツール、teacher：管理ページ（見本の言葉と、相談する相手の言い方を変える） */
  who: 'student' | 'teacher'
  /** 画面の写真の置き場所（末尾は /） */
  imageBase: string
  /** 一覧のいちばん下の「印刷用の手引き（PDF）」。label は2つ以上あるときの名前（先生用・管理者用） */
  guides: { label: string; href: string }[]
  variant: 'side' | 'sheet' | 'dock'
  onClose: () => void
  /** 「指差し確認をもう一度見る」の「いま見る」（学生用ツールだけ） */
  onTour?: () => void
}

/** 使っている端末の、PDF の保存のしかた（印刷の画面が端末によって違う） */
function currentDevice(): HelpDevice['id'] {
  const d = deviceName()
  return /^(iPhone|iPad)/.test(d) ? 'iphone' : /^Android/.test(d) ? 'android' : /^Mac・Safari/.test(d) ? 'mac' : 'pc'
}

/** 言葉の入っているところに印（黄色）を付けて出す */
function Hl({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="help-hit">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  )
}

export function HelpView({ topics, who, imageBase, guides, variant, onClose, onTour }: Props) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [device, setDevice] = useState<HelpDevice['id']>(currentDevice)
  /** 大きく出している画面の写真 */
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const noRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  /** 一覧（探した結果）に戻ったとき、開いていた項目のボタンに戻るため */
  const lastTopic = useRef<string | null>(null)
  const titleId = useId()
  const sheet = variant === 'sheet'
  // Esc：大きく出している写真があれば、それを閉じる。なければ使い方を閉じる
  const escape = () => (zoom ? setZoom(null) : onClose())
  // スマホ（画面いっぱいの欄）は窓として扱う（中に移り、Tab で外に出ず、閉じると元の場所に戻る）
  useDialogFocus(sheet ? rootRef : noRef, escape)

  // PC・管理ページ：開いたら、使い方の見出しに移る（読み上げで、初めから読まれるように）
  useEffect(() => {
    if (!sheet) headingRef.current?.focus()
  }, [sheet])

  // 項目を開いたら、中身のいちばん上から見せ、題に移る。一覧に戻ったら、開いていた項目のボタンに戻る
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    if (view.kind === 'topic') bodyRef.current?.querySelector<HTMLElement>('.help-topic h3')?.focus()
    else if (lastTopic.current) bodyRef.current?.querySelector<HTMLElement>(`[data-topic="${lastTopic.current}"]`)?.focus()
  }, [view])

  const open = (id: string, from: 'list' | 'search') => {
    lastTopic.current = id
    setView({ kind: 'topic', id, from })
  }
  const terms = termsOf(query)
  const searching = terms.length > 0
  const topic = view.kind === 'topic' ? topics.find((t) => t.id === view.id) : undefined

  const onKeyDown = (e: KeyboardEvent) => {
    // スマホは useDialogFocus が Esc を受ける
    if (sheet || e.key !== 'Escape') return
    e.preventDefault()
    escape()
  }

  const head = (
    <div className="help-top">
      <div className="help-head">
        <h2 className="help-title" id={titleId} ref={headingRef} tabIndex={-1} data-autofocus>
          {Icon.help}使い方{who === 'teacher' && <small>先生用</small>}
        </h2>
        {sheet ? (
          <button className="help-close close" onClick={onClose} aria-label="使い方を閉じる">
            ×
          </button>
        ) : (
          <button className="help-close" onClick={onClose}>
            閉じる<span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <div className={`help-search${query ? ' filled' : ''}`}>
        {Icon.search}
        <input
          type="text"
          value={query}
          enterKeyHint="search"
          aria-label="言葉で探す"
          placeholder={who === 'teacher' ? '言葉で探す（例：反映 されない）' : '言葉で探す（例：PDF 出ない）'}
          onChange={(e) => {
            setQuery(e.target.value)
            // 項目を開いているときに言葉を入れたら、探した結果に戻る
            if (view.kind === 'topic') setView({ kind: 'list' })
          }}
        />
        {query && (
          <button className="help-clear" aria-label="入れた言葉を消す" onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </div>
      <p className="help-note">言葉が入っている項目を出します（どこにも送りません）</p>
    </div>
  )

  const body = (
    <div className="help-body" ref={bodyRef}>
      {topic ? (
        <TopicView
          topic={topic}
          topics={topics}
          terms={view.kind === 'topic' && view.from === 'search' ? terms : []}
          backLabel={view.kind === 'topic' && view.from === 'search' && searching ? '探した結果へ' : '一覧へ'}
          imageBase={imageBase}
          device={device}
          detected={currentDevice()}
          onDevice={setDevice}
          onBack={() => setView({ kind: 'list' })}
          onOpen={(id) => open(id, 'list')}
          onZoom={setZoom}
          onTour={onTour}
        />
      ) : searching ? (
        <Results topics={topics} query={query} who={who} onOpen={(id) => open(id, 'search')} />
      ) : (
        <TopicList topics={topics} who={who} guides={guides} onOpen={(id) => open(id, 'list')} />
      )}
    </div>
  )

  const zoomed = zoom && (
    <div className="help-zoom" role="dialog" aria-modal="true" aria-label={zoom.caption} onClick={() => setZoom(null)}>
      <img src={zoom.src} alt={zoom.caption} />
      <ZoomClose onClose={() => setZoom(null)} />
    </div>
  )

  if (sheet)
    return (
      <>
        <div className="scrim help-scrim" onClick={onClose} />
        <section className="help help-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={rootRef}>
          <div className="grab" />
          {head}
          {body}
          {zoomed}
        </section>
      </>
    )
  return (
    <section className={`help help-${variant}`} aria-labelledby={titleId} ref={rootRef} onKeyDown={onKeyDown}>
      {head}
      {body}
      {zoomed}
    </section>
  )
}

/** 大きく出した写真を閉じるボタン（出したら、ここに移る） */
function ZoomClose({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <button className="close" ref={ref} aria-label="写真を閉じる" onClick={onClose}>
      ×
    </button>
  )
}

/** 項目の一覧（まとまりごと）と、いちばん下の「印刷用の手引き（PDF）」 */
function TopicList({ topics, who, guides, onOpen }: { topics: HelpTopic[]; who: Props['who']; guides: Props['guides']; onOpen: (id: string) => void }) {
  const groups: { name: string; items: HelpTopic[] }[] = []
  for (const t of topics) {
    const g = groups.find((x) => x.name === t.group)
    if (g) g.items.push(t)
    else groups.push({ name: t.group, items: [t] })
  }
  return (
    <>
      {groups.map((g) => (
        <div className="help-group" key={g.name}>
          <h3>{g.name}</h3>
          <ul className="help-list">
            {g.items.map((t) => (
              <li key={t.id}>
                <button data-topic={t.id} className={t.action ? 'action' : undefined} onClick={() => onOpen(t.id)}>
                  {t.title}
                  {t.video && <span className="help-mark" aria-label="動画あり">{Icon.play}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="help-foot">
        <p>それでも困ったら、{who === 'teacher' ? '管理者' : '担当の先生'}に相談してください。</p>
        {guides.length === 1 ? (
          <a className="help-pdf" href={guides[0].href} target="_blank" rel="noreferrer">
            印刷用の手引き（PDF）
          </a>
        ) : (
          <p className="help-pdf">
            印刷用の手引き（PDF）：
            {guides.map((g, i) => (
              <span key={g.href}>
                {i > 0 && '・'}
                <a href={g.href} target="_blank" rel="noreferrer">
                  {g.label}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>
    </>
  )
}

/** 探した結果（1つの項目につき1件。全部の言葉が入っている項目を先に） */
function Results({ topics, query, who, onOpen }: { topics: HelpTopic[]; query: string; who: Props['who']; onOpen: (id: string) => void }) {
  const { terms, hits } = searchTopics(topics, query)
  const words = query.split(/[\s　、,・]+/).filter(Boolean)
  const example = who === 'teacher' ? '反映・ひな形' : '保存・ログイン'
  const firstPartial = hits.findIndex((h) => h.found.length < terms.length)
  return (
    <>
      <p className="help-count" role="status">
        {words.map((w) => `「${w}」`).join('')}が入っている項目：<b>{hits.length}件</b>
      </p>
      <ul className="help-results">
        {hits.map((h, i) => (
          <li key={h.topic.id}>
            {i === firstPartial && i > 0 && <p className="help-part">一部の言葉だけ入っている項目</p>}
            <button data-topic={h.topic.id} onClick={() => onOpen(h.topic.id)}>
              <span className="t">
                <Hl text={h.topic.title} terms={terms} />
              </span>
              <span className="s">
                {h.line.label && (
                  <em>
                    <Hl text={h.line.label} terms={terms} />：
                  </em>
                )}
                <Hl text={h.line.text} terms={terms} />
              </span>
              {h.hidden.length > 0 && (
                <span className="w">
                  {h.hidden.map((w, k) => (
                    <span key={w}>
                      {k > 0 && '・'}
                      <mark className="help-hit">{w}</mark>
                    </span>
                  ))}
                  でも探せる項目
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="help-miss">{hits.length ? `見つからないときは、ほかの言葉で（例：${example}）。` : `ほかの言葉で探してみてください（例：${example}）。`}</p>
    </>
  )
}

interface TopicProps {
  topic: HelpTopic
  topics: HelpTopic[]
  terms: string[]
  backLabel: string
  imageBase: string
  device: HelpDevice['id']
  detected: HelpDevice['id']
  onDevice: (d: HelpDevice['id']) => void
  onBack: () => void
  onOpen: (id: string) => void
  onZoom: (z: { src: string; caption: string }) => void
  onTour?: () => void
}

/** 開いた項目：ひとこと・手順・端末ごとの手順・補足・画面の写真（・動画） */
function TopicView({ topic: t, topics, terms, backLabel, imageBase, device, detected, onDevice, onBack, onOpen, onZoom, onTour }: TopicProps) {
  const dev = t.devices?.find((d) => d.id === device) ?? t.devices?.[0]
  const shotSrc = t.shot ? `${imageBase}${t.shot.file}` : ''
  return (
    <article className="help-topic">
      <button className="help-back" onClick={onBack}>
        {Icon.prev}
        {backLabel}
      </button>
      <div className="help-crumb">{t.group}</div>
      <h3 tabIndex={-1}>
        <Hl text={t.title} terms={terms} />
      </h3>
      {t.video && (
        <figure className="help-video">
          <video src={`${imageBase}${t.video.src}`} controls muted playsInline preload="metadata" />
          <figcaption>動画（{t.video.seconds}秒・音なし）</figcaption>
        </figure>
      )}
      {t.lead && (
        <p className="help-lead">
          <Hl text={t.lead} terms={terms} />
        </p>
      )}
      {t.steps && (
        <ol className="help-steps">
          {t.steps.map((s) => (
            <li key={s}>
              <span>
                <Hl text={s} terms={terms} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {t.devices && dev && (
        <div className="help-dev">
          <div className="tabs" role="group" aria-label="端末">
            {t.devices.map((d) => (
              <button key={d.id} className={d === dev ? 'on' : ''} aria-pressed={d === dev} onClick={() => onDevice(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          {dev.id === detected && <span className="here">✓ いま使っている端末です</span>}
          <ul>
            {dev.lines.map((l) => (
              <li key={l}>
                <Hl text={l} terms={terms} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.items?.map((it) => (
        <div className={`help-item${/とき$/.test(it.h) ? ' warn' : ''}`} key={it.h}>
          <b>
            <Hl text={it.h} terms={terms} />
          </b>
          <Hl text={it.t} terms={terms} />
        </div>
      ))}
      {t.action?.kind === 'tour' && onTour && (
        <button className="help-action" onClick={onTour}>
          {t.action.label}
        </button>
      )}
      {t.shot && (
        <figure className="help-shot">
          <button className="help-shot-btn" aria-label={`画面の写真を大きくする：${t.shot.caption}`} onClick={() => onZoom({ src: shotSrc, caption: t.shot!.caption })}>
            <img src={shotSrc} alt={t.shot.caption} loading="lazy" />
          </button>
          <figcaption>
            {t.shot.caption}
            <span>押すと大きく</span>
          </figcaption>
        </figure>
      )}
      {t.related && (
        <div className="help-rel">
          関係する項目：
          {t.related.map((id) => {
            const r = topics.find((x) => x.id === id)
            return r ? (
              <button key={id} onClick={() => onOpen(id)}>
                {r.title}
              </button>
            ) : null
          })}
        </div>
      )}
    </article>
  )
}
