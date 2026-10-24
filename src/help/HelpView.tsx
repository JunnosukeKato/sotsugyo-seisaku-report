import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../app/icons'
import { useDialogFocus } from '../app/useDialogFocus'
import { deviceName } from '../drive/device'
import { groupVideos, lengthText, topicOfVideo, topicVideos, videosOf, type HelpVideo } from './videos'
import { TROUBLE_GROUP, type HelpDevice, type HelpTopic } from './helpTopics'
import { highlightParts, searchTopics, termsOf } from './search'
import './help.css'

/**
 * 使い方（ヘルプ）の欄（mockups/v27 案A「右の欄が切り替わる」）。
 * 上に「言葉で探す」、下に項目の一覧。項目を押すと中身（ひとこと・手順・画面の写真）、「← 一覧へ」で戻る。
 * 一覧は、書く順（先生用は仕事の順）に番号を付けたまとまりと、いちばん下の「困ったとき」（mockups/v51 案C。依頼者の選択 2026-10-24）。
 * 動画は、そのまとまりの見出しの横の「動画」から（1本ならその場で大きく再生、2本以上なら、そのまとまりの動画の一覧。前は一覧のいちばん上にまとめていた）。
 * variant：side（PC の学生用ツール。右の欄がまるごと使い方に替わる）・sheet（スマホ。画面いっぱいの欄）・dock（管理ページ。右の端に重ねる）
 * 「言葉で探す」は、入れた言葉が項目の文に入っているかを調べるだけ（search.ts。どこにも送らない）
 */

/** video の group：まとまりの動画の一覧から開いた（戻ると、その一覧へ） */
type View = { kind: 'list' } | { kind: 'topic'; id: string; from: 'list' | 'search' } | { kind: 'videos'; group: string } | { kind: 'video'; number: number; group?: string }

