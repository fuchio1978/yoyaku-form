const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const querystring = require('querystring');
const { getProducts, getProduct, saveProducts } = require('./data/products');
const {
  getSchedules,
  saveSchedules,
  getScheduleForPerson,
  getPersonName,
  updateScheduleForPerson,
} = require('./data/schedules');
const { renderPage, formatCurrency } = require('./utils/render');
const { saveReservation } = require('./utils/reservations');
const { sendReservationEmail, recipient } = require('./utils/email');

const publicDir = path.join(__dirname, '..', 'public');
// 永続ストレージのルート（Render の Persistent Disk など）
const storageRoot = process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', 'storage');
const contactsStorePath = path.join(storageRoot, 'contacts.json');
const outboxDir = path.join(storageRoot, 'outbox');
const imagesStorageDir = path.join(storageRoot, 'images');
const sheetsWebhookUrl =
  process.env.SHEETS_WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbyppWE01CZyQgz_S-8o2LfvOrKoTw4gX9IM97iNmsR0LCmGFIPlyPT07Xxp7XmM-VTzvw/exec';

async function sendReservationToSheets(reservation) {
  if (!sheetsWebhookUrl) return;

  const payload = {
    productTitle: reservation.productTitle || '',
    productPrice: typeof reservation.price === 'number' ? reservation.price : '',
    productCurrency: reservation.currency || '',
    productPriceFormatted:
      reservation.currency && typeof reservation.price === 'number'
        ? `${reservation.currency}${reservation.price.toLocaleString('ja-JP')}`
        : '',
    date: reservation.date || '',
    timeSlot: reservation.timeSlot || '',
    name: reservation.name || '',
    email: reservation.email || '',
    notes: reservation.notes || '',
    personName: reservation.personName || '',
    birthday: reservation.birthday || '',
    birthTime: reservation.birthTime || '',
    birthPlace: reservation.birthPlace || '',
    genderAtBirth: reservation.genderAtBirth || '',
    sessionType: reservation.sessionType || '',
    paymentMethod: reservation.paymentMethod || '',
  };

  try {
    // Node.js 18+ on Render ではグローバルfetchが利用可能
    await fetch(sheetsWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Failed to send reservation to Google Sheets webhook', e);
  }
}

// アップロード済み画像の一覧を取得
function getUploadedImages() {
  try {
    if (!fs.existsSync(imagesStorageDir)) {
      return [];
    }
    const files = fs.readdirSync(imagesStorageDir).filter((name) => /\.(png|jpg|jpeg|svg)$/i.test(name));
    return files.sort();
  } catch (e) {
    console.error('Failed to list uploaded images', e);
    return [];
  }
}

function renderAdminImagesPage(message) {
  const files = getUploadedImages();
  const rows = files
    .map(
      (file) => `
        <tr>
          <td><code>/uploads/images/${file}</code></td>
          <td>${file}</td>
          <td><img src="/uploads/images/${file}" alt="${file}" style="max-width:120px; max-height:80px; object-fit:contain;"></td>
          <td>
            <form method="POST" action="/admin/delete-image" onsubmit="return confirm('この画像を削除してよろしいですか？');" style="margin:0;">
              <input type="hidden" name="file" value="${file}">
              <button type="submit">削除</button>
            </form>
          </td>
        </tr>
      `
    )
    .join('');

  const notice = message ? `<p style="color:#16a34a;">${message}</p>` : '';

  const content = `
    <div class="panel">
      <h3>画像管理（管理画面）</h3>
      <p>ここでアップロードした画像は、商品編集画面から選択して利用できます。</p>
      ${notice}
      <form method="POST" action="/admin/images" enctype="multipart/form-data" class="reservation-form">
        <div class="field">
          <label for="imageFile">画像ファイルをアップロード（PNG / JPG / JPEG / SVG）</label>
          <input id="imageFile" name="image" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" required />
        </div>
        <button class="button" type="submit">アップロード</button>
      </form>
      <hr style="margin:1.5rem 0;" />
      <h4>アップロード済み画像</h4>
      <table class="schedule-table">
        <thead><tr><th>パス</th><th>ファイル名</th><th>プレビュー</th><th>操作</th></tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="4">まだ画像がありません。</td></tr>'}
        </tbody>
      </table>
      <p style="margin-top:1rem;"><a class="button secondary" href="/admin">商品一覧へ戻る</a></p>
    </div>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/admin', hideHeading: true });
}

// multipart/form-data から単一ファイル (name="image") を取り出す簡易パーサ
function parseMultipartImage(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return reject(new Error('Missing multipart boundary'));
    }
    const boundaryStr = `--${boundaryMatch[1]}`;

    const chunks = [];
    let totalLength = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 10 * 1024 * 1024) {
        // 10MB 超は拒否
        reject(new Error('File too large')); 
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const all = buffer.toString('binary');
        const rawParts = all.split(boundaryStr).slice(1, -1); // 先頭と末尾の空パートを除外
        for (const rawPart of rawParts) {
          const part = Buffer.from(rawPart, 'binary');
          const idx = part.indexOf('\r\n\r\n');
          if (idx === -1) continue;
          const headerBuf = part.slice(0, idx).toString('utf8');
          const body = part.slice(idx + 4, part.length - 2); // 末尾の CRLF を除外

          if (!/name="image"/i.test(headerBuf)) continue;
          const fileNameMatch = headerBuf.match(/filename="([^"\\]+)"/i);
          if (!fileNameMatch || !fileNameMatch[1]) continue;
          let fileName = path.basename(fileNameMatch[1]);
          if (!/\.(png|jpg|jpeg|svg)$/i.test(fileName)) {
            throw new Error('Unsupported file type');
          }
          return resolve({ fileName, data: body });
        }
        reject(new Error('No image file field'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function renderPersonProductsPage(personId) {
  const products = getProducts()
    .slice()
    .filter((p) => p.personId === personId && !p.isHidden)
    .sort((a, b) => {
      const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 9999;
      const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || '').localeCompare(b.title || '');
    });

  const personLabel = personId === 'tetsuya' ? 'てつ先生' : personId === 'chigusa' ? 'ちぐさ' : '';

  const cards = products
    .map(
      (product) => `
      <a class="product-card" href="/products/${product.id}">
        <img src="${product.image}" alt="${product.title}" loading="lazy" />
        <div class="card-body">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${formatCurrency(product.currency, product.price)}</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
          <div class="title"><strong>${product.title}</strong></div>
          <p class="subtitle">${product.summary}</p>
        </div>
      </a>
    `
    )
    .join('');

  const gridClass = products.length === 1
    ? 'cards-grid single-person-grid person-products-grid'
    : 'cards-grid person-products-grid';

  const content = `
    <div style="margin-bottom: 0.75rem;"><a href="/" style="font-size: 0.85rem; color: #2563eb; text-decoration: none;">&larr; TOPに戻る</a></div>
    <h2 style="margin-bottom: 1rem;">${personLabel ? `${personLabel}のメニュー一覧` : 'メニュー一覧'}</h2>
    <div class="${gridClass}">${cards}</div>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

// 講座紹介LP専用ページ（/kouza）: Tailwind付きのフルHTMLをそのまま返す
function renderKouzaCoursePage() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>自然の景色でみる四柱推命講座 | 景色で読み解く運命の地図</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&family=Shippori+Mincho:wght@400;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Shippori Mincho', 'Noto Serif JP', serif;
            color: #334139;
            background-color: #fdfcf9;
            line-height: 1.8;
        }
        .hero-overlay {
            background: linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35));
        }
        .accent-border {
            border-left: 4px solid #7d9d85;
        }
        .fade-in {
            animation: fadeIn 1.5s ease-out forwards;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .image-container {
            position: relative;
            background-color: #f3f4f6;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 200px;
        }
        .plan-card {
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .step-arrow::after {
            content: '→';
            position: absolute;
            right: -20px;
            top: 50%;
            transform: translateY(-50%);
            color: #d1d5db;
            font-size: 1.2rem;
            font-family: serif;
        }
        @media (max-width: 1024px) {
            .step-arrow::after { content: none; }
        }
        .quote-bg {
            background-color: #2d3a32;
            background-image: radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0);
            background-size: 40px 40px;
        }
        /* 読みやすさのための調整 */
        .text-balance {
            text-wrap: balance;
        }
    </style>
    <script>
        function handleImageError(img, type) {
            const backups = {
                'hero': 'https://images.pexels.com/photos/167699/pexels-photo-167699.jpeg?auto=compress&cs=tinysrgb&w=1600',
                'intro': 'https://images.pexels.com/photos/414171/pexels-photo-414171.jpeg?auto=compress&cs=tinysrgb&w=1200',
                'tree': 'https://images.pexels.com/photos/1632790/pexels-photo-1632790.jpeg?auto=compress&cs=tinysrgb&w=800',
                'fire': 'https://images.pexels.com/photos/189349/pexels-photo-189349.jpeg?auto=compress&cs=tinysrgb&w=800',
                'metal': 'https://images.pexels.com/photos/673020/pexels-photo-673020.jpeg?auto=compress&cs=tinysrgb&w=800',
                'mountain': 'https://images.pexels.com/photos/618833/pexels-photo-618833.jpeg?auto=compress&cs=tinysrgb&w=800'
            };
            if (backups[type]) {
                img.onerror = null;
                img.src = backups[type];
            }
        }
    </script>
</head>
<body>

    <!-- Header -->
    <nav class="p-6 flex justify-between items-center bg-white/70 backdrop-blur-md fixed w-full z-50 border-b border-gray-100">
        <div class="text-xl font-bold tracking-[0.2em] uppercase text-[#2d3a32]">Fuchi Labo</div>
        <div class="hidden md:flex space-x-10 text-sm tracking-widest">
            <a href="/" class="hover:text-green-700 transition duration-300">コンセプト</a>
            <a href="#plans" class="hover:text-green-700 transition duration-300">講座案内</a>
            <a href="/contact" class="hover:text-green-700 transition duration-300">お問い合わせ</a>
        </div>
    </nav>

    <!-- Hero Section -->
    <section class="relative h-screen flex items-center justify-center overflow-hidden bg-gray-900">
        <img src="https://images.pexels.com/photos/957024/forest-trees-fog-foggy-957024.jpeg?auto=compress&cs=tinysrgb&w=1600" 
             alt="" 
             class="absolute inset-0 w-full h-full object-cover"
             onerror="handleImageError(this, 'hero')">
        <div class="absolute inset-0 hero-overlay"></div>
        <div class="relative z-10 text-center px-6 max-w-5xl fade-in">
            <h1 class="text-white text-2xl md:text-5xl leading-snug md:leading-relaxed mb-10 drop-shadow-2xl tracking-[0.15em] text-balance">
                あなたの宿命は、一枚の美しいキャンバス。<br>
                <span class="text-lg md:text-2xl mt-6 block font-light tracking-widest leading-loose">
                    「難解な漢字」を「大自然の景色」に書き換え、<br class="hidden md:block">
                    人生の歩み方を読み解く<br>
                    ——自然の景色でみる四柱推命講座
                </span>
            </h1>
            <div class="mt-16">
                <a href="#intro" class="inline-block px-12 py-5 bg-white/10 hover:bg-white/30 text-white border border-white rounded-full transition duration-500 backdrop-blur-sm tracking-widest text-sm">
                    無料講座説明会に参加する
                </a>
            </div>
        </div>
    </section>

    <!-- 1. 四柱推命は「怖い占い」ではありません -->
    <section id="intro" class="py-24 md:py-32 px-6 md:px-12 max-w-6xl mx-auto">
        <div class="flex flex-col lg:flex-row items-center gap-12 md:gap-16">
            <div class="w-full lg:w-1/2 image-container rounded-3xl shadow-2xl overflow-hidden text-center">
                <img src="https://images.pexels.com/photos/414171/pexels-photo-414171.jpeg?auto=compress&cs=tinysrgb&w=1200" 
                     alt="" 
                     class="w-full h-auto object-cover min-h-[300px]"
                     onerror="handleImageError(this, 'intro')">
            </div>
            <div class="w-full lg:w-1/2">
                <div class="mb-4 text-[#7d9d85] font-bold tracking-widest italic text-xl">01</div>
                <h2 class="text-2xl md:text-3xl font-bold mb-8 leading-relaxed text-[#2d3a32]">
                    四柱推命は、<br class="md:hidden">「怖い占い」ではありません
                </h2>
                <p class="leading-relaxed mb-8 text-gray-700 md:text-lg">
                    四柱推命の解説書を開くと、「死」「絶」「病」「傷官」といった、一見すると不吉で怖い言葉が並んでいます。そのため、「私は運が悪いんだ」「この星があるから不幸になるんだ」と、自分の可能性を否定されたように感じてしまったことはありませんか？
                </p>
                <div class="accent-border pl-8 bg-white/60 py-6 italic text-[#3e4d44] leading-loose">
                    <strong class="text-[#2d3a32]">自然の景色でみる四柱推命</strong>では、こうした言葉のベールに隠された「本質的な五行（木・火・土・金・水）」に注目します。私たちは、四柱推命を単なる占いではなく、東洋の叡智が育んだ「自然哲学」であり、幸せに生きるための「人間哲学」であると考えています。
                </div>
            </div>
        </div>
    </section>

    <!-- 2. 命式を景色としてイメージする -->
    <section class="py-24 md:py-32 bg-[#f4f7f2]">
        <div class="max-w-6xl mx-auto px-6">
            <div class="text-center mb-20">
                <h2 class="text-3xl font-bold mb-6 tracking-widest text-[#2d3a32]">命式を「景色」としてイメージする</h2>
                <p class="text-gray-600 tracking-widest text-lg">8つの漢字を、あなただけの「運命の景色」に置き換えます</p>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div class="group overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-2xl transition duration-500 text-center">
                    <div class="h-64 overflow-hidden image-container bg-[#e8f0e9]">
                        <img src="https://images.pexels.com/photos/1632790/pexels-photo-1632790.jpeg?auto=compress&cs=tinysrgb&w=800&v=1" 
                             alt="" 
                             class="h-full w-full object-cover group-hover:scale-110 transition duration-700"
                             onerror="handleImageError(this, 'tree')">
                    </div>
                    <div class="p-8">
                        <h3 class="font-bold text-xl text-[#5a7d65] mb-2">甲・乙 (木)</h3>
                        <p class="text-sm leading-relaxed text-gray-600">上に伸びゆく樹木や、<br>たおやかに咲く草花</p>
                    </div>
                </div>

                <div class="group overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-2xl transition duration-500 text-center">
                    <div class="h-64 overflow-hidden image-container bg-[#fff7ed]">
                        <img src="https://images.pexels.com/photos/189349/pexels-photo-189349.jpeg?auto=compress&cs=tinysrgb&w=800&v=1" 
                             alt="" 
                             class="h-full w-full object-cover group-hover:scale-110 transition duration-700"
                             onerror="handleImageError(this, 'fire')">
                    </div>
                    <div class="p-8">
                        <h3 class="font-bold text-xl text-[#b45309] mb-2">丙・丁 (火)</h3>
                        <p class="text-sm leading-relaxed text-gray-600">万物を照らす太陽や、<br>闇を照らす灯火</p>
                    </div>
                </div>

                <div class="group overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-2xl transition duration-500 text-center">
                    <div class="h-64 overflow-hidden image-container bg-[#f1f5f9]">
                        <img src="https://images.pexels.com/photos/673020/pexels-photo-673020.jpeg?auto=compress&cs=tinysrgb&w=800&v=2" 
                             alt="" 
                             class="h-full w-full object-cover group-hover:scale-110 transition duration-700"
                             onerror="handleImageError(this, 'metal')">
                    </div>
                    <div class="p-8">
                        <h3 class="font-bold text-xl text-[#475569] mb-2">庚・辛 (金)</h3>
                        <p class="text-sm leading-relaxed text-gray-600">強固な岩や鋭い鉄、<br>そして気高く光る宝石</p>
                    </div>
                </div>
            </div>
            
            <div class="mt-20 text-center max-w-3xl mx-auto">
                <p class="leading-loose text-lg md:text-xl text-[#3e4d44] tracking-wide">
                    命式を視覚的な「景色」としてイメージすることで、専門用語に詳しくなくても、<br class="hidden md:block">
                    <span class="border-b-2 border-yellow-200 font-bold px-1">「どうすれば自分自身が活き活き和やかに輝けるか」</span>が驚くほど直感的にわかるようになります。
                </p>
            </div>
        </div>
    </section>

    <!-- 3. ステップセクション -->
    <section class="py-24 md:py-32 px-6 bg-white border-b border-gray-50">
        <div class="max-w-4xl mx-auto">
            <h2 class="text-3xl font-bold mb-16 text-center tracking-widest leading-relaxed text-[#2d3a32]">「宿命」を知り、自ら「運命」を切り拓く</h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                <!-- Step 01 -->
                <div class="p-10 border border-gray-100 rounded-3xl bg-[#fcfdfc] shadow-sm">
                    <div class="text-[#7d9d85] mb-6 flex items-center gap-3 font-bold tracking-widest uppercase text-xs">ステップ 01</div>
                    <h4 class="font-bold text-xl mb-4 text-[#2d3a32]">五行バランスの分析</h4>
                    <p class="text-gray-600 text-sm leading-relaxed">
                        命式の景色が「暑すぎる」のか「寒すぎる」のか、あるいは「乾燥」しているのか。自然界の摂理に基づき、あなたの心の温度感を把握します。
                    </p>
                </div>
                <!-- Step 02 -->
                <div class="p-10 border border-gray-100 rounded-3xl bg-[#fcfdfc] shadow-sm">
                    <div class="text-[#7d9d85] mb-6 flex items-center gap-3 font-bold tracking-widest uppercase text-xs">ステップ 02</div>
                    <h4 class="font-bold text-xl mb-4 text-[#2d3a32]">通変星によるスタイル</h4>
                    <p class="text-gray-600 text-sm leading-relaxed">
                        あなたの「社会での活かし方」を分析します。特定の星がなくても、別の星の力を借りて自分らしく活躍する方法（スタイル論）を学びます。
                    </p>
                </div>
            </div>
            
            <!-- Step 03 (用神) -->
            <div class="p-8 md:p-12 bg-[#334139] text-white rounded-3xl flex flex-col md:flex-row items-center gap-10">
                <div class="w-full md:w-1/3 h-48 overflow-hidden rounded-2xl image-container shrink-0 text-center">
                    <img src="https://images.pexels.com/photos/618833/pexels-photo-618833.jpeg?auto=compress&cs=tinysrgb&w=800" 
                         alt="" 
                         class="h-full w-full object-cover"
                         onerror="handleImageError(this, 'mountain')">
                </div>
                <div class="w-full md:w-2/3">
                    <div class="text-green-300 mb-4 flex items-center gap-3 font-bold tracking-widest uppercase text-xs">ステップ 03</div>
                    <h4 class="font-bold text-xl mb-4 text-green-200 tracking-widest text-balance">「用神」という処方箋</h4>
                    <p class="opacity-90 leading-relaxed text-sm md:text-base">
                        足りない要素をどう補えば、景色がより美しく調和するのか。ただ当てるだけでなく、より良い人生を選ぶための具体的な「開運法」を導き出します。
                    </p>
                </div>
            </div>
        </div>
    </section>

    <!-- 言葉の呪いから自由になるために -->
    <section class="py-24 md:py-32 quote-bg text-white relative">
        <div class="max-w-4xl mx-auto px-6 text-center">
            <div class="inline-block mb-10 text-green-300">
                <svg class="w-12 h-12 opacity-50 mx-auto" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21L14.017 18C14.017 16.895 14.912 16 16.017 16H19.017C19.569 16 20.017 15.552 20.017 15V9C20.017 8.448 19.569 8 19.017 8H16.017C14.912 8 14.017 7.105 14.017 6V3L14.017 3H21.017V15C21.017 17.761 18.778 20 16.017 20L14.017 21ZM3.017 21L3.017 18C3.017 16.895 3.912 16 5.017 16H8.017C8.569 16 9.017 15.552 9.017 15V9C9.017 8.448 8.569 8 8.017 8H5.017C3.912 8 3.017 7.105 3.017 6V3L3.017 3H10.017V15C10.017 17.761 7.778 20 5.017 20L3.017 21Z"></path></svg>
            </div>
            <h2 class="text-2xl md:text-4xl font-bold mb-10 tracking-[0.1em] leading-snug text-balance">
                「言葉の呪い」から自由になるために
            </h2>
            <div class="space-y-8 text-lg opacity-90 leading-loose max-w-2xl mx-auto font-light text-balance text-center">
                <p>
                    占いの結果に一喜一憂し、自分を星の枠に当てはめて苦しくなってしまう。それは、あなたが本来持っている「無限の可能性」を、言葉という狭い箱に閉じ込めてしまっているからです。
                </p>
                <p>
                    <span class="font-bold text-green-300 text-center">自然の景色でみる四柱推命</span>が目指すのは、<br class="md:hidden">「納得感のある人生」。
                </p>
                <p>
                    自分の命式を美しい景色として眺めることができたとき、あなたは初めて、その景色をどう彩り、どの方向に歩いていくかを、自分自身の意思で決められるようになります。
                </p>
            </div>
            <div class="mt-16 text-green-400 font-bold tracking-[0.3em] text-sm italic uppercase">Freedom from Words</div>
        </div>
    </section>

    <!-- 講座カリキュラムの概要 -->
    <section id="plans" class="py-24 md:py-32 bg-[#f4f7f2]">
        <div class="max-w-7xl mx-auto px-6">
            <div class="text-center mb-20">
                <h2 class="text-3xl md:text-4xl font-bold mb-8 tracking-widest text-[#2d3a32]">講座内容のご案内</h2>
                <div class="w-20 h-1 bg-[#7d9d85] mx-auto mb-8"></div>
                <p class="text-gray-600 tracking-widest max-w-3xl mx-auto leading-loose text-lg text-balance">
                    難解な用語を暗記するのではなく、命式を「大自然の景色」として捉える感性を養いながら、着実にステップアップできる3段階の構成です。
                </p>
            </div>
            
            <div class="space-y-16 lg:space-y-24">
                <!-- 1. 入門講座 -->
                <div class="plan-card bg-white p-8 md:p-16 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <div class="flex flex-col lg:flex-row gap-12 md:gap-16">
                        <div class="w-full lg:w-1/3 shrink-0">
                            <div class="flex items-center gap-4 mb-6">
                                <span class="bg-[#7d9d85] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">ステップ 01</span>
                                <span class="text-[#7d9d85] font-bold tracking-widest text-sm italic">入門クラス</span>
                            </div>
                            <h3 class="text-3xl font-bold mb-6 text-[#2d3a32]">入門講座</h3>
                            <p class="text-[#7d9d85] font-bold mb-4">基礎の基礎を「景色」の視点で整える</p>
                            <p class="text-gray-500 text-sm leading-relaxed mb-8">
                                四柱推命の土台を学び、命式の各星がどのような自然界の要素に対応しているのかを理解するコースです。
                            </p>
                            <div class="p-6 bg-[#fcfdfc] rounded-2xl border border-gray-100">
                                <div class="text-[10px] text-[#7d9d85] mb-2 font-bold uppercase tracking-widest">受講形式</div>
                                <div class="text-[#334139] font-bold text-sm">90分 × 2回 / オンライン個人指導</div>
                            </div>
                        </div>

                        <div class="w-full lg:w-2/3 space-y-12">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left">
                                <div class="bg-green-50/50 p-8 rounded-3xl">
                                    <h4 class="font-bold text-sm text-[#7d9d85] mb-4 uppercase tracking-widest italic">目指すゴール</h4>
                                    <p class="text-gray-700 leading-relaxed font-bold text-sm text-left">命式の各星の出し方を理解し、四柱推命の基礎を完全に押さえる。</p>
                                </div>
                                <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                    <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic">受講特典</h4>
                                    <ul class="text-sm text-gray-700 space-y-2 text-left">
                                        <li>・講座動画のアーカイブ配布</li>
                                        <li>・期間中LINEでの質問無制限</li>
                                        <li>・各回ごとの演習課題付き</li>
                                    </ul>
                                </div>
                            </div>
                            <div class="border-t border-gray-100 pt-8">
                                <h4 class="text-xs text-gray-400 mb-6 uppercase tracking-widest">カリキュラムのポイント</h4>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                                    <div>
                                        <div class="font-bold mb-2 text-[#2d3a32] text-sm text-left">第1回：基礎理論</div>
                                        <p class="text-xs text-gray-500 leading-relaxed italic text-left">四柱推命の成り立ち、陰陽五行説、各エネルギーの理解と相関関係。</p>
                                    </div>
                                    <div>
                                        <div class="font-bold mb-2 text-[#2d3a32] text-sm text-left">第2回：干支と運気</div>
                                        <p class="text-xs text-gray-500 leading-relaxed italic text-left">十干・十二支、六十干支の景色、空亡の捉え方、十二運の導出。</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. 中級講座 -->
                <div class="plan-card bg-white p-8 md:p-16 rounded-[2.5rem] shadow-xl border-2 border-[#7d9d85]/10 relative overflow-hidden group">
                    <div class="absolute top-0 right-0 bg-[#7d9d85] text-white text-[10px] md:text-xs font-bold px-10 py-3 tracking-widest rounded-bl-3xl uppercase">おすすめのコース</div>
                    
                    <div class="flex flex-col lg:flex-row gap-12 md:gap-16">
                        <div class="w-full lg:w-1/3 shrink-0">
                            <div class="flex items-center gap-4 mb-6">
                                <span class="bg-[#7d9d85] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">ステップ 02</span>
                                <span class="text-[#7d9d85] font-bold tracking-widest text-sm italic">中級クラス</span>
                            </div>
                            <h3 class="text-3xl font-bold mb-6 text-[#2d3a32]">中級講座</h3>
                            <p class="text-[#7d9d85] font-bold mb-4">五行バランスから「運命の彩り」を解読する</p>
                            <p class="text-gray-500 text-sm leading-relaxed mb-8 text-balance">
                                8つの漢字をエネルギーの塊として捉え、バイオリズムや個性を景色として描けるようになるコースです。
                            </p>
                            <div class="p-6 bg-[#fcfdfc] rounded-2xl border border-gray-100 text-center">
                                <div class="text-[10px] text-[#7d9d85] mb-2 font-bold uppercase tracking-widest text-center">受講形式</div>
                                <div class="text-[#334139] font-bold text-sm text-center">2時間 × 15回 ＋ 質問会 / 個人指導</div>
                            </div>
                        </div>

                        <div class="w-full lg:w-2/3 space-y-12">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left">
                                <div class="bg-green-50/50 p-8 rounded-3xl text-left">
                                    <h4 class="font-bold text-sm text-[#7d9d85] mb-4 uppercase tracking-widest italic">目指すゴール</h4>
                                    <p class="text-gray-700 leading-relaxed font-bold text-sm text-balance text-left text-left">五行バランスから、生まれ持った本来の景色と運気の流れを解読できるようになる。</p>
                                </div>
                                <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                    <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic">受講特典</h4>
                                    <ul class="text-sm text-gray-700 space-y-2 font-bold text-left">
                                        <li>・毎月開催されるオンライン勉強会への参加権</li>
                                        <li class="text-[#7d9d85]">・LINEによる無期限の質問・相談サポート</li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div class="border-t border-gray-100 pt-8">
                                <h4 class="text-xs text-gray-400 mb-6 uppercase tracking-widest text-left">学習のステップ</h4>
                                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 text-center">
                                    <div class="p-5 bg-gray-50 rounded-2xl relative step-arrow">
                                        <div class="text-[10px] text-[#7d9d85] font-bold mb-2">ステップ 01</div>
                                        <p class="text-[11px] font-bold text-gray-700">鑑定の土台作り</p>
                                    </div>
                                    <div class="p-5 bg-gray-50 rounded-2xl relative step-arrow">
                                        <div class="text-[10px] text-[#7d9d85] font-bold mb-2">ステップ 02</div>
                                        <p class="text-[11px] font-bold text-gray-700">エネルギーの変化</p>
                                    </div>
                                    <div class="p-5 bg-gray-50 rounded-2xl relative step-arrow text-center">
                                        <div class="text-[10px] text-[#7d9d85] font-bold mb-2 text-center">ステップ 03</div>
                                        <p class="text-[11px] font-bold text-gray-700">格付け・用神導出</p>
                                    </div>
                                    <div class="p-5 bg-gray-50 rounded-2xl">
                                        <div class="text-[10px] text-[#7d9d85] font-bold mb-2">ステップ 04</div>
                                        <p class="text-[11px] font-bold text-gray-700">大運・年運解読</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 3. 上級講座 -->
                <div class="plan-card bg-white p-8 md:p-16 rounded-[3rem] shadow-sm border border-gray-100">
                    <div class="flex flex-col lg:flex-row gap-12 md:gap-16">
                        <div class="w-full lg:w-1/3 shrink-0">
                            <div class="flex items-center gap-4 mb-6">
                                <span class="bg-[#2d3a32] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">ステップ 03</span>
                                <span class="text-[#2d3a32] font-bold tracking-widest text-sm italic">上級クラス</span>
                            </div>
                            <h3 class="text-3xl font-bold mb-6 text-[#2d3a32]">上級講座</h3>
                            <p class="text-[#7d9d85] font-bold mb-4 text-left">鑑定を「生き方の戦略」へと昇華させる</p>
                            <p class="text-gray-500 text-sm leading-relaxed mb-8 text-left">
                                景色をさらに深掘りし、仕事・恋愛・相性など、具体的な悩みに対応できるプロの視点を養うコースです。
                            </p>
                            <div class="p-6 bg-[#fcfdfc] rounded-2xl border border-gray-100 text-center">
                                <div class="text-[10px] text-[#2d3a32]/60 mb-2 font-bold uppercase tracking-widest text-center">受講形式</div>
                                <div class="text-[#334139] font-bold text-sm text-center">2時間 × 18回 ＋ 質問会 / 個人指導</div>
                            </div>
                        </div>

                        <div class="w-full lg:w-2/3 space-y-12">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left">
                                <div class="bg-gray-50 p-8 rounded-3xl text-left">
                                    <h4 class="font-bold text-sm text-[#2d3a32] mb-4 uppercase tracking-widest italic text-left">目指すゴール</h4>
                                    <p class="text-gray-700 leading-relaxed font-bold text-sm text-left">「五行バランス×命式の景色」を融合させ、深い次元での鑑定と戦略的開運が可能になる。</p>
                                </div>
                                <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                    <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic text-left">受講特典</h4>
                                    <ul class="text-sm text-gray-700 space-y-2 font-bold text-left text-left text-left">
                                        <li>・毎月開催されるオンライン勉強会への参加権</li>
                                        <li class="text-[#7d9d85]">・LINEによる無期限の質問・相談サポート</li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div class="border-t border-gray-100 pt-8">
                                <h4 class="text-xs text-gray-400 mb-6 uppercase tracking-widest text-left text-left">専門カリキュラムの内容</h4>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                                    <div class="bg-gray-50/50 p-5 rounded-2xl text-left text-left">
                                        <div class="font-bold mb-2 text-[#2d3a32] text-sm underline decoration-[#7d9d85]/30 text-left">高度な推命理論</div>
                                        <p class="text-[11px] text-gray-500 leading-relaxed italic text-balance text-left text-left">十干百態論、五行の偏りによる調整法の実践学習。</p>
                                    </div>
                                    <div class="bg-gray-50/50 p-5 rounded-2xl text-left">
                                        <div class="font-bold mb-2 text-[#2d3a32] text-sm underline decoration-[#7d9d85]/30 text-left text-left">実践鑑定テーマ</div>
                                        <p class="text-[11px] text-gray-500 leading-relaxed italic text-balance text-left text-left">ビジネス運、恋愛・結婚、対人相性の奥義解明。</p>
                                    </div>
                                    <div class="bg-gray-50/50 p-5 rounded-2xl text-left">
                                        <div class="font-bold mb-2 text-[#2d3a32] text-sm underline decoration-[#7d9d85]/30 text-left text-left">開運の極意</div>
                                        <p class="text-[11px] text-gray-500 leading-relaxed italic text-balance text-left text-left text-left text-left text-left">スタイル論による、一人ひとりに最適な戦略。 </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 共通の安心サポート -->
            <div class="mt-32 p-10 md:p-20 bg-[#334139] text-white rounded-[3rem] md:rounded-[4rem] shadow-2xl relative overflow-hidden">
                <div class="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full -mr-32 -mt-32 text-center"></div>
                <div class="relative z-10">
                    <div class="text-center mb-16 px-4">
                        <h3 class="text-2xl md:text-3xl font-bold mb-4 tracking-[0.2em] text-center">全コース共通の安心サポート</h3>
                        <p class="text-green-200/60 text-xs md:text-sm tracking-widest uppercase italic text-center">Support System</p>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16 text-center">
                        <div class="flex flex-col items-center text-center px-4">
                            <div class="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-8 border border-white/20 text-center">
                                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                            </div>
                            <h4 class="font-bold mb-4 text-xl tracking-widest text-center">マンツーマン指導</h4>
                            <p class="text-sm opacity-80 leading-loose max-w-xs text-balance text-center">個別の理解度に合わせて丁寧に進めるため、初めての方でも安心です。</p>
                        </div>
                        <div class="flex flex-col items-center text-center px-4">
                            <div class="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-8 border border-white/20 text-center">
                                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                            <h4 class="font-bold mb-4 text-xl tracking-widest text-center">復習用アーカイブ</h4>
                            <p class="text-sm opacity-80 leading-loose max-w-xs text-balance text-center text-center">講義の動画をすべてお渡しします。ご自身のペースで何度でも復習できます。</p>
                        </div>
                        <div class="flex flex-col items-center text-center px-4">
                            <div class="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-8 border border-white/20 text-center text-center text-center text-center text-center">
                                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            </div>
                            <h4 class="font-bold mb-4 text-xl tracking-widest text-center text-center text-center text-center text-center">実践的な添削課題</h4>
                            <p class="text-sm opacity-80 leading-loose max-w-xs text-balance text-center text-center text-center text-center">実際の命式を使った課題を通じて、本物の読み解く力を確実に身につけます。</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Footer -->
    <footer class="pt-32 pb-20 bg-[#2d3a32] text-white text-center px-6">
        <div class="max-w-4xl mx-auto px-4 text-center">
            <h2 class="text-2xl md:text-3xl mb-16 italic leading-relaxed tracking-widest font-light text-balance text-center">
                「答えは、常に自分の中にある」<br>
                <span class="text-lg md:text-xl mt-4 block opacity-80 not-italic tracking-wide text-center text-center">暗闇の中を手探りで歩くような不安を感じたとき、<br class="hidden md:block">四柱推命の「景色」は、次の一歩を進む勇気を与えてくれるはずです。</span>
            </h2>
            <div class="h-[1px] w-24 bg-white/30 mx-auto mb-16 text-center text-center"></div>
            <a href="/contact" class="inline-block bg-white text-[#2d3a32] hover:bg-[#7d9d85] hover:text-white px-16 py-6 rounded-full shadow-2xl transition duration-500 tracking-[0.2em] font-bold uppercase text-sm mb-20 text-center">
                無料講座説明会に参加する
            </a>
            <p class="text-xs opacity-40 tracking-widest uppercase text-center">&copy; 縁らぼ (Fuchi Labo). 大自然の叡智を、あなたの人生に。</p>
        </div>
    </footer>

</body>
</html>`;
}

function renderCanvaAiCoursePage() {
  const content = `
    <section class="ai-course-page">
      <div class="ai-course-hero" style="background-image: url('/uploads/images/ai-course-hero.jpg');">
      </div>

      <div class="ai-course-body">
        <div class="ai-course-meta">
          <div class="ai-course-meta-item">
            <div class="ai-course-meta-label">期間</div>
            <div class="ai-course-meta-value">4週間</div>
          </div>
          <div class="ai-course-meta-item">
            <div class="ai-course-meta-label">形式</div>
            <div class="ai-course-meta-value">zoom講座＋LINEフォロー</div>
          </div>
          <div class="ai-course-meta-item">
            <div class="ai-course-meta-label">ゴール</div>
            <div class="ai-course-meta-value">鑑定に使える「命式の景色画像」を自分で作れるようになる</div>
          </div>
        </div>

        <p class="ai-course-note">以下は、実際の講座スケジュール内容です</p>

        <div class="ai-course-section">
          <h2 class="ai-course-section-heading">WEEK0　事前準備</h2>
          <div class="ai-course-section-body">
            <ul>
              <li>Canvaインストール、ログイン（資料お渡し）</li>
              <li>講座のロードマップ提示</li>
            </ul>
          </div>
        </div>

        <div class="ai-course-section">
          <h2 class="ai-course-section-heading">WEEK1−2　Canva AI基本操作</h2>
          <div class="ai-course-section-body">
            <p class="ai-course-section-lead">zoom講座① 120分</p>
            <p>Canvaで意図した画像を“再現性をもって”作れる</p>
            <ul>
              <li>Canva AIとはなにか？</li>
              <li>画像生成の基本構造</li>
              <li>プロンプトの書き方、考え方</li>
              <li>実演</li>
              <li>思い通りにいかないときの対処法</li>
              <li>六十干支を作るための必要情報</li>
            </ul>
            <p class="ai-course-section-foot">
              【課題】<br />
              六十干支の画像作ってみる<br />
              →完成した画像とプロンプトをLINEにて添削
            </p>
          </div>
        </div>

        <div class="ai-course-section">
          <h2 class="ai-course-section-heading">WEEK3−4　命式八文字で画像作成</h2>
          <div class="ai-course-section-body">
            <p class="ai-course-section-lead">zoom講座② 90分</p>
            <p>八字全体を“1枚の景色”として表現できる</p>
            <ul>
              <li>景色化の優先順位</li>
              <li>八字全体を構成する「3つの層」</li>
              <li>十二支は“足す”のではなく“引く”</li>
              <li>実演</li>
            </ul>
            <p class="ai-course-section-foot">
              【課題】<br />
              自分や家族の命式で作ってみる<br />
              →完成した画像とプロンプトをLINEにて添削
            </p>
          </div>
        </div>

        <div class="ai-course-section">
          <h2 class="ai-course-section-heading">講座終了時</h2>
          <div class="ai-course-section-body">
            <p class="ai-course-section-lead">zoom MT③ 30分</p>
            <p>振り返り</p>
            <ul>
              <li>この４週間でやったことの整理</li>
              <li>鑑定での画像活用法</li>
              <li>五行バランス概要</li>
            </ul>
          </div>
        </div>

        <div class="ai-course-footer" style="background-image: url('/uploads/images/ai-course-footer.jpg');">
          <div class="ai-course-footer-inner"></div>
        </div>
        <a class="ai-course-cta-image" href="https://forms.gle/ks5WxwCXbzaeu6k29" target="_blank" rel="noopener noreferrer">
          <img src="/uploads/images/ai-course-cta.png" alt="Canva AIでつくる四柱推命の景色講座に申し込む" loading="lazy" />
        </a>
      </div>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

async function sendContactToSheets(contact) {
  if (!sheetsWebhookUrl) return;

  const payload = {
    kind: 'contact',
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    orderNumber: contact.orderNumber || '',
    message: contact.message || '',
    createdAt: contact.createdAt || new Date().toISOString(),
  };

  try {
    await fetch(sheetsWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Failed to send contact to Google Sheets webhook', e);
  }
}

// /admin 配下を保護するための簡易Basic認証
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'fuchilabo2025';

function ensureAdminAuth(req, res, parsedUrl) {
  if (!parsedUrl.pathname.startsWith('/admin')) {
    return true;
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Basic ') ? auth.slice(6) : '';
  let user = '';
  let pass = '';

  if (token) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      user = parts[0] || '';
      pass = parts[1] || '';
    } catch (e) {
      // 無効なヘッダは無視して認証エラー扱い
    }
  }

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return true;
  }

  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Admin Area"',
  });
  res.end('<p>管理ページにアクセスするにはログインが必要です。</p>');
  return false;
}

