/**
 * 開発用の小さな見本の原稿（試験用サーバー：admin/mockServer.ts の getTrialSample。手元に本番の見本がないとき）。
 * 本番の見本（文章の多いもの）は、git に入れないファイル gas/trial-sample.private.json に置き、管理ページのサーバーにだけ入れる
 * （scripts/build-gas.mjs）。写真は、どちらも public/trial/ のもの
 */
const p = (id: string, text: string) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })

export const DEV_TRIAL_SAMPLE = {
  report: {
    formatVersion: 2,
    fiscalYear: 0,
    basicInfo: { studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: { started: true, paragraphs: [p('a1', '開発用の見本の原稿です。お試しの画面が開くことを確かめるための、短い原稿です。')] },
    body: [
      {
        id: 'c1',
        title: '企画・立案',
        blocks: [
          { type: 'subheading', id: 's1', title: '担当衣装のキャラクター' },
          p('p1', '開発用の見本の本文です。この段落を書き換えて、お試しの画面の動きを確かめます。'),
          { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: 'g-design', caption: 'デザイン画' }] },
        ],
      },
    ],
    references: [],
    workPhotos: [{ layout: 1, imageIds: ['g-photo1'] }],
    updatedAt: '2026-10-22T00:00:00.000Z',
  },
  images: [
    { id: 'g-design', file: 'g-design.jpg', maxPx: 1200 },
    { id: 'g-photo1', file: 'g-photo1.jpg', maxPx: 1200 },
  ],
}