interface Props {
  topics: HelpTopic[]
  /**
   * student：学生用ツール、teacher：管理ページの先生、admin：管理ページの管理者（見本の言葉と、相談する相手の言い方を変える）。
   * 先生と管理者は、同じ先生用の項目を読む（管理者には「先生・管理者用」と出し、相談する相手を管理者にしない）
   */
  who: 'student' | 'teacher' | 'admin'
  /** 画面の写真の置き場所（末尾は /） */
  imageBase: string
  /** 一覧のいちばん下の「印刷用の手引き（PDF）」。label は2つ以上あるときの名前（先生用・管理者用） */
  guides: { label: string; href: string }[]
  variant: 'side' | 'sheet' | 'dock'
  onClose: () => void
  /** 「指差し確認をもう一度見る」の「いま見る」（学生用ツールだけ） */
  onTour?: () => void
  /** 「引用・参考文献」の「引用・参考文献を入れる」：引用・参考文献の窓を開く（学生用ツールだけ。mockups/v35 ①） */
  onReferences?: () => void
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

export function HelpView({ topics, who, imageBase, guides, variant, onClose, onTour, onReferences }: Props) {
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
    if (view.kind !== 'list') bodyRef.current?.querySelector<HTMLElement>('.help-topic h3')?.focus()
    else if (lastTopic.current) bodyRef.current?.querySelector<HTMLElement>(`[data-topic="${lastTopic.current}"]`)?.focus()
  }, [view])

  const open = (id: string, from: 'list' | 'search') => {
    lastTopic.current = id
    setView({ kind: 'topic', id, from })
  }
  /** 動画を開く（一覧に戻ったら、押したボタンに戻る）。group：まとまりの動画の一覧から開いた */
  const openVideo = (number: number, group?: string) => {
    if (!group) lastTopic.current = `video-${number}`
    setView({ kind: 'video', number, group })
  }
  /** まとまりの動画の一覧を開く（2本以上のとき） */
  const openGroupVideos = (group: string) => {
    lastTopic.current = `videos-${group}`
    setView({ kind: 'videos', group })
  }
  /** 動画から戻る（まとまりの動画の一覧から開いたなら、その一覧へ） */
  const backFromVideo = () => setView(view.kind === 'video' && view.group ? { kind: 'videos', group: view.group } : { kind: 'list' })
  const videoBackLabel = view.kind === 'video' && view.group ? '動画の一覧へ' : '一覧へ'
  const videos = videosOf(topics)
  const video = view.kind === 'video' ? videos.find((v) => v.number === view.number) : undefined
  const detected = currentDevice()
  const groupShown = view.kind === 'videos' ? view.group : null
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
          {Icon.help}使い方{who !== 'student' && <small>{who === 'admin' ? '先生・管理者用' : '先生用'}</small>}
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
          placeholder={who !== 'student' ? '言葉で探す（例：反映 されない）' : '言葉で探す（例：PDF 出ない）'}
          onChange={(e) => {
            setQuery(e.target.value)
            // 項目を開いているときに言葉を入れたら、探した結果に戻る
            if (view.kind !== 'list') setView({ kind: 'list' })
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
      {video ? (
        <VideoView
          video={video}
          imageBase={imageBase}
          topic={topicOfVideo(topics, video.number)}
          backLabel={videoBackLabel}
          onBack={backFromVideo}
          onOpen={(id) => open(id, 'list')}
        />
      ) : groupShown ? (
        <GroupVideos
          name={groupShown}
          videos={groupVideos(topics.filter((t) => t.group === groupShown), detected)}
          imageBase={imageBase}
          onBack={() => setView({ kind: 'list' })}
          onVideo={(n) => openVideo(n, groupShown)}
        />
      ) : topic ? (
        <TopicView
          topic={topic}
          topics={topics}
          terms={view.kind === 'topic' && view.from === 'search' ? terms : []}
          backLabel={view.kind === 'topic' && view.from === 'search' && searching ? '探した結果へ' : '一覧へ'}
          imageBase={imageBase}
          device={device}
          detected={detected}
          onDevice={setDevice}
          onBack={() => setView({ kind: 'list' })}
          onOpen={(id) => open(id, 'list')}
          onZoom={setZoom}
          onTour={onTour}
          onReferences={onReferences}
        />
      ) : searching ? (
        <Results topics={topics} query={query} who={who} onOpen={(id) => open(id, 'search')} />
      ) : (
        <TopicList topics={topics} device={detected} who={who} guides={guides} onOpen={(id) => open(id, 'list')} onVideo={(n) => openVideo(n)} onGroupVideos={openGroupVideos} />
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
          {/* 項目・動画を開いている間は、下にいつも「一覧へ戻る」（下まで読んでも、上まで戻らずに押せる：依頼者の選択 2026-10-22 案A） */}
          {(video || topic || groupShown) && (
            <div className="help-backbar">
              <button type="button" onClick={video ? backFromVideo : () => setView({ kind: 'list' })}>
                {Icon.prev}
                {topic && view.kind === 'topic' && view.from === 'search' && searching ? '探した結果へ戻る' : video ? `${videoBackLabel}戻る` : '一覧へ戻る'}
              </button>
            </div>
          )}
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

/**
 * 項目の一覧（mockups/v51 案C）：書く順（先生用は仕事の順）に番号を付けたまとまりと、いちばん下の「困ったとき」。
 * まとまりの見出しの横に、そのまとまりの動画（1本なら長さ、2本以上なら本数）。いちばん下に「印刷用の手引き（PDF）」
 */
function TopicList({
  topics,
  device,
  who,
  guides,
  onOpen,
  onVideo,
  onGroupVideos,
}: {
  topics: HelpTopic[]
  device: HelpDevice['id']
  who: Props['who']
  guides: Props['guides']
  onOpen: (id: string) => void
  onVideo: (number: number) => void
  onGroupVideos: (group: string) => void
}) {
  const groups: { name: string; items: HelpTopic[] }[] = []
  for (const t of topics) {
    const g = groups.find((x) => x.name === t.group)
    if (g) g.items.push(t)
    else groups.push({ name: t.group, items: [t] })
  }
  const rows = (items: HelpTopic[]) => (
    <ul className="help-list">
      {items.map((t) => (
        <li key={t.id}>
          <button data-topic={t.id} className={t.action?.kind === 'tour' ? 'action' : undefined} onClick={() => onOpen(t.id)}>
            <span>{t.title}</span>
            <span className="help-chev">{Icon.next}</span>
          </button>
        </li>
      ))}
    </ul>
  )
  let step = 0
  return (
    <>
      {groups.map((g) => {
        if (g.name === TROUBLE_GROUP)
          return (
            <div className="help-group help-trouble" key={g.name}>
              <h3>
                {Icon.warn}
                {g.name}
              </h3>
              {rows(g.items)}
            </div>
          )
        step += 1
        const vids = groupVideos(g.items, device)
        return (
          <div className="help-group help-step" key={g.name}>
            <div className="help-step-head">
              <span className="help-n" aria-hidden="true">
                {step}
              </span>
              <h3>{g.name}</h3>
              {vids.length > 0 && (
                <button
                  className="help-vid"
                  data-topic={vids.length === 1 ? `video-${vids[0].number}` : `videos-${g.name}`}
                  aria-label={vids.length === 1 ? `動画「${vids[0].title}」（${vids[0].seconds}秒）` : `${g.name}の動画（${vids.length}本）`}
                  onClick={() => (vids.length === 1 ? onVideo(vids[0].number) : onGroupVideos(g.name))}
                >
                  {Icon.play}動画 {vids.length === 1 ? lengthText(vids[0].seconds) : `${vids.length}本`}
                </button>
              )}
            </div>
            {rows(g.items)}
          </div>
        )
      })}
      <div className="help-foot">
        <p>{who === 'admin' ? 'それでも困ったら、ほかの管理者に相談してください。' : `それでも困ったら、${who === 'teacher' ? '管理者' : '担当の先生'}に相談してください。`}</p>
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
  const example = who !== 'student' ? '反映・ひな形' : '保存・ログイン'
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

/** まとまりの動画の一覧（そのまとまりに動画が2本以上あるとき）。題名の絵と題・長さで1行ずつ。押すと、その場で大きく再生 */
function GroupVideos({ name, videos, imageBase, onBack, onVideo }: { name: string; videos: HelpVideo[]; imageBase: string; onBack: () => void; onVideo: (number: number) => void }) {
  return (
    <article className="help-topic">
      <button className="help-back" onClick={onBack}>
        {Icon.prev}
        一覧へ
      </button>
      <div className="help-crumb">{name}</div>
      <h3 tabIndex={-1}>動画で見る（{videos.length}本・音なし）</h3>
      <ul className="help-list help-videos">
        {videos.map((v) => (
          <li key={v.number}>
            <button data-topic={`video-${v.number}`} onClick={() => onVideo(v.number)}>
              <span className="help-thumb">
                <img src={`${imageBase}videos/${v.file}.jpg`} alt="" loading="lazy" />
                {Icon.play}
              </span>
              <span className="help-vt">{v.title}</span>
              <span className="help-len" aria-label={`${v.seconds}秒`}>
                {lengthText(v.seconds)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  )
}

/** 開いた動画：その場で大きく再生し（音なしなので、押したらすぐ始める）、下に、くわしい説明の項目へのボタン */
function VideoView({ video: v, imageBase, topic, backLabel, onBack, onOpen }: { video: HelpVideo; imageBase: string; topic: HelpTopic | undefined; backLabel: string; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <article className="help-topic">
      <button className="help-back" onClick={onBack}>
        {Icon.prev}
        {backLabel}
      </button>
      <div className="help-crumb">動画で見る</div>
      <h3 tabIndex={-1}>
        動画 {v.number}「{v.title}」
      </h3>
      <figure className="help-video">
        <video src={`${imageBase}videos/${v.file}.mp4`} poster={`${imageBase}videos/${v.file}.jpg`} controls muted playsInline autoPlay />
        <figcaption>
          {v.seconds}秒・音なし（字幕つき）
        </figcaption>
      </figure>
      {topic && (
        <div className="help-rel">
          くわしい説明：
          <button onClick={() => onOpen(topic.id)}>{topic.title}</button>
        </div>
      )}
    </article>
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
  onReferences?: () => void
}

/** 開いた項目：ひとこと・手順・端末ごとの手順・補足・画面の写真（・動画） */
function TopicView({ topic: t, topics, terms, backLabel, imageBase, device, detected, onDevice, onBack, onOpen, onZoom, onTour, onReferences }: TopicProps) {
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
      {topicVideos(t, detected).map((v) => (
        <figure key={v.file} className="help-video">
          {/* 押すまで読み込まない（1本 数MB。スマホの通信を使わない）。はじめは題名の絵を出す */}
          <video src={`${imageBase}videos/${v.file}.mp4`} poster={`${imageBase}videos/${v.file}.jpg`} controls muted playsInline preload="none" />
          <figcaption>
            動画 {v.number}「{v.title}」（{v.seconds}秒・音なし）
          </figcaption>
        </figure>
      ))}
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
      {t.devices && dev && t.devicesTitle && <p className="help-dev-title">{t.devicesTitle}</p>}
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
      {/* 引用・参考文献を入れる（右の欄からは外し、ここから入れる。入れた文献があれば、窓の中で直せる） */}
      {t.action?.kind === 'references' && onReferences && (
        <button className="help-action help-refs" onClick={onReferences}>
          {Icon.refs}
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
