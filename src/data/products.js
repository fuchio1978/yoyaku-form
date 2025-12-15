const products = [
  {
    id: 'sichusuimeihandbook',
    title: '四柱手帖0 創刊号 特別価格',
    price: 600,
    currency: '¥',
    image: '/images/handbook.svg',
    summary: '自然派の星推命をポケットサイズで読める創刊号。特集「空と風」。',
    details: [
      'A5判・50ページ',
      '特集：空の読み解きと二十四節気',
      '付録：日々のメモスペース'
    ],
    duration: '45分',
    typeLabel: '単発相談（ライトプラン）',
    schedule: [
      { date: '2025-05-23', slots: ['10:00', '13:00', '15:00'] },
      { date: '2025-05-24', slots: ['11:00', '14:00'] },
      { date: '2025-05-25', slots: ['10:00', '12:00', '16:00'] }
    ]
  },
  {
    id: 'calendar-2025',
    title: '空と大地のカレンダー 2025',
    price: 1000,
    currency: '¥',
    image: '/images/calendar.svg',
    summary: '季節の移り変わりを楽しみながら暦を学べる卓上カレンダー。',
    details: [
      '二十四節気・毎日の月齢付き',
      '書き込みスペースたっぷり',
      '観音開きで写真も楽しめる'
    ],
    duration: '60分',
    typeLabel: '個別ガイダンス付き',
    schedule: [
      { date: '2025-05-26', slots: ['09:00', '11:00', '13:00'] },
      { date: '2025-05-27', slots: ['10:00', '15:00'] },
      { date: '2025-05-28', slots: ['12:00', '14:00', '18:00'] }
    ]
  },
  {
    id: 'handbook-set',
    title: '四柱手帖＆カレンダーセット',
    price: 1600,
    currency: '¥',
    image: '/images/set.svg',
    summary: '手帖とカレンダーをセットで。講座説明会の参加権が付きます。',
    details: [
      '限定特典：オンラインQ&A 1回分付き',
      'ギフト包装対応',
      '配送または会場受け取りを選択可'
    ],
    duration: '90分',
    typeLabel: '講座説明会＋予約',
    schedule: [
      { date: '2025-05-29', slots: ['09:30', '13:30', '17:00'] },
      { date: '2025-05-30', slots: ['10:30', '14:30'] },
      { date: '2025-05-31', slots: ['11:00', '16:00'] }
    ]
  }
];

function getProduct(id) {
  return products.find((product) => product.id === id);
}

module.exports = { products, getProduct };