function serveStaticFile(req, res) {
  const parsedUrl = url.parse(req.url);
  const safePath = path.normalize(parsedUrl.pathname).replace(/^\/+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const contentTypeMap = {
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
  return true;
}

// Persistent Disk 上の画像 (/uploads/images/...) を配信する
function serveUploadedImage(req, res) {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname || '';
  if (!pathname.startsWith('/uploads/images/')) {
    return false;
  }

  let fileName;
  try {
    fileName = path.basename(decodeURIComponent(pathname));
  } catch (e) {
    // 不正なエンコードの場合は配信不可
    return false;
  }
  const filePath = path.join(imagesStorageDir, fileName);

  if (!filePath.startsWith(imagesStorageDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function parseScheduleText(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      const date = idx === -1 ? line : line.slice(0, idx);
      const times = idx === -1 ? '' : line.slice(idx + 1);
      // 時刻は "09:00" と "9:00" が混在していても同一とみなし、常に "H:MM" 形式に正規化し、数値順にソートする
      const slots = (times || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const m = t.match(/^(\d{1,2}):(\d{2})$/);
          if (!m) return t; // 想定外フォーマットはそのまま
          const h = String(parseInt(m[1], 10));
          return `${h}:${m[2]}`;
        })
        .sort((a, b) => {
          const ha = parseInt(a.split(':')[0], 10) || 0;
          const hb = parseInt(b.split(':')[0], 10) || 0;
          return ha - hb;
        });
      return { date: date.trim(), slots };
    });
}

function saveContactMessage(contact) {
  try {
    fs.mkdirSync(path.dirname(contactsStorePath), { recursive: true });
    let all = [];
    if (fs.existsSync(contactsStorePath)) {
      const raw = fs.readFileSync(contactsStorePath, 'utf-8');
      all = JSON.parse(raw || '[]');
    }
    all.push(contact);
    fs.writeFileSync(contactsStorePath, JSON.stringify(all, null, 2));
  } catch (e) {
    console.error('Failed to save contact message', e);
  }
}

function saveContactOutbox(contact) {
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    const lines = [
      '【お問い合わせ】',
      '',
      `■ お名前: ${contact.name || ''}`,
      `■ メールアドレス: ${contact.email || ''}`,
      `■ 電話番号: ${contact.phone || ''}`,
      `■ オーダー番号: ${contact.orderNumber || ''}`,
      '',
      '▼ お問い合わせ内容',
      contact.message || '',
      '',
      `受信日時: ${contact.createdAt || new Date().toISOString()}`,
    ].join('\n');

    const filePath = path.join(outboxDir, `contact-${Date.now()}.txt`);
    fs.writeFileSync(filePath, lines, 'utf-8');
  } catch (e) {
    console.error('Failed to save contact outbox message', e);
  }
}

function renderHomePage() {
  const products = getProducts()
    .slice()
    .sort((a, b) => {
      const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 9999;
      const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || '').localeCompare(b.title || '');
    });

  // 鑑定士ごとに代表商品を1件ずつ取得
  const tetsuyaProduct = products.find((p) => p.personId === 'tetsuya');
  const chigusaProduct = products.find((p) => p.personId === 'chigusa');

  const featured = [
    tetsuyaProduct && { personId: 'tetsuya', product: tetsuyaProduct },
    chigusaProduct && { personId: 'chigusa', product: chigusaProduct },
  ].filter(Boolean);

  const cards = featured
    .map(({ personId, product }) => {
      const listPath = `/products/${personId}`;
      const imageSrc =
        personId === 'tetsuya'
          ? '/uploads/images/tetsu-top.jpg'
          : personId === 'chigusa'
          ? '/uploads/images/chigusa-top.jpg'
          : product.image;
      return `
      <a class="product-card" href="${listPath}">
        <img class="person-card-image" src="${imageSrc}" alt="${product.title}" loading="lazy" />
      </a>
    `;
    })
    .join('');

  const content = `
    <div style="max-width: 900px; margin: 0 auto 1.5rem; text-align: center;">
      <p style="font-size: 0.95rem; color: #4b5563;">鑑定士を選んで、メニュー一覧をご覧ください。</p>
    </div>
    <div class="cards-grid">${cards}</div>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderContactPage(errors, body) {
  const safe = (v) => (v == null ? '' : String(v));
  const name = safe(body && body.name);
  const email = safe(body && body.email);
  const phone = safe(body && body.phone);
  const orderNumber = safe(body && body.orderNumber);
  const message = safe(body && body.message);

  const errorText = errors && errors.length ? `<p style="color:#dc2626;">入力内容をご確認ください。</p>` : '';

  const content = `
    <section style="max-width: 720px; margin: 0 auto;">
      <div class="panel">
        <h3>お問い合わせ</h3>
        <p>鑑定や講座に関するご質問、ご不明点などがありましたら、こちらのフォームからお送りください。</p>
        ${errorText}
        <form class="reservation-form" method="POST" action="/contact">
          <div class="field">
            <label for="name">お名前<span style="color:#dc2626;">（必須）</span></label>
            <input id="name" name="name" type="text" value="${name}" required />
          </div>
          <div class="field">
            <label for="email">メールアドレス<span style="color:#dc2626;">（必須）</span></label>
            <input id="email" name="email" type="email" value="${email}" required />
          </div>
          <div class="field">
            <label for="phone">電話番号</label>
            <input id="phone" name="phone" type="tel" value="${phone}" placeholder="08012345678" />
          </div>
          <div class="field">
            <label for="message">お問い合わせ内容<span style="color:#dc2626;">（必須）</span></label>
            <textarea id="message" name="message" required>${message}</textarea>
          </div>
          <div class="field">
            <label style="font-weight:400;">
              <input type="checkbox" name="agree" value="yes" ${body && body.agree ? 'checked' : ''} />
              利用規約およびプライバシーポリシーに同意する（必須）
            </label>
            <small>
              <a href="/terms" target="_blank" rel="noopener noreferrer">利用規約</a> と
              <a href="/privacy" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a> をご確認ください。
            </small>
          </div>
          <button class="button" type="submit">送信する</button>
        </form>
      </div>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderContactComplete(body) {
  const safe = (v) => (v == null ? '' : String(v));
  const rows = [
    ['お名前', safe(body.name)],
    ['メールアドレス', safe(body.email)],
    ['電話番号', safe(body.phone) || '未入力'],
  ]
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
      <h3>お問い合わせを送信しました</h3>
      <p>内容を確認のうえ、通常3営業日以内にご返信いたします。</p>
      <table class="schedule-table"><tbody>${rows}</tbody></table>
      <div>
        <strong>お問い合わせ内容</strong>
        <p>${safe(body.message)}</p>
      </div>
      <a class="button secondary" href="/">トップへ戻る</a>
    </div>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/', hideHeading: true });
}

function renderReservationConfirmPage(reservation) {
  const amount =
    typeof reservation.displayPrice === 'number' && reservation.displayPrice > 0
      ? reservation.displayPrice
      : typeof reservation.price === 'number'
      ? reservation.price
      : 0;
  const amountText = amount > 0 ? formatCurrency(reservation.currency || '¥', amount) : '未入力';

  const rows = [
    ['商品', reservation.productTitle],
    ['日時', `${reservation.date} ${reservation.timeSlot}`],
    ['お名前', reservation.name],
    ['メール', reservation.email],
    ['生年月日', reservation.birthday || '未入力'],
    ['性別（出生時）', reservation.genderAtBirth || '未入力'],
    ['生まれ時間', reservation.birthTime || '未入力'],
    ['出身地', reservation.birthPlace || '未入力'],
    ['お支払方法',
      reservation.paymentMethod === 'bank'
        ? '銀行振込（振込手数料はお客様のご負担となります）'
        : reservation.paymentMethod === 'paypal'
        ? 'PAYPAL'
        : '未入力',
    ],
    ['金額', amountText],
    reservation.compatibilityOptionEnabled
      ? ['相性鑑定オプション', `追加人数：${reservation.compatibilityOptionCount}名 / 追加料金：${formatCurrency(reservation.currency || '¥', reservation.compatibilityTotalPrice || 0)}`]
      : null,
  ]
    .filter(Boolean)
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
      <div style="margin-bottom:1rem;">
        <ol style="display:flex; gap:0.5rem; list-style:none; padding:0; margin:0; font-size:0.9rem; align-items:center; justify-content:center;">
          <li style="display:flex; align-items:center; gap:0.25rem; opacity:0.6;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; border:1px solid #9ca3af; font-size:0.8rem;">1</span>
            <span>情報入力</span>
          </li>
          <li style="flex:0 0 1.5rem; height:2px; background:linear-gradient(to right,#9ca3af,#4b5563);"></li>
          <li style="display:flex; align-items:center; gap:0.25rem; font-weight:bold; color:#16a34a;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; background-color:#bbf7d0; color:#14532d; font-size:0.8rem;">2</span>
            <span>確認</span>
          </li>
          <li style="flex:0 0 1.5rem; height:2px; background:#e5e7eb;"></li>
          <li style="display:flex; align-items:center; gap:0.25rem; opacity:0.6;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; border:1px solid #9ca3af; font-size:0.8rem;">3</span>
            <span>完了</span>
          </li>
        </ol>
      </div>
      <h3>入力内容の確認</h3>
      <p>以下の内容で予約を受け付けます。内容をご確認のうえ、「この内容で予約を確定する」ボタンを押してください。</p>
      <table class="schedule-table"><tbody>${rows}</tbody></table>
      <div>
        <strong>ご要望・メモ</strong>
        <p>${reservation.notes || '（未入力）'}</p>
      </div>
      <form method="POST" action="/reserve" style="margin-top: 1.5rem;">
        <input type="hidden" name="productId" value="${reservation.productId}" />
        <input type="hidden" name="personId" value="${reservation.personId || ''}" />
        <input type="hidden" name="date" value="${reservation.date}" />
        <input type="hidden" name="timeSlot" value="${reservation.timeSlot}" />
        <input type="hidden" name="sessionType" value="${reservation.sessionType || ''}" />
        <input type="hidden" name="name" value="${reservation.name}" />
        <input type="hidden" name="email" value="${reservation.email}" />
        <input type="hidden" name="birthday" value="${reservation.birthday || ''}" />
        <input type="hidden" name="genderAtBirth" value="${reservation.genderAtBirth || ''}" />
        <input type="hidden" name="birthTime" value="${reservation.birthTime || ''}" />
        <input type="hidden" name="birthPlace" value="${reservation.birthPlace || ''}" />
        <input type="hidden" name="paymentMethod" value="${reservation.paymentMethod || ''}" />
        <input type="hidden" name="compatibilityOptionEnabled" value="${reservation.compatibilityOptionEnabled ? '1' : ''}" />
        <input type="hidden" name="compatibilityOptionCount" value="${reservation.compatibilityOptionCount || 0}" />
        <input type="hidden" name="notes" value="${reservation.notes || ''}" />
        <div style="display:flex; gap: 0.75rem; flex-wrap: wrap;">
          <button class="button" type="submit">この内容で予約を確定する</button>
          <button class="button secondary" type="button" onclick="history.back()">入力画面に戻る</button>
        </div>
      </form>
    </div>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/', hideHeading: true });
}

function renderAdminSchedulesPage(options) {
  const showSaved = options && options.saved;
  const schedules = getSchedules();
  const tetsuya = schedules.find((p) => p.personId === 'tetsuya');
  const chigusa = schedules.find((p) => p.personId === 'chigusa');

  const toText = (entry) =>
    (entry && Array.isArray(entry.schedule)
      ? entry.schedule
          .map((d) => `${d.date}:${(d.slots || []).join(',')}`)
          .join('\n')
      : '');

  const tetsuyaText = toText(tetsuya);
  const chigusaText = toText(chigusa);

  const content = `
    <div class="panel">
      ${showSaved ? '<p style="color:#16a34a; margin-bottom:1rem;">予約枠を保存しました。</p>' : ''}
      <h3>予約枠の編集（管理画面）</h3>
      <p>カレンダーと時間帯（1時間枠）のチェックボックスで、てつ先生／ちぐさ の予約枠を編集できます。保存すると商品ページに反映されます。</p>
      <form method="POST" action="/admin/schedules" class="reservation-form">
        <div id="scheduleApp"></div>
        <!-- 既存ロジックとの互換性のため、テキスト形式も hidden で保持 -->
        <textarea id="tetsuyaSchedule" name="tetsuyaSchedule" rows="6" style="display:none;">${tetsuyaText}</textarea>
        <textarea id="chigusaSchedule" name="chigusaSchedule" rows="6" style="display:none;">${chigusaText}</textarea>
        <button class="button" type="submit">保存する</button>
        <a class="button secondary" href="/admin" style="margin-left:0.5rem;">商品一覧へ戻る</a>
      </form>
    </div>
    <script src="/admin-schedules.js"></script>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/admin', hideHeading: true });
}

function renderLegalPage() {
  const content = `
    <section style="max-width: 720px; margin: 0 auto;">
      <h2 style="font-size: 1.4rem; margin-bottom: 1rem;">特定商取引法に関する表記</h2>
      <p style="line-height: 1.8; white-space: pre-line;">
特定商取引法に基づく表記
販売事業者

ふちLABO.

運営統括責任者
大渕 哲也／大渕 千草

所在地
〒450-0002
愛知県名古屋市中村区名駅3-4-10 アルティメイト名駅1st　2階

電話番号
05030998112
（平日 10:00〜18:00）
※営業・勧誘のお電話はご遠慮ください。
※お問い合わせは原則としてお問い合わせフォームまたはメールにてお願いいたします。

連絡先メールアドレス
info@fuchilabo.com

営業時間
平日 10:00〜18:00（不定休）

販売価格
各商品・サービスページに記載の金額（消費税込）とします。
※別途、配送料が発生する場合があります（該当商品ページに記載）。

商品代金以外の必要料金
・銀行振込の場合、振込手数料はお客様のご負担となります。
・配送が必要な商品については、別途配送料が発生する場合があります。

お支払い方法
①銀行振込
②PayPal（クレジットカード等）
※決済方法の詳細および振込先情報は、WEB申込み後に当方よりメールにてご案内いたします。

お支払い時期・支払期限
・銀行振込：当方からのご案内メールに記載された期日までにお支払いください。
・PayPal：ご注文時点でお支払いが確定します。
※支払期限を過ぎた場合、申込みは自動的にキャンセルとなる場合があります。

役務・商品の提供時期
・鑑定／オンライン講座／動画コンテンツ／会員制サービス：
	各商品ページまたは申込み後のご案内メールに記載の方法・時期に従い提供します。
・イベント・セミナー：
	開催日時・参加方法は各案内ページおよび申込み後のメールにてご案内します。
・配送商品（書籍等）：
	ご入金確認後、原則7日以内に発送いたします（予約商品を除く）。

キャンセル・返品（返金）について
・鑑定・オンライン講座・動画コンテンツ等のデジタルサービスは、性質上、原則として申込み後のキャンセル・返金には応じておりません。
・イベント・セミナーについては、各案内ページまたは申込み後メールに記載のキャンセルポリシーに従います。
・配送商品については、商品に欠陥がある場合を除き、返品には応じません。
      </p>
      <p style="font-size: 0.85rem; color: #6b7280; margin-top: 1.5rem;">
        あわせて <a href="/terms">利用規約</a> および <a href="/privacy">プライバシーポリシー</a> もご確認ください。
      </p>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderTermsPage() {
  const content = `
    <section style="max-width: 720px; margin: 0 auto;">
      <h2 style="font-size: 1.4rem; margin-bottom: 1rem;">利用規約</h2>
      <p style="line-height: 1.8; white-space: pre-line;">
本利用規約（以下「本規約」といいます。）は、ふちLABO.（以下「当方」といいます。）が提供する各種サービスの利用条件を定めるものです。

第1章　総則
第1条【定義】
本規約において使用する用語の定義は、以下のとおりとします。

本規約
	ふちLABO.利用規約
当方
	ふちLABO.
本サービス
	当方がインターネットを通じて提供する以下のサービス
	・四柱推命・占星術に関する鑑定
	・オンライン講座・動画配信
	・月額制（サブスクリプション）サービス
	・会員制コミュニティ
	・イベント・セミナー
	・書籍、デジタルコンテンツ
	・その他当方が提供する関連サービス
利用者
	本規約およびプライバシーポリシーに同意のうえ、本サービスを利用するすべての者
購入者
	本サービスにおいて有料サービスの申込み・購入を行った利用者
会員
	サブスクリプションサービスまたはコミュニティに登録した利用者

第2条【本規約の適用】
利用者は、本サービスを利用した時点で、本規約に同意したものとみなします。

第3条【本規約の変更】
当方は、必要に応じて本規約を変更できるものとし、変更後の利用をもって同意したものとみなします。

第2章　申込み・契約
第4条【サービスの申込み】
利用者は、当方が定める方法により本サービスへ申込みを行うものとします。
当方から申込み完了または決済完了の通知が行われた時点で、契約が成立します。
不正行為または不適切な行為が認められた場合、当方は契約を取消・解除できるものとします。
未成年者は、法定代理人の同意を得た場合に限り利用できます。

第5条【登録情報】
利用者は、登録情報に変更が生じた場合、速やかに当方へ連絡するものとします。

第6条【支払方法】
支払金額は、表示価格および消費税等を含む金額とします。
支払方法は、当方が指定する決済方法に限ります。
決済会社との紛争は、利用者と当該決済会社の間で解決するものとします。

第7条【キャンセル・返金】
鑑定、オンライン講座、動画コンテンツ、サブスクリプションサービスは、性質上、原則として返金・キャンセルは行いません。
イベント・セミナーについては、別途定めるキャンセルポリシーに従うものとします。

第3章　サブスクリプション・会員サービス
第8条【サブスクリプション】
会員は、契約期間中、本サービスを利用することができます。
解約は、当方が定める方法により行うものとし、日割り・月割りでの返金は行いません。
決済不履行が発生した場合、当方は利用停止または契約解除を行うことができます。

第9条【コミュニティ運営】
会員は、他の会員および当方を尊重し、良識ある行動を行うものとします。
以下の行為を禁止します。
	・誹謗中傷、迷惑行為
	・勧誘、営業、宗教・政治活動
	・コミュニティ内容の無断転載・共有
当方は、違反行為がある場合、事前通知なく投稿削除・利用停止・退会処分を行うことができます。

第4章　利用上の責務
第10条【禁止事項】
利用者および購入者は、以下の行為を行ってはなりません。
本サービスの内容を第三者へ無断で転載・共有・販売する行為
講座資料・動画・鑑定内容の録音・録画・二次利用
当方または第三者の権利を侵害する行為
公序良俗または法令に反する行為
本サービスの運営を妨害する行為
その他当方が不適切と判断する行為

第5章　免責事項
第11条【免責】
本サービスは、特定の結果や効果を保証するものではありません。
鑑定・講座内容は、自己理解および意思決定の参考情報であり、最終的な判断・行動は利用者自身の責任において行うものとします。
本サービスの利用により生じた損害について、当方は法令により認められる範囲で責任を制限します。

第6章　知的財産権
第12条【著作権】
本サービスに関するすべてのコンテンツの著作権は、当方または正当な権利者に帰属します。

第7章　雑則
第13条【準拠法】
本規約は、日本法を準拠法とします。

第14条【管轄裁判所】
本規約に関する紛争については、当方所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
      </p>
      <p style="font-size: 0.85rem; color: #6b7280; margin-top: 1.5rem;">
        個人情報の取扱いについては <a href="/privacy">プライバシーポリシー</a> を、
        事業者情報や返品・キャンセルについては <a href="/legal">特定商取引法に関する表記</a> をご参照ください。
      </p>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderPrivacyPage() {
  const content = `
    <section style="max-width: 720px; margin: 0 auto;">
      <h2 style="font-size: 1.4rem; margin-bottom: 1rem;">プライバシーポリシー</h2>
      <p style="line-height: 1.8; white-space: pre-line;">
プライバシーポリシー
1. はじめに

ふちLABO.（以下「当方」といいます。）は、当方が提供する各種サービス（四柱推命・占星術に関する鑑定、講座、動画配信、イベント、書籍、会員制サービス等）をご利用いただくにあたり、個人情報の保護に関する法律（以下「個人情報保護法」といいます。）第2条第1項に定義される個人情報その他のお客様に関する情報（以下「お客様情報」といいます。）を取得することがあります。

当方は、個人情報保護法その他関連法令およびガイドラインを遵守し、本プライバシーポリシーに従ってお客様情報を適切に取り扱います。

2. 適用対象
本プライバシーポリシーは、お客様が当方の提供するすべてのサービスを利用する際に取得されるお客様情報に適用されます。

3. 当方が取得するお客様情報
当方は、以下の方法によりお客様情報を取得します。
お客様がサービス申込み時に直接入力する方法
お問い合わせ、電子メール、書面、電話等による提供
サービス利用・閲覧時に自動的に取得される情報

(1) サービス申込み・購入時に取得する情報
氏名、住所、職業等の基本情報
電話番号、メールアドレス等の連絡先情報
決済に関する情報（決済事業者を通じて取得される情報を含みます）
講座、鑑定、動画、イベント等の申込み・利用履歴

(2) サービス利用時に取得する情報
クッキー（Cookie）、IPアドレス
端末情報、ブラウザ情報、閲覧履歴
利用日時、ページ閲覧時間等のアクセスログ

(3) アンケート等により取得する情報
サービスに関するご意見・ご要望
利用満足度等のアンケート回答内容

4. 利用目的
当方は、お客様情報を以下の目的で利用します。

(1) サービス提供・運営のため
鑑定、講座、動画配信、イベント等の提供
申込み内容の確認、連絡、決済処理
お問い合わせ対応

(2) サービス改善・新企画のため
サービス品質の向上
新サービス・コンテンツの企画、研究開発

(3) 情報提供・ご案内のため
講座、イベント、新サービス等の案内
メールマガジン、キャンペーンの案内
規約変更等の重要なお知らせ

(4) 広告・マーケティングのため
広告の配信、表示、効果測定
利用状況の分析

(5) 管理・安全確保のため
利用規約違反への対応
不正行為・トラブル防止
安全なサービス運営の確保

5. お客様情報の第三者提供・委託
当方は、以下の場合に限り、お客様情報を第三者に提供または委託することがあります。
決済処理、メール配信、システム運用等を委託する業務委託先
広告配信、アクセス解析等を行う提携事業者
事業承継（合併、事業譲渡等）が行われる場合
法令に基づく要請があった場合
不正利用防止（EMV 3-Dセキュア等）のためカード発行会社へ提供する場合

6. 管理
当方は、お客様情報への不正アクセス、漏えい、滅失、改ざん等を防止するため、合理的な安全管理措置を講じます。
また、当方は、予約・お申込みおよびお問い合わせに関する情報（氏名、連絡先、鑑定日程、決済方法に関する情報等）を、原則として取得日から5年間保存します。上記期間を経過した情報については、法令上の保存義務がある場合を除き、適切な方法により削除または匿名化いたします。また、利用目的の達成に不要となった情報は、上記期間内であっても速やかに削除または匿名化する場合があります。
当方は、サービスの提供およびデータの保管・メール送信等のため、Render、Google スプレッドシート、Google Apps Script、Gmail その他クラウドサービス事業者を利用する場合があります。これらの事業者は当方から委託を受けてお客様情報を取り扱うものであり、当方は必要かつ適切な範囲で監督を行います。

7. Googleアナリティクスおよびクッキーの利用
当方は、サービス向上および利用状況分析のため、Googleアナリティクスを利用する場合があります。
また、利便性向上および広告効果測定のため、クッキー（Cookie）を使用することがあります。
お客様はブラウザ設定によりクッキーの受け入れを拒否することができますが、その場合、一部サービスが正常に利用できないことがあります。

8. お客様情報の訂正
登録情報に誤りがあり、サービス提供や決済に支障が生じる場合、当方にて必要な訂正を行うことがあります。

9. 開示・訂正・利用停止等
お客様は、個人情報保護法に基づき、保有個人データの開示、訂正、利用停止等を請求することができます。
当方は、法令に従い適切に対応します。

10. 免責・注意事項
当方は、当方サービスからリンクされた外部サイトにおける個人情報の取扱いについて責任を負いません。
ログイン情報等は、お客様ご自身で厳重に管理してください。

11. プライバシーポリシーの変更
当方は、必要に応じて本プライバシーポリシーを変更することがあります。
変更後の内容は、本サービス上での掲示等により周知します。

12. お問い合わせ
本プライバシーポリシーに関するお問い合わせは、当方のお問い合わせフォームよりご連絡ください。

最終更新日：2025年12月19日
      </p>
      <p style="font-size: 0.85rem; color: #6b7280; margin-top: 1.5rem;">
        ご利用条件の詳細は <a href="/terms">利用規約</a> を、
        事業者情報や販売条件については <a href="/legal">特定商取引法に関する表記</a> をご確認ください。
      </p>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderAboutPage() {
  const content = `
    <section style="max-width: 720px; margin: 0 auto; text-align: center;">
      <img src="/logo-fuchilabo.png" alt="ふちLABO. ロゴ" style="max-width: 260px; width: 70%; height: auto; margin: 2rem auto 1.5rem; display: block;" />
      <h2 style="font-size: 1.4rem; margin-bottom: 1rem;">ABOUT｜ふちLABO.の四柱推命への想い</h2>
      <p style="text-align: left; line-height: 1.8; white-space: pre-line;">
ふちLABO.は、四柱推命を「未来を当てる占い」ではなく、「自分の性質と流れを理解し、人生を主体的に選び取るための知恵」として届けることを大切にしています。
生年月日という変えられない情報から読み取れるのは、可能性と制限、強みと課題、そして運気のリズムです。それらを正しく知ることで、人は必要以上に迷わず、自分に合った選択ができるようになります。

私たちは古典に基づいた理論を大切にしながらも、現代の生き方や価値観に寄り添う解釈を重視しています。鑑定や講座では、難解な専門用語に偏らず、「今日からどう活かすか」「どう行動に落とし込むか」を重視し、実生活に役立つ四柱推命をお伝えしています。

ふちLABO.は、四柱推命を通して一人ひとりが自分の人生を深く理解し、納得のいく選択を重ねていくための“思考のラボ”であり続けたいと考えています。
      </p>
    </section>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderAdminHome() {
  const products = getProducts()
    .slice()
    .sort((a, b) => {
      const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 9999;
      const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || '').localeCompare(b.title || '');
    });
  const rows = products
    .map(
      (p) => `
      <tr data-product-id="${p.id}" draggable="true">
        <td>${p.id}</td>
        <td>${p.title}</td>
        <td>${formatCurrency(p.currency, p.price)}</td>
        <td>${typeof p.displayOrder === 'number' ? p.displayOrder : ''}</td>
        <td>${p.isHidden ? '非表示' : '表示中'}</td>
        <td>
          <a href="/admin/product?id=${encodeURIComponent(p.id)}">編集</a>
          <form method="POST" action="/admin/delete-product" style="display:inline;margin-left:0.5rem;">
            <input type="hidden" name="id" value="${p.id}" />
            <button type="submit">削除</button>
          </form>
        </td>
      </tr>
    `
    )
    .join('');

  const content = `
    <div class="panel">
      <h3>商品一覧（管理画面）</h3>
      <p>商品を編集するとトップページと商品ページに反映されます。</p>
      <div class="admin-actions">
        <a class="button secondary" href="/admin/product">新規商品を追加</a>
        <a class="button" href="/admin/schedules">予約枠を編集</a>
        <a class="button" href="/admin/images">画像を管理</a>
      </div>
      <table class="schedule-table" style="margin-top:1rem;">
        <thead>
          <tr><th>ID</th><th>タイトル</th><th>価格</th><th>表示順</th><th>状態</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <form id="reorderForm" method="POST" action="/admin/reorder-products" style="margin-top:1rem;">
        <input type="hidden" name="order" id="reorderOrderInput" />
        <button class="button" type="button" id="saveOrderButton">並び順を保存</button>
      </form>
    </div>
    <script>
      (function() {
        var tableBody = document.querySelector('.schedule-table tbody');
        if (!tableBody) return;

        var draggingRow = null;

        tableBody.addEventListener('dragstart', function(e) {
          var tr = e.target.closest('tr[data-product-id]');
          if (!tr) return;
          draggingRow = tr;
          e.dataTransfer.effectAllowed = 'move';
        });

        tableBody.addEventListener('dragover', function(e) {
          if (!draggingRow) return;
          e.preventDefault();
          var tr = e.target.closest('tr[data-product-id]');
          if (!tr || tr === draggingRow) return;
          var rect = tr.getBoundingClientRect();
          var before = e.clientY < rect.top + rect.height / 2;
          tableBody.insertBefore(draggingRow, before ? tr : tr.nextSibling);
        });

        tableBody.addEventListener('dragend', function() {
          draggingRow = null;
        });

        var saveButton = document.getElementById('saveOrderButton');
        var orderInput = document.getElementById('reorderOrderInput');
        if (saveButton && orderInput) {
          saveButton.addEventListener('click', function() {
            var ids = [];
            var rows = tableBody.querySelectorAll('tr[data-product-id]');
            rows.forEach(function(row) {
              var id = row.getAttribute('data-product-id');
              if (id) ids.push(id);
            });
            orderInput.value = ids.join(',');
            document.getElementById('reorderForm').submit();
          });
        }
      })();
    </script>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/', hideHeading: true });
}

function renderAdminProductForm(product) {
  const isNew = !product;
  const safe = (v) => (v == null ? '' : String(v));
  const requiresSchedule = !product || product.requiresSchedule !== false; // 既存商品はデフォルトで日時指定あり
  const compatibilityEnabled = !!(product && product.enableCompatibilityOption);
  const compatibilityPrice = product && typeof product.compatibilityOptionPrice === 'number'
    ? product.compatibilityOptionPrice
    : Number((product && product.compatibilityOptionPrice) || 0);

  // 永続ストレージ上の images ディレクトリにある画像ファイルを取得して、選択肢として表示する
  let imageOptionsHtml = '<option value="">（画像を選択）</option>';
  try {
    if (fs.existsSync(imagesStorageDir)) {
      const files = fs.readdirSync(imagesStorageDir).filter((name) =>
        /\.(png|jpg|jpeg|svg)$/i.test(name)
      );
      imageOptionsHtml += files
        .map((file) => {
          const relPath = `/uploads/images/${file}`;
          const selected = product && product.image === relPath ? ' selected' : '';
          return `<option value="${relPath}"${selected}>${file}</option>`;
        })
        .join('');
    }
  } catch (e) {
    // 画像一覧の取得に失敗してもフォーム全体の動作には影響させない
  }

  const content = `
    <div class="panel">
      <h3>${isNew ? '新規商品' : '商品編集'}（管理画面）</h3>
      <p>日本語・英数字どちらでも入力できます。</p>
      <form method="POST" action="/admin/save-product" class="reservation-form">
        <input type="hidden" name="originalId" value="${isNew ? '' : safe(product.id)}" />
        <div class="field">
          <label for="id">商品ID（英数字）</label>
          <input id="id" name="id" type="text" required value="${isNew ? '' : safe(product.id)}" />
        </div>
        <div class="field">
          <label for="image">画像</label>
          <select id="image" name="image">
            ${imageOptionsHtml}
          </select>
          <small>あらかじめ <code>/admin/images</code> から画像をアップロードしておくと、ここで選択できます。</small>
        </div>
        <div class="field">
          <label for="typeLabel">種別ラベル</label>
          <input id="typeLabel" name="typeLabel" type="text" value="${safe(product && product.typeLabel)}" />
        </div>
        <div class="field">
          <label for="price">価格（円）</label>
          <input id="price" name="price" type="number" min="0" step="1" required value="${safe(product && product.price)}" />
        </div>
        <div class="field">
          <label for="compatibilityOptionPrice">相性鑑定オプション価格（円）</label>
          <input id="compatibilityOptionPrice" name="compatibilityOptionPrice" type="number" min="0" step="1" value="${compatibilityPrice || ''}" />
          <small>相性鑑定オプションを利用する場合の1名あたりの追加料金です。</small>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" name="enableCompatibilityOption" ${compatibilityEnabled ? 'checked' : ''} />
            予約フォームに相性鑑定オプションを表示する
          </label>
        </div>
        <div class="field">
          <label for="personId">鑑定士</label>
          <select id="personId" name="personId">
            <option value="">未選択</option>
            <option value="tetsuya" ${product && product.personId === 'tetsuya' ? 'selected' : ''}>てつ先生</option>
            <option value="chigusa" ${product && product.personId === 'chigusa' ? 'selected' : ''}>ちぐさ</option>
          </select>
        </div>
        <div class="field">
          <label for="title">商品名（太字で表示されます）</label>
          <input id="title" name="title" type="text" required value="${safe(product && product.title)}" />
        </div>
        <div class="field">
          <label for="summary">商品カード説明欄（トップページのカードに表示）</label>
          <textarea id="summary" name="summary">${safe(product && product.summary)}</textarea>
        </div>
        <div class="field">
          <label for="benefit">商品ベネフィット（商品ページの説明文）</label>
          <textarea id="benefit" name="benefit">${safe(product && product.benefit)}</textarea>
        </div>
        <div class="field">
          <label for="duration">時間</label>
          <input id="duration" name="duration" type="text" value="${safe(product && product.duration)}" />
        </div>
        <div class="field">
          <label for="details">含まれるもの（1行1項目）</label>
          <textarea id="details" name="details">${product ? product.details.join('\n') : ''}</textarea>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" name="requiresSchedule" ${requiresSchedule ? 'checked' : ''} />
            予約日時の指定が必要な商品にする
          </label>
          <small>セミナーや対面鑑定など日時予約が必要な場合はチェックを入れます。動画販売など日時不要の商品はチェックを外してください。</small>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" name="showSessionType" ${product && product.showSessionType ? 'checked' : ''} />
            予約フォームに「対面／オンライン」を表示する
          </label>
          <small>対面鑑定とオンライン鑑定を選んでもらいたい商品の場合にチェックを入れてください。</small>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" name="isHidden" ${product && product.isHidden ? 'checked' : ''} />
            商品一覧に表示しない（非表示）
          </label>
          <small>チェックを入れると、トップページや鑑定士ごとの一覧には表示されなくなります（商品ページのURLを知っている場合はアクセス可能です）。</small>
        </div>
        <button class="button" type="submit">保存する</button>
      </form>
    </div>
  `;

  return renderPage({
    title: isNew ? '新規商品の追加' : '商品の編集',
    subtitle: isNew ? '' : safe(product.title),
    content,
    backLink: '/admin',
  });
}

function filterFutureSchedule(schedule) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 今日から数えて1週間後のみ表示するため、基準日を「今日+6日」にする
  const threshold = new Date(today.getTime());
  threshold.setDate(threshold.getDate() + 6);

  return schedule.filter((entry) => {
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return true;
    d.setHours(0, 0, 0, 0);
    return d.getTime() > threshold.getTime();
  });
}

function formatScheduleDateLabel(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const w = weekdays[d.getDay()];
  return `${yy}/${m}/${day}（${w}）`;
}

function renderScheduleTable(product) {
  if (!product.requiresSchedule && product.requiresSchedule !== undefined) {
    return '';
  }
  const effectivePersonId = product.personId || 'tetsuya';
  const schedule = filterFutureSchedule(effectivePersonId ? getScheduleForPerson(effectivePersonId) : []);
  const rows = schedule
    .map((entry) => {
      const timeBadges = entry.slots
        .map(
          (time) =>
            `<span class="time-chip" data-date="${entry.date}" data-time="${time}" onclick="window.__selectTimeSlot && window.__selectTimeSlot('${entry.date}','${time}', this);">${time}</span>`
        )
        .join('');
      const label = formatScheduleDateLabel(entry.date);
      return `<tr><th scope="row">${label}</th><td>${timeBadges}</td></tr>`;
    })
    .join('');

  return `
    <table class="schedule-table" aria-label="予約枠">
      <thead><tr><th>日付</th><th>開始時間</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderReservationForm(product) {
  const requiresSchedule = product.requiresSchedule !== false; // 未指定は true 扱い
  const numericPrice =
    typeof product.price === 'number' ? product.price : Number(product.price || 0);
  const isFree = numericPrice === 0;

  let dateTimeFields = '';

  if (requiresSchedule) {
    const effectivePersonId = product.personId || 'tetsuya';
    const schedule = filterFutureSchedule(effectivePersonId ? getScheduleForPerson(effectivePersonId) : []);
    const dateOptions = schedule
      .map((entry) => `<option value="${entry.date}">${formatScheduleDateLabel(entry.date)}</option>`)
      .join('');
    const timeOptions = schedule
      .flatMap((entry) => entry.slots)
      .map((slot) => `<option value="${slot}">${slot}</option>`)
      .join('');

    dateTimeFields = `
      <div class="field">
        <label for="date">ご希望日</label>
        <select id="date" name="date" required>
          <option value="">日付を選択</option>
          ${dateOptions}
        </select>
      </div>
      <div class="field">
        <label for="timeSlot">開始時間</label>
        <select id="timeSlot" name="timeSlot" required>
          <option value="">時間を選択</option>
          ${timeOptions}
        </select>
      </div>
    `;
  } else {
    // 日時不要商品の場合は hidden で空を送る
    dateTimeFields = `
      <input type="hidden" name="date" value="" />
      <input type="hidden" name="timeSlot" value="" />
    `;
  }

  let sessionTypeField = '';
  if (product.showSessionType) {
    sessionTypeField = `
      <div class="field">
        <label for="sessionType">対面／オンライン</label>
        <select id="sessionType" name="sessionType" required>
          <option value="">選択してください</option>
          <option value="対面">対面</option>
          <option value="オンライン">オンライン</option>
        </select>
        <div class="field-error-message" data-error-for="sessionType"></div>
      </div>
    `;
  }

  let compatibilityOptionField = '';
  const compatibilityEnabled = !!product.enableCompatibilityOption;
  const compatibilityPrice =
    typeof product.compatibilityOptionPrice === 'number'
      ? product.compatibilityOptionPrice
      : Number(product.compatibilityOptionPrice || 0);

  if (compatibilityEnabled && compatibilityPrice > 0) {
    const priceText = formatCurrency(product.currency || '¥', compatibilityPrice);
    compatibilityOptionField = `
      <fieldset class="field compatibility-option" style="border:1px solid #e5e7eb; padding:0.75rem 1rem;">
        <legend style="font-weight:bold; color:#16a34a;">オプション</legend>
        <label style="display:flex; align-items:flex-start; gap:0.5rem;">
          <input type="checkbox" name="compatibilityOptionEnabled" value="1" />
          <div>
            <div style="font-size:0.95rem; margin-top:0.1rem;"><strong>相性鑑定</strong></div>
            <div style="font-size:0.9rem; margin-top:0.25rem;"><strong>${priceText}（税込）／＋30分／1名ごと</strong></div>
            <div style="font-size:0.9rem; margin-top:0.5rem;">
              ・ご本人さまの鑑定に、ご家族（配偶者・お子さま等）を追加して相性を鑑定します。<br />
              ・お相手の参加は任意です（同席なしで鑑定できます）
            </div>
            <div style="font-size:0.9rem; margin-top:0.75rem;">
              <strong>ご入力について</strong><br />
              「ご相談内容」欄に、追加する方の以下をご記入ください。<br />
              生年月日／性別／出生時間／出生地（都道府県）
            </div>
            <div style="font-size:0.9rem; margin-top:0.75rem;">
              <strong>記入例（複数人の場合）</strong><br />
              追加①：1990/01/23　女性　14:52　愛知県<br />
              追加②：2018/05/10　男性　時間不明　東京都
            </div>
            <div style="margin-top:0.5rem;">
              <label for="compatibilityOptionCount" style="font-size:0.9rem;"><strong>追加する人数</strong></label>
              <input id="compatibilityOptionCount" name="compatibilityOptionCount" type="number" min="1" step="1" value="1" style="width:4rem; margin-left:0.5rem;" />
            </div>
          </div>
        </label>
      </fieldset>
    `;
  }

  return `
    <form class="reservation-form" method="POST" action="/reserve/confirm">
      <input type="hidden" name="productId" value="${product.id}" />
      <input type="hidden" name="personId" value="${product.personId || 'tetsuya'}" />
      ${dateTimeFields}
      <div class="field">
        <label for="name">お名前</label>
        <input id="name" name="name" type="text" placeholder="例）山田 花子" required />
        <div class="field-error-message" data-error-for="name"></div>
      </div>
      <div class="field">
        <label for="email">メールアドレス</label>
        <input id="email" name="email" type="email" placeholder="sample@example.com" required />
        <div class="field-error-message" data-error-for="email"></div>
      </div>
      <div class="field">
        <label for="emailConfirm">メールアドレス（確認用）</label>
        <input id="emailConfirm" name="emailConfirm" type="email" placeholder="確認のためもう一度入力してください" required />
        <div class="field-error-message" data-error-for="emailConfirm"></div>
      </div>
      ${sessionTypeField}
      <div class="field">
        <label for="birthday">生年月日</label>
        <input id="birthday" name="birthday" type="date" value="1980-01-01" required />
        <div class="field-error-message" data-error-for="birthday"></div>
      </div>
      <div class="field">
        <label for="genderAtBirth">性別（出生時）</label>
        <select id="genderAtBirth" name="genderAtBirth" required>
          <option value="">選択してください</option>
          <option value="男性">男性</option>
          <option value="女性">女性</option>
        </select>
        <small style="font-size: 0.85rem; color: #6b7280;">
          ※四柱推命では大運（10年運）の算出に必要なため「出生時の性別」をお伺いします。
        </small>
        <div class="field-error-message" data-error-for="genderAtBirth"></div>
      </div>
      <div class="field">
        <label for="birthTime">生まれ時間</label>
        <input id="birthTime" name="birthTime" type="text" placeholder="例）14:52" />
      </div>
      <div class="field">
        <label for="birthPlace">出身地</label>
        <input id="birthPlace" name="birthPlace" type="text" placeholder="例）愛知県" required />
        <div class="field-error-message" data-error-for="birthPlace"></div>
      </div>
      ${compatibilityOptionField}
      ${
        isFree
          ? ''
          : `
      <div class="field">
        <label for="paymentMethod">お支払方法</label>
        <select id="paymentMethod" name="paymentMethod" required>
          <option value="bank">銀行振込</option>
          <option value="paypal">クレジットカード</option>
        </select>
        <small id="paymentMethodNote" style="display: none; font-size: 0.85rem; color: #6b7280;"></small>
        <div class="field-error-message" data-error-for="paymentMethod"></div>
      </div>
      `
      }
      <div class="field">
        <label for="notes">ご要望・メモ</label>
        <textarea id="notes" name="notes" placeholder="鑑定で聴きたいお悩みや、ご相談内容があればご記入ください"></textarea>
      </div>
      <button class="button" type="submit">予約を確認する</button>
    </form>
  `;
}

function renderProductPage(product) {
  const scheduleTable = renderScheduleTable(product);
  const reservationForm = renderReservationForm(product);

  const numericPrice =
    typeof product.price === 'number' ? product.price : Number(product.price || 0);
  const isFree = numericPrice === 0;

  const detailItems = product.details.map((item) => `<li>${item}</li>`).join('');
  const rawBenefit =
    product.benefit && String(product.benefit).trim()
      ? String(product.benefit)
      : String(product.summary || '');
  const benefitHtml = rawBenefit.replace(/\r?\n/g, '<br>');

  const content = `
    <div style="margin-bottom: 1rem;">
      <a href="javascript:history.back()" style="color:#0ea5e9; text-decoration:none;">
        ← 前のページに戻る
      </a>
    </div>
    <div class="product-layout">
      <figure class="product-figure">
        <img src="${product.image}" alt="${product.title}" loading="lazy" />
        <div class="product-meta">
          <div class="badge">${product.typeLabel}</div>
          <div class="title"><strong>${product.title}</strong></div>
          <div class="price">${
            isFree ? '無料イベントです' : formatCurrency(product.currency, numericPrice)
          }</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
        </div>
        <p class="product-benefit">${benefitHtml}</p>
        <div class="product-meta">
          <strong>時間</strong>
          <span>${product.duration}</span>
          <strong>含まれるもの</strong>
          <ul class="feature-list">${detailItems}</ul>
        </div>
      </figure>
      <div class="panel">
        <h3>予約枠と入力フォーム</h3>
        ${scheduleTable}
        ${reservationForm}
      </div>
    </div>
    <script>
      function __selectTimeSlot(d, t, el) {
        var dateSelect = document.getElementById('date');
        var timeSelect = document.getElementById('timeSlot');
        if (dateSelect) {
          dateSelect.value = d;
        }
        if (timeSelect) {
          timeSelect.value = t;
        }

        var chips = document.querySelectorAll('.time-chip[data-date][data-time]');
        Array.prototype.forEach.call(chips, function(chip) {
          chip.classList.remove('time-chip-selected');
        });
        if (el) {
          el.classList.add('time-chip-selected');
        }
      }

      (function() {
        var form = document.querySelector('.reservation-form');
        if (!form) return;

        var emailInput = document.getElementById('email');
        var emailConfirmInput = document.getElementById('emailConfirm');
        var nameInput = document.getElementById('name');
        var dateSelect = document.getElementById('date');
        var timeSelect = document.getElementById('timeSlot');
        var birthdayInput = document.getElementById('birthday');
        var genderSelect = document.getElementById('genderAtBirth');
        var birthPlaceInput = document.getElementById('birthPlace');
        var paymentSelect = document.getElementById('paymentMethod');
        var paymentNote = document.getElementById('paymentMethodNote');
        var sessionTypeSelect = document.getElementById('sessionType');

        function getErrorContainer(name) {
          return form.querySelector('.field-error-message[data-error-for="' + name + '"]');
        }

        function setFieldError(inputEl, name, message) {
          var field = inputEl && inputEl.closest ? inputEl.closest('.field') : null;
          var msgEl = getErrorContainer(name);
          if (message) {
            if (field) field.classList.add('field-error');
            if (msgEl) msgEl.textContent = message;
          } else {
            if (field) field.classList.remove('field-error');
            if (msgEl) msgEl.textContent = '';
          }
        }

        function validateRequired(inputEl, name, label) {
          if (!inputEl) return true;
          var value = (inputEl.value || '').trim();
          if (!value) {
            setFieldError(inputEl, name, label + 'は必須です。');
            return false;
          }
          setFieldError(inputEl, name, '');
          return true;
        }

        function validateEmailPair() {
          if (!emailInput || !emailConfirmInput) return true;
          var ok1 = validateRequired(emailInput, 'email', 'メールアドレス');
          var ok2 = validateRequired(emailConfirmInput, 'emailConfirm', 'メールアドレス（確認用）');
          if (!ok1 || !ok2) return false;
          if (emailInput.value.trim() && emailConfirmInput.value.trim() && emailInput.value.trim() !== emailConfirmInput.value.trim()) {
            setFieldError(emailConfirmInput, 'emailConfirm', 'メールアドレスと確認用メールアドレスが一致しません。');
            return false;
          }
          setFieldError(emailConfirmInput, 'emailConfirm', '');
          return true;
        }

        function validateAll(showAlert) {
          var ok = true;

          if (dateSelect) {
            ok = validateRequired(dateSelect, 'date', 'ご希望日') && ok;
          }
          if (timeSelect) {
            ok = validateRequired(timeSelect, 'timeSlot', '開始時間') && ok;
          }
          if (sessionTypeSelect) {
            ok = validateRequired(sessionTypeSelect, 'sessionType', '対面／オンライン') && ok;
          }

          ok = validateRequired(nameInput, 'name', 'お名前') && ok;
          ok = validateEmailPair() && ok;
          ok = validateRequired(birthdayInput, 'birthday', '生年月日') && ok;
          ok = validateRequired(genderSelect, 'genderAtBirth', '性別（出生時）') && ok;
          ok = validateRequired(birthPlaceInput, 'birthPlace', '出身地') && ok;
          if (paymentSelect) {
            ok = validateRequired(paymentSelect, 'paymentMethod', 'お支払方法') && ok;
          }

          if (!ok && showAlert) {
            var firstError = form.querySelector('.field.field-error input, .field.field-error select, .field.field-error textarea');
            if (firstError && firstError.focus) {
              firstError.focus();
            }
          }

          return ok;
        }

        // 入力中／変更時にエラーをリアルタイムで解除
        if (nameInput) {
          nameInput.addEventListener('input', function() { validateRequired(nameInput, 'name', 'お名前'); });
        }
        if (emailInput) {
          emailInput.addEventListener('input', validateEmailPair);
        }
        if (emailConfirmInput) {
          emailConfirmInput.addEventListener('input', validateEmailPair);
        }
        if (dateSelect) {
          dateSelect.addEventListener('change', function() { validateRequired(dateSelect, 'date', 'ご希望日'); });
        }
        if (timeSelect) {
          timeSelect.addEventListener('change', function() { validateRequired(timeSelect, 'timeSlot', '開始時間'); });
        }
        if (sessionTypeSelect) {
          sessionTypeSelect.addEventListener('change', function() { validateRequired(sessionTypeSelect, 'sessionType', '対面／オンライン'); });
        }
        if (birthdayInput) {
          birthdayInput.addEventListener('change', function() { validateRequired(birthdayInput, 'birthday', '生年月日'); });
        }
        if (genderSelect) {
          genderSelect.addEventListener('change', function() { validateRequired(genderSelect, 'genderAtBirth', '性別（出生時）'); });
        }
        if (birthPlaceInput) {
          birthPlaceInput.addEventListener('input', function() { validateRequired(birthPlaceInput, 'birthPlace', '出身地'); });
        }
        if (paymentSelect) {
          paymentSelect.addEventListener('change', function() { validateRequired(paymentSelect, 'paymentMethod', 'お支払方法'); });
        }

        if (paymentSelect && paymentNote) {
          function updatePaymentNote() {
            if (paymentSelect.value === 'bank') {
              paymentNote.textContent = '※銀行振込をお選びの場合、振込手数料はお客さまのご負担となります。';
              paymentNote.style.display = 'block';
            } else if (paymentSelect.value === 'paypal') {
              paymentNote.textContent = '※追ってPAYPALのお支払いリンクを送付します';
              paymentNote.style.display = 'block';
            } else {
              paymentNote.textContent = '';
              paymentNote.style.display = 'none';
            }
          }

          paymentSelect.addEventListener('change', updatePaymentNote);
          updatePaymentNote();
        }

        form.addEventListener('submit', function(e) {
          if (!validateAll(true)) {
            e.preventDefault();
          }
        });
      })();
    </script>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderNotFound() {
  const content = '<p>お探しの商品は見つかりませんでした。</p>';
  return renderPage({ title: '404', content, backLink: '/' });
}

function renderConfirmation(reservation) {
  const amount =
    typeof reservation.displayPrice === 'number' && reservation.displayPrice > 0
      ? reservation.displayPrice
      : typeof reservation.price === 'number'
      ? reservation.price
      : 0;
  const amountText = amount > 0 ? formatCurrency(reservation.currency || '¥', amount) : '未入力';

  const summaryRows = [
    ['商品', reservation.productTitle],
    ['日時', `${reservation.date} ${reservation.timeSlot}`],
    ['お名前', reservation.name],
    ['メール', reservation.email],
    ['生年月日', reservation.birthday || '未入力'],
    ['性別（出生時）', reservation.genderAtBirth || '未入力'],
    ['生まれ時間', reservation.birthTime || '未入力'],
    ['出身地', reservation.birthPlace || '未入力'],
    ['お支払方法',
      reservation.paymentMethod === 'bank'
        ? '銀行振込（振込手数料はお客様のご負担となります）'
        : reservation.paymentMethod === 'paypal'
        ? 'PAYPAL'
        : '未入力',
    ],
    ['対面／オンライン', reservation.sessionType || '未入力'],
    ['金額', amountText],
    reservation.compatibilityOptionEnabled
      ? ['相性鑑定オプション', `追加人数：${reservation.compatibilityOptionCount}名 / 料金：${formatCurrency(reservation.currency || '¥', reservation.compatibilityTotalPrice || 0)}`]
      : null,
  ]
    .filter(Boolean)
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
      <div style="margin-bottom:1rem;">
        <ol style="display:flex; gap:0.5rem; list-style:none; padding:0; margin:0; font-size:0.9rem; align-items:center; justify-content:center;">
          <li style="display:flex; align-items:center; gap:0.25rem; opacity:0.6;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; border:1px solid #9ca3af; font-size:0.8rem;">1</span>
            <span>情報入力</span>
          </li>
          <li style="flex:0 0 1.5rem; height:2px; background:#e5e7eb;"></li>
          <li style="display:flex; align-items:center; gap:0.25rem; opacity:0.6;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; border:1px solid #9ca3af; font-size:0.8rem;">2</span>
            <span>確認</span>
          </li>
          <li style="flex:0 0 1.5rem; height:2px; background:linear-gradient(to right,#9ca3af,#16a34a);"></li>
          <li style="display:flex; align-items:center; gap:0.25rem; font-weight:bold; color:#16a34a;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:1.4rem; height:1.4rem; border-radius:9999px; background-color:#bbf7d0; color:#14532d; font-size:0.8rem;">3</span>
            <span>完了</span>
          </li>
        </ol>
      </div>
      <h3>予約を受け付けました</h3>
      <p style="white-space: pre-line; margin-bottom: 1rem;">
ご予約ありがとうございます。
内容を確認のうえ、24時間以内にご入金先やクレジットカード支払い方法などの詳細をメールにてご案内いたします。
      </p>
      <p style="white-space: pre-line;">
ご連絡先として info@fuchilabo.com を登録しております。
こちらのアドレスより、あらためてご連絡いたします。
      </p>
      <table class="schedule-table"><tbody>${summaryRows}</tbody></table>
      <div>
        <strong>ご要望・メモ</strong>
        <p>${reservation.notes || '（未入力）'}</p>
      </div>
      <a class="button secondary" href="/">トップへ戻る</a>
    </div>
  `;

  return renderPage({ title: '', subtitle: '', content, backLink: '/', hideHeading: true });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      resolve(querystring.parse(data));
    });
    req.on('error', reject);
  });
}

function handleReservation(body, res) {
  const product = getProduct(body.productId);
  const requiresSchedule = product && product.requiresSchedule !== false;
  const personId = body.personId || (product && product.personId) || '';
  const numericPrice =
    product && typeof product.price === 'number'
      ? product.price
      : Number((product && product.price) || 0);
  const compatibilityEnabled = !!(product && product.enableCompatibilityOption);
  const rawCompatibilityPrice =
    product && typeof product.compatibilityOptionPrice === 'number'
      ? product.compatibilityOptionPrice
      : Number((product && product.compatibilityOptionPrice) || 0);
  const isFree = numericPrice === 0;

  const required = ['productId', 'name', 'email'];
  if (product && product.requiresSchedule && !personId) {
    required.push('personId');
  }
  if (requiresSchedule) {
    required.push('date', 'timeSlot');
  }
  if (product.showSessionType) {
    required.push('sessionType');
  }
  required.push('birthday', 'genderAtBirth', 'birthPlace');
  if (!isFree) {
    required.push('paymentMethod');
  }
  const missing = required.filter((key) => !body[key]);

  if (missing.length > 0 || !product) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage({ title: 'エラー', content: '<p>入力内容を確認してください。</p>', backLink: '/' }));
    return;
  }

  // 予約枠がまだ空いているか最終チェック（ブラウザの戻るボタンなどによる二重予約防止）
  if (requiresSchedule && personId && body.date && body.timeSlot) {
    const schedule = getScheduleForPerson(personId);
    const entry = schedule.find((e) => e.date === body.date);
    const available = entry && Array.isArray(entry.slots) && entry.slots.includes(body.timeSlot);

    if (!available) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPage({
          title: 'エラー',
          content: '<p>選択された日時はすでに満席になりました。別の日時をお選びください。</p>',
          backLink: '/',
        })
      );
      return;
    }
  }

  const basePrice = numericPrice;
  let compatibilityCount = 0;
  let compatibilityTotalPrice = 0;
  let displayPrice = basePrice;

  if (compatibilityEnabled && rawCompatibilityPrice > 0) {
    const enabled = !!body.compatibilityOptionEnabled;
    const count = enabled ? Number(body.compatibilityOptionCount || 1) : 0;
    compatibilityCount = Number.isNaN(count) || count <= 0 ? 0 : Math.floor(count);
    compatibilityTotalPrice = compatibilityCount * rawCompatibilityPrice;
    if (compatibilityTotalPrice < 0) compatibilityTotalPrice = 0;
    displayPrice = basePrice + (compatibilityCount > 0 ? rawCompatibilityPrice : 0);
  }

  const reservation = {
    productId: product.id,
    productTitle: product.title,
    price: basePrice + compatibilityTotalPrice,
    currency: product.currency || '¥',
    personId,
    personName: personId ? getPersonName(personId) : '',
    date: requiresSchedule ? body.date : '',
    timeSlot: requiresSchedule ? body.timeSlot : '',
    sessionType: product.showSessionType ? body.sessionType : '',
    name: body.name,
    email: body.email,
    birthday: body.birthday || '',
    genderAtBirth: body.genderAtBirth || '',
    birthTime: body.birthTime || '',
    birthPlace: body.birthPlace || '',
    paymentMethod: body.paymentMethod || '',
    notes: body.notes || '',
    compatibilityOptionEnabled: compatibilityEnabled && compatibilityCount > 0,
    compatibilityOptionCount: compatibilityCount,
    compatibilityTotalPrice,
    displayPrice,
    createdAt: new Date().toISOString(),
  };

  saveReservation(reservation);
  sendReservationEmail(reservation);
  sendReservationToSheets(reservation);

  try {
    if (requiresSchedule && reservation.personId && reservation.date && reservation.timeSlot) {
      // 予約された枠を schedules.json から削除してダブルブッキングを防ぐ
      updateScheduleForPerson(reservation.personId, reservation.date, reservation.timeSlot);
    }
  } catch (e) {
    console.error('Failed to update schedule after reservation', e);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderConfirmation(reservation));
}

const server = http.createServer(async (req, res) => {
  const isReadMethod = req.method === 'GET' || req.method === 'HEAD';

  // アップロード画像の配信
  if (serveUploadedImage(req, res)) {
    return;
  }

  if (serveStaticFile(req, res)) {
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  // /admin 配下はBasic認証を要求する
  if (!ensureAdminAuth(req, res, parsedUrl)) {
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderAboutPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/contact') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderContactPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/legal') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderLegalPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/terms') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderTermsPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/privacy') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderPrivacyPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/kouza') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderKouzaCoursePage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderAdminHome());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/admin/schedules') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const saved = parsedUrl.query && parsedUrl.query.saved === '1';
    res.end(req.method === 'HEAD' ? undefined : renderAdminSchedulesPage({ saved }));
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/admin/images') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderAdminImagesPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/admin/product') {
    const id = parsedUrl.query.id;
    const product = id ? getProduct(id) : undefined;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderAdminProductForm(product));
    return;
  }

  if (isReadMethod && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderHomePage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/courses/canva-ai') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderCanvaAiCoursePage());
    return;
  }

  if (isReadMethod && (parsedUrl.pathname === '/products/tetsuya' || parsedUrl.pathname === '/products/chigusa')) {
    const personId = parsedUrl.pathname.split('/')[2];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderPersonProductsPage(personId));
    return;
  }

  if (isReadMethod && parsedUrl.pathname.startsWith('/products/')) {
    const productId = parsedUrl.pathname.split('/')[2];
    const product = getProduct(productId);
    if (!product) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : renderNotFound());
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderProductPage(product));
    return;
  }

  // GET で /reserve/confirm にアクセスされた場合はトップへリダイレクト
  if (isReadMethod && parsedUrl.pathname === '/reserve/confirm') {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/reserve/confirm') {
    try {
      const body = await parseBody(req);
      const product = getProduct(body.productId);
      const requiresSchedule = product && product.requiresSchedule !== false;
      const personId = body.personId || (product && product.personId) || '';

      const numericPrice =
        product && typeof product.price === 'number'
          ? product.price
          : Number((product && product.price) || 0);
      const compatibilityEnabled = !!(product && product.enableCompatibilityOption);
      const rawCompatibilityPrice =
        product && typeof product.compatibilityOptionPrice === 'number'
          ? product.compatibilityOptionPrice
          : Number((product && product.compatibilityOptionPrice) || 0);

      const required = ['productId', 'name', 'email'];
      if (product && product.requiresSchedule && !personId) {
        required.push('personId');
      }
      if (requiresSchedule) {
        required.push('date', 'timeSlot');
      }
      if (product.showSessionType) {
        required.push('sessionType');
      }
      const missing = required.filter((key) => !body[key]);

      if (missing.length > 0 || !product) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPage({ title: 'エラー', content: '<p>入力内容を確認してください。</p>', backLink: '/' }));
        return;
      }

      const basePrice = numericPrice;
      let compatibilityCount = 0;
      let compatibilityTotalPrice = 0;
      let displayPrice = basePrice;

      if (compatibilityEnabled && rawCompatibilityPrice > 0) {
        const enabled = !!body.compatibilityOptionEnabled;
        const count = enabled ? Number(body.compatibilityOptionCount || 1) : 0;
        compatibilityCount = Number.isNaN(count) || count <= 0 ? 0 : Math.floor(count);
        compatibilityTotalPrice = compatibilityCount * rawCompatibilityPrice;
        if (compatibilityTotalPrice < 0) compatibilityTotalPrice = 0;
        displayPrice = basePrice + (compatibilityCount > 0 ? rawCompatibilityPrice : 0);
      }

      const reservation = {
        productId: product.id,
        productTitle: product.title,
        price: basePrice + compatibilityTotalPrice,
        currency: product.currency || '¥',
        personId,
        personName: personId ? getPersonName(personId) : '',
        date: requiresSchedule ? body.date : '',
        timeSlot: requiresSchedule ? body.timeSlot : '',
        sessionType: product.showSessionType ? body.sessionType : '',
        name: body.name,
        email: body.email,
        birthday: body.birthday || '',
        genderAtBirth: body.genderAtBirth || '',
        birthTime: body.birthTime || '',
        birthPlace: body.birthPlace || '',
        paymentMethod: body.paymentMethod || '',
        notes: body.notes || '',
        compatibilityOptionEnabled: compatibilityEnabled && compatibilityCount > 0,
        compatibilityOptionCount: compatibilityCount,
        compatibilityTotalPrice,
        displayPrice,
      };

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderReservationConfirmPage(reservation));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>サーバーで問題が発生しました。</p>', backLink: '/' }));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/delete-image') {
    try {
      const body = await parseBody(req);
      const file = body.file && String(body.file);
      if (!file) {
        throw new Error('Missing file name');
      }

      // パストラバーサル対策としてベース名のみを使用
      const safeName = path.basename(file);
      const targetPath = path.join(imagesStorageDir, safeName);

      if (targetPath.startsWith(imagesStorageDir) && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        fs.unlinkSync(targetPath);
      }

      res.writeHead(302, { Location: '/admin/images' });
      res.end();
    } catch (error) {
      console.error('Failed to delete image', error);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAdminImagesPage('画像の削除に失敗しました。もう一度お試しください。'));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/images') {
    try {
      const { fileName, data } = await parseMultipartImage(req);
      fs.mkdirSync(imagesStorageDir, { recursive: true });
      const targetPath = path.join(imagesStorageDir, fileName);
      fs.writeFileSync(targetPath, data);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAdminImagesPage('画像をアップロードしました。'));
    } catch (error) {
      console.error('Failed to upload image', error);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderAdminImagesPage(
          '画像のアップロードに失敗しました。ファイル形式（PNG / JPG / JPEG / SVG）とサイズ（10MB以内）をご確認ください。'
        )
      );
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/reorder-products') {
    try {
      const body = await parseBody(req);
      const order = (body.order || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const all = getProducts();

      const indexById = new Map();
      order.forEach((id, idx) => {
        if (!indexById.has(id)) {
          indexById.set(id, idx + 1); // 1始まり
        }
      });

      const updated = all.map((p) => {
        const ord = indexById.has(p.id) ? indexById.get(p.id) : p.displayOrder;
        return { ...p, displayOrder: typeof ord === 'number' ? ord : p.displayOrder };
      });

      saveProducts(updated);

      res.writeHead(302, { Location: '/admin' });
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPage({
          title: 'エラー',
          content: '<p>並び順の保存中に問題が発生しました。</p>',
          backLink: '/admin',
        })
      );
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/reserve') {
    try {
      const body = await parseBody(req);
      handleReservation(body, res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>サーバーで問題が発生しました。</p>', backLink: '/' }));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/schedules') {
    try {
      const body = await parseBody(req);
      const all = getSchedules();

      const upsertPerson = (personId, name, text) => {
        const idx = all.findIndex((p) => p.personId === personId);
        const schedule = parseScheduleText(text);
        if (idx >= 0) {
          all[idx] = { personId, name, schedule };
        } else {
          all.push({ personId, name, schedule });
        }
      };

      upsertPerson('tetsuya', 'てつ先生', body.tetsuyaSchedule || '');
      upsertPerson('chigusa', 'ちぐさ', body.chigusaSchedule || '');

      saveSchedules(all);

      res.writeHead(302, { Location: '/admin/schedules?saved=1' });
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPage({
          title: 'エラー',
          content: '<p>予約枠の保存中に問題が発生しました。</p>',
          backLink: '/admin',
        })
      );
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/contact') {
    try {
      const body = await parseBody(req);
      const required = ['name', 'email', 'message', 'agree'];
      const missing = required.filter((key) => !body[key]);
      if (missing.length > 0) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderContactPage(missing, body));
        return;
      }

      const contact = {
        name: body.name,
        email: body.email,
        phone: body.phone || '',
        message: body.message || '',
        agree: !!body.agree,
        createdAt: new Date().toISOString(),
      };

      saveContactMessage(contact);
      saveContactOutbox(contact);
      sendContactToSheets(contact);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderContactComplete(contact));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>お問い合わせ送信中に問題が発生しました。</p>', backLink: '/contact' }));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/save-product') {
    try {
      const body = await parseBody(req);
      const all = getProducts();
      const originalId = body.originalId || body.id;
      const existingIndex = all.findIndex((p) => p.id === originalId);

      const details = (body.details || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      // 表示順はドラッグ＆ドロップの別フォームで管理するため、ここでは既存値をそのまま保持する
      const prevProduct = existingIndex >= 0 ? all[existingIndex] : undefined;
      const displayOrder = prevProduct && typeof prevProduct.displayOrder === 'number' ? prevProduct.displayOrder : undefined;
      const personId = body.personId || '';
      const providerLabel = personId === 'tetsuya'
        ? '鑑定士：てつ先生'
        : personId === 'chigusa'
        ? '鑑定士：ちぐさ'
        : '';

      const product = {
        id: body.id,
        title: body.title,
        price: Number(body.price || 0),
        currency: '¥',
        image: body.image || '',
        summary: body.summary || '',
        benefit: body.benefit || '',
        details,
        duration: body.duration || '',
        typeLabel: body.typeLabel || '',
        displayOrder,
        requiresSchedule: !!body.requiresSchedule,
        showSessionType: !!body.showSessionType,
        isHidden: !!body.isHidden,
        enableCompatibilityOption: !!body.enableCompatibilityOption,
        compatibilityOptionPrice: Number(body.compatibilityOptionPrice || 0),
        personId,
        providerLabel,
      };

      if (existingIndex >= 0) {
        all[existingIndex] = product;
      } else {
        all.push(product);
      }

      saveProducts(all);
      res.writeHead(302, { Location: '/admin' });
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>保存中に問題が発生しました。</p>', backLink: '/admin' }));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/delete-product') {
    try {
      const body = await parseBody(req);
      const id = body.id;
      const all = getProducts().filter((p) => p.id !== id);
      saveProducts(all);
      res.writeHead(302, { Location: '/admin' });
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>削除中に問題が発生しました。</p>', backLink: '/admin' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : renderNotFound());
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Reservation site ready on http://localhost:${port}`);
});
