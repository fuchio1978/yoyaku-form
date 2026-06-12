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

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractUrls(value) {
  const text = String(value == null ? '' : value);
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s<]+/g) || [];
  return matches.map((rawUrl) => {
    let url = rawUrl;
    while (/[),.!?、。]$/.test(url)) {
      url = url.slice(0, -1);
    }
    return url;
  });
}

function linkifyText(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/(?:https?:\/\/|www\.)[^\s<]+/g, (rawUrl) => {
    let url = rawUrl;
    let trailing = '';

    while (/[),.!?、。]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }

    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}

function formatLinkedText(value) {
  return linkifyText(value).replace(/\r?\n/g, '<br>');
}

function renderExternalLinks(urls) {
  const uniqueUrls = Array.from(new Set((urls || []).filter(Boolean)));
  if (!uniqueUrls.length) {
    return '';
  }

  const items = uniqueUrls
    .map((url) => {
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      return `<a class="external-inline-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    })
    .join('');

  return `<div class="external-inline-links">${items}</div>`;
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

function parseMultipartPdf(req) {
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
      if (totalLength > 50 * 1024 * 1024) {
        // 50MB 超は拒否
        reject(new Error('File too large')); 
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const all = buffer.toString('binary');
        const rawParts = all.split(boundaryStr).slice(1, -1);
        for (const rawPart of rawParts) {
          const part = Buffer.from(rawPart, 'binary');
          const idx = part.indexOf('\r\n\r\n');
          if (idx === -1) continue;
          const headerBuf = part.slice(0, idx).toString('utf8');
          const body = part.slice(idx + 4, part.length - 2);

          if (!/name="pdf"/i.test(headerBuf)) continue;
          const fileNameMatch = headerBuf.match(/filename="([^"\\]+)"/i);
          if (!fileNameMatch || !fileNameMatch[1]) continue;
          let fileName = path.basename(fileNameMatch[1]);
          if (!/\.(pdf)$/i.test(fileName)) {
            throw new Error('Unsupported file type');
          }
          return resolve({ fileName, data: body });
        }
        reject(new Error('No pdf file field'));
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
    .map((product) => {
      const summary = String(product.summary || '');
      const summaryLinks = renderExternalLinks(extractUrls(summary));
      return `
      <article class="product-card product-card-static">
        <a class="product-card-media-link" href="/products/${product.id}" aria-label="${escapeHtml(product.title)} の詳細を見る">
          <img src="${product.image}" alt="${escapeHtml(product.title)}" loading="lazy" />
        </a>
        <div class="card-body">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${
            (typeof product.price === 'number' ? product.price : Number(product.price || 0)) === 0
              ? '無料イベント'
              : formatCurrency(product.currency, product.price)
          }</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
          <div class="title">
            <a class="product-card-title-link" href="/products/${product.id}">
              <strong>${escapeHtml(product.title)}</strong>
            </a>
          </div>
          <p class="subtitle">${formatLinkedText(summary)}</p>
          ${summaryLinks}
          <a class="product-card-detail-link" href="/products/${product.id}">詳細を見る</a>
        </div>
      </article>
    `
    })
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
    navVariant: personId === 'chigusa' ? 'chigusa' : 'default',
  });
}

function getVoiceTestimonials() {
  return [
    {
      id: 'voice-difficult-to-find-right-course',
      title: '講座難民だった私が、ようやく納得できる講座に出会えました',
      meta: '40代女性',
      content:
        'いくつか講座を受けても自信が持てなかった四柱推命ですが、てつ先生に教えていただき、「景色で読み解く」ことで、命式を見てその人に合った開運方法や運気が分かり、四柱推命の捉え方が掴めるようになりました。奥深さや終わりのない学びへの理解も深まり、学ぶことが楽しいだけでなく、実際に使える力へと変わっていく感覚も得られました。基本を深く丁寧に学べる上に、アフターフォローも充実しており、お人柄の温かさにも支えられながら、実践で使える鑑定力が身についたと実感しています。講座難民だった私が、ようやく納得できる講座に出会えました。',
    },
    {
      id: 'voice-confidence-in-reading',
      title: '自信を持って鑑定できるようになりました',
      meta: '30代女性',
      content:
        '四柱推命の多くの講座を受けてきましたが、鑑定に自信が持てず足踏みしていた私。てつ先生の講座を受けて、お客様に寄り添いながら、自信を持って鑑定できるようになりました。知識はとても深く、難しい話も分かりやすく教えてくださいます。講座生の意見を否定せず、疑問には最後まで向き合ってくださいます。また、講座が終わって終了ではなく、フォローも充実しているので安心です。',
    },
    {
      id: 'voice-balance-built-confidence',
      title: '五行バランスを学び、自信を持って鑑定できるようになりました',
      meta: '50代女性',
      content:
        '私はいろいろな四柱推命の講座を学んできました。それでも、鑑定をするってことに自信が持てずにいたところでてつ先生を知り、五行バランスを学んでいくうちに自信がつき鑑定ができるようになりました。てつ先生の講座はいつでも質問にわかやすく丁寧に答えてくださるのでわからないままにならずに安心して学べる講座だとおもいます。',
    },
    {
      id: 'voice-podcast-moved-me-forward',
      title: '行き詰まりを越えて、鑑定力が着実に身についています',
      meta: '40代女性',
      content:
        'てつ先生との出会いは、ポッドキャストの「四柱推命な日常がきこえるラジオ」の配信でした。その頃の私は、四柱推命の鑑定ができるようになりたいと思いながらも、学びに行き詰まっていました。てつ先生が四柱推命の難しい内容をカッコよく、ズバッと解説していらっしゃるのを聞いて、「なんか前に進めそう！この人だ！」と感じ、思い切って講座を受講したいとご連絡させていただきました。てつ先生の講座は、講座そのものだけでなく、ポッドキャスト、受講生が自由に参加できる勉強会など、学びをフォローアップしていただける仕掛けがこれでもかというほどたくさんあります。こんな講座は、恐らく世界中を探しても他にはないと思います。仕事で四柱推命の勉強にまとまった時間がなかなか取れませんが、着実に知識と鑑定力が身についていること実感しています。',
    },
    {
      id: 'voice-authentic-reading',
      title: '本質的な鑑定ができるようになりました',
      meta: '40代女性',
      content:
        '他の講座では難しくて挫折しかけていたのですが、てつ先生のLIVEを見て、「なんて分かりやすいの。私の目指す鑑定はこれだ」と確信して即申し込みました。てつ先生の教えのおかげで、今では心から楽しく、本質的な鑑定ができるようになりました。',
    },
    {
      id: 'voice-best-teacher',
      title: 'ここまで分かりやすく教えてくれる先生は初めてでした',
      meta: '30代女性',
      content:
        '四柱推命経験者で受講させていただきました。まず、四柱推命をこんなに分かりやすく教えてくれる先生は、てつ先生だけでした。これまで単発講座も合わせてさまざまな講座を受講してきましたが、こんなに分かりやすく、親身になってくれる先生はいませんでした。分からないを分かるまでとことん教えてくださり、講座外のフォローも手厚すぎて感謝の気持ちでいっぱいです。四柱推命は中国から流れてきているので、講座外で気になった歴史のことなども詳しく教えてくださり、何を聞いても答えてくれるドラえもんのような先生でした。今後は、てつ先生が自然派四柱推命を広げていきたいという夢の力になれたらと思っております。ほんとうにありがとうございました。',
    },
    {
      id: 'voice-relearning-helped',
      title: '学び直しで理解がぐっと深まりました',
      meta: '30代女性',
      content:
        '一度四柱推命を学んだものの、なんとなくわかっていないところがありました。学び直しとしててつ先生の講座を受けましたが、さすが塾の先生！具体例も多いし、専門用語もわかりやすく教えてくださるので、とても理解が進みました！添削も丁寧にしてくださるのでありがたいです。',
    },
    {
      id: 'voice-gentle-and-clear',
      title: '難しい四柱推命を、丁寧にわかりやすく教えてもらえます',
      meta: '40代女性',
      content:
        'てつ先生の講座は、丁寧に難しい四柱推命をわかりやすく教えて頂けます。塾講師をされていただけあって、教え方や覚え方の工夫はとてもされていると思います。わからない所や質問も細かく丁寧に説明して頂けるので、独学でしていた頃に比べると本当に有り難く、安心です。講座もあっという間に時間が過ぎますし、持ってる知識を惜しみなく教えて下さるので、次の講座が待ち遠しいです。',
    },
    {
      id: 'voice-kind-recommendation',
      title: '優しく丁寧に学びたい人にはおすすめです',
      meta: '40代女性',
      content:
        'インスタでてつ先生を見つけて、とても優しそうな印象と安心感、説明がわかりやすかったので受講を決めました。授業は自分の命式を使って説明をしてくれるので、難しい話も頭に入りやすく、自分の深掘りもできます。優しく丁寧に学びたい人にはおすすめです。',
    },
    {
      id: 'voice-natural-scenery-entry',
      title: '公開鑑定で出会った「自然の景色」が、学びたい気持ちの入口になりました',
      meta: '30代女性',
      content:
        'てつ先生の公開鑑定を受けた際に、自分の中にある「自然の景色」に初めて触れ、とても嬉しかったのを覚えています。そこから、「学んでみたい」という気持ちが大きくなり、勇気を出して飛び込んでみました。てつ先生は、深い知識はもちろんのこと、講座中の小さな疑問にもすぐ応えてくださいます。なおかつ、理解しやすい言葉を選んで話してくださるので、イメージもつくし、スッと頭に入ってくるのです。毎回、「難しい。でもすごく楽しい」と思いながら受講させて頂いています。',
    },
    {
      id: 'voice-natural-landscape-style',
      title: '命式を自然の風景として理解できる鑑定に惹かれました',
      meta: '40代男性',
      content:
        'YouTubeの実践鑑定Liveを観て講座に応募しました。命式を自然の風景として実際に画像に起こして、命式をより直感的に理解できる鑑定はとても分かりやすいです。自分もこのスタイルで命式を見られるようになりたいと思い応募しました。実際の講義もマンツーマンで、どんな疑問にも答えてくれるというスタンスで、毎回の講義が楽しみです。',
    },
  ];
}

function pickRandomItems(items, count) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function makeExcerpt(text, maxLength = 96) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

// 講座紹介LP専用ページ（/kouza）: Tailwind付きのフルHTMLをそのまま返す
function renderKouzaCoursePage() {
  // 森林系の背景画像候補（白文字でも読みやすい、やや暗め〜中間トーン）
  const heroImages = [
    'https://images.pexels.com/photos/167684/pexels-photo-167684.jpeg?auto=compress&cs=tinysrgb&w=1600',
    'https://images.pexels.com/photos/976994/pexels-photo-976994.jpeg?auto=compress&cs=tinysrgb&w=1600',
    'https://images.pexels.com/photos/4827/nature-forest-trees-fog.jpeg?auto=compress&cs=tinysrgb&w=1600',
    'https://images.pexels.com/photos/94616/pexels-photo-94616.jpeg?auto=compress&cs=tinysrgb&w=1600',
    'https://images.pexels.com/photos/1670187/pexels-photo-1670187.jpeg?auto=compress&cs=tinysrgb&w=1600',
  ];
  const heroSrc = heroImages[Math.floor(Math.random() * heroImages.length)] || heroImages[0];

  // イントロセクション用の景色画像候補（木火土金水の要素が複数含まれる風景を想定）
  const introImages = [
    'https://images.pexels.com/photos/414171/pexels-photo-414171.jpeg?auto=compress&cs=tinysrgb&w=1200',
    'https://images.pexels.com/photos/552784/pexels-photo-552784.jpeg?auto=compress&cs=tinysrgb&w=1200',
    'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=1200',
  ];
  const introSrc = introImages[Math.floor(Math.random() * introImages.length)] || introImages[0];

  // ステップ03（用神）の山岳イメージ用ランダム画像
  const youjinImages = [
    // 朝日の当たる岩山
    'https://images.pexels.com/photos/618833/pexels-photo-618833.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 山岳地帯（ユーザー指定1）
    'https://images.pexels.com/photos/16716334/pexels-photo-16716334.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 山岳地帯（ユーザー指定2）
    'https://images.pexels.com/photos/17090644/pexels-photo-17090644.jpeg?auto=compress&cs=tinysrgb&w=800',
  ];
  const youjinSrc = youjinImages[Math.floor(Math.random() * youjinImages.length)] || youjinImages[0];

  // 五行カード用のランダム画像（木・火・金）
  const woodImages = [
    // 大きな樹木の並木
    'https://images.pexels.com/photos/1632790/pexels-photo-1632790.jpeg?auto=compress&cs=tinysrgb&w=800&v=1',
    // 緑豊かな森の小道
    'https://images.pexels.com/photos/167699/pexels-photo-167699.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 光が差し込む森
    'https://images.pexels.com/photos/4827/nature-forest-trees-fog.jpeg?auto=compress&cs=tinysrgb&w=800',
  ];
  const fireImages = [
    // 焚き火の炎（正面からのクローズアップ）
    'https://images.pexels.com/photos/7124316/pexels-photo-7124316.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 暖炉の炎
    'https://images.pexels.com/photos/316820/pexels-photo-316820.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 夜のキャンプファイヤー
    'https://images.pexels.com/photos/11946380/pexels-photo-11946380.jpeg?auto=compress&cs=tinysrgb&w=800',
  ];
  const metalImages = [
    // ゴツゴツした岩山
    'https://images.pexels.com/photos/673020/pexels-photo-673020.jpeg?auto=compress&cs=tinysrgb&w=800&v=2',
    // 宝石の接写（カラフルなラメ）
    'https://images.pexels.com/photos/1191710/pexels-photo-1191710.jpeg?auto=compress&cs=tinysrgb&w=800',
    // 石と鉱石のクローズアップ
    'https://images.pexels.com/photos/326648/pexels-photo-326648.jpeg?auto=compress&cs=tinysrgb&w=800',
  ];

  const woodSrc = woodImages[Math.floor(Math.random() * woodImages.length)] || woodImages[0];
  const fireSrc = fireImages[Math.floor(Math.random() * fireImages.length)] || fireImages[0];
  const metalSrc = metalImages[Math.floor(Math.random() * metalImages.length)] || metalImages[0];
  const featuredVoices = pickRandomItems(getVoiceTestimonials(), 3);
  const featuredVoicesHtml = featuredVoices
    .map(
      (voice) => `
                <a href="/voice#${voice.id}" class="group block rounded-[2rem] bg-white/90 border border-[#7d9d85]/10 shadow-lg shadow-[#2d3a32]/5 overflow-hidden transition duration-500 hover:-translate-y-1 hover:shadow-2xl">
                    <div class="p-8 md:p-10">
                        <div class="flex items-center gap-3 mb-5">
                            <span class="inline-flex items-center justify-center w-11 h-11 rounded-full bg-[#f4f7f2] text-[#7d9d85]">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg>
                            </span>
                            <div class="text-[11px] tracking-[0.18em] uppercase font-bold text-[#7d9d85]">${voice.meta}</div>
                        </div>
                        <h3 class="text-xl md:text-2xl font-bold text-[#2d3a32] leading-relaxed mb-5 text-balance">${voice.title}</h3>
                        <p class="text-sm md:text-base leading-loose text-gray-600 mb-8">${makeExcerpt(voice.content)}</p>
                        <span class="inline-flex items-center gap-3 text-sm font-bold tracking-[0.14em] text-[#2d3a32] group-hover:text-[#7d9d85] transition duration-300">
                            受講生の声をもっと見る
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
                        </span>
                    </div>
                </a>
      `
    )
    .join('');

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
                'hero': 'https://images.pexels.com/photos/167684/pexels-photo-167684.jpeg?auto=compress&cs=tinysrgb&w=1600',
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
        <div class="text-xl font-bold tracking-[0.2em] text-[#2d3a32]">自然の景色でみる四柱推命講座</div>
        <div class="hidden md:flex space-x-10 text-sm tracking-widest">
            <a href="/" class="hover:text-green-700 transition duration-300">メインサイト</a>
            <a href="#concept" class="hover:text-green-700 transition duration-300">コンセプト</a>
            <a href="#plans" class="hover:text-green-700 transition duration-300">講座案内</a>
            <a href="https://www.fuchilabo.com/products/kouzasetumei" class="hover:text-green-700 transition duration-300">お問い合わせ</a>
        </div>
    </nav>

    <!-- Hero Section -->
    <section class="relative h-screen flex items-center justify-center overflow-hidden bg-gray-900">
        <img src="${heroSrc}" 
             alt="" 
             class="absolute inset-0 w-full h-full object-cover"
             onerror="handleImageError(this, 'hero')">
        <div class="absolute inset-0 hero-overlay"></div>
        <div class="relative z-10 text-center px-6 max-w-5xl fade-in">
            <h1 class="text-white text-2xl md:text-5xl leading-snug md:leading-relaxed mb-10 drop-shadow-2xl tracking-[0.15em] text-balance">
                あなたの宿命は、<br>
                一枚の美しいキャンバス。<br>
                <span class="text-lg md:text-2xl mt-6 block font-light tracking-widest leading-loose">
                    「難解な漢字」を「大自然の景色」に書き換え、<br>
                    人生の歩み方を読み解く<br><br>
                    ——自然の景色でみる四柱推命講座——
                </span>
            </h1>
            <div class="mt-16">
                <a href="#intro" class="inline-block px-16 py-7 bg-white/10 hover:bg-white/30 text-white border border-white rounded-full transition duration-500 backdrop-blur-sm tracking-widest text-base">
                    無料講座説明会に参加する
                </a>
            </div>
        </div>
    </section>

    <!-- 1. 四柱推命は「怖い占い」ではありません -->
    <section id="intro" class="py-24 md:py-32 px-6 md:px-12 max-w-6xl mx-auto">
        <div class="flex flex-col lg:flex-row items-center gap-12 md:gap-16">
            <div class="w-full lg:w-1/2 image-container rounded-3xl shadow-2xl overflow-hidden text-center">
                <img src="${introSrc}" 
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
                        <img src="${woodSrc}" 
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
                        <img src="${fireSrc}" 
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
                        <img src="${metalSrc}" 
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

    <!-- 3. ステップセクション（コンセプト） -->
    <section id="concept" class="py-24 md:py-32 px-6 bg-white border-b border-gray-50">
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
                    <img src="${youjinSrc}"
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
                    <div class="max-w-5xl">
                        <div class="flex items-center gap-4 mb-6">
                            <span class="bg-[#7d9d85] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">レベル 01</span>
                            <span class="text-[11px] tracking-[0.35em] text-[#7d9d85] font-bold uppercase">Course Detail</span>
                        </div>

                        <h3 class="text-3xl md:text-4xl font-bold mb-3 text-[#2d3a32] tracking-[0.18em]">入 門 講 座</h3>
                        <p class="text-[#7d9d85] font-bold text-lg mb-8">基礎の基礎を「景色」の視点で整える</p>

                        <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 lg:gap-12 mb-10">
                            <div class="space-y-4 text-sm md:text-[15px] leading-loose text-gray-600">
                                <p>
                                    四柱推命の土台をつくり、命式に出る「各星」を自分で出せるようにします。まずは基礎の基礎を押さえ、読み解きの土台を固める講座です。
                                </p>
                                <p>
                                    中級講座と同じく、講座の全体像と各回の学習内容が一目で分かる形式に整えています。入門では、景色として命式を捉えるための最初の視点をしっかり育てます。
                                </p>
                            </div>

                            <div class="bg-[#f8fbf8] rounded-[2rem] border border-[#7d9d85]/15 p-6">
                                <div class="space-y-5 text-left">
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講時間</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">90分 × 2回</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講形式</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">Zoom（マンツーマン）<br>※講座後に動画アーカイブをお渡しします</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">学習範囲</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">2回で基礎を整理</div>
                                    </div>
                                    <div>
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">事前課題</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">「四柱推命完全マニュアル」第2章まで</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left mb-12">
                            <div class="bg-green-50/50 p-8 rounded-3xl">
                                <h4 class="font-bold text-sm text-[#7d9d85] mb-4 uppercase tracking-widest italic">目指すゴール</h4>
                                <p class="text-gray-700 leading-relaxed font-bold text-sm text-left">命式の各星の出し方を理解し、四柱推命の基礎の基礎を押さえる。</p>
                            </div>
                            <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic">受講特典</h4>
                                <ul class="text-sm text-gray-700 space-y-2 text-left">
                                    <li>・講座動画のアーカイブ配布</li>
                                    <li>・LINEでの質問無制限</li>
                                    <li>・各回ごとの演習課題付き</li>
                                </ul>
                            </div>
                        </div>

                        <div class="border-t border-gray-100 pt-10">
                            <div class="mb-8">
                                <h4 class="text-xl md:text-2xl font-bold text-[#2d3a32] tracking-[0.12em] mb-3">講座カリキュラム</h4>
                                <p class="text-sm text-gray-500 leading-relaxed">入門講座では、四柱推命の全体像と、十干・十二支の基礎理解を2回で整理します。</p>
                            </div>

                            <div class="space-y-5">
                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第1回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">概論・陰陽五行・五行の理解と相関</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">四柱推命全体の概論と、陰陽五行の基礎を景色の視点から整理します。</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第2回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">十干・十二支・六十干支・空亡・十二運</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">十干・十二支と六十干支の基本構造、空亡と十二運の導き方を学びます。</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. 中級講座 -->
                <div class="plan-card bg-white p-8 md:p-16 rounded-[2.5rem] shadow-xl border-2 border-[#7d9d85]/10 relative overflow-hidden group">
                    <div class="absolute top-0 right-0 bg-[#7d9d85] text-white text-[10px] md:text-xs font-bold px-10 py-3 tracking-widest rounded-bl-3xl uppercase">おすすめのコース</div>

                    <div class="max-w-5xl">
                        <div class="flex items-center gap-4 mb-6">
                            <span class="bg-[#7d9d85] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">レベル 02</span>
                            <span class="text-[11px] tracking-[0.35em] text-[#7d9d85] font-bold uppercase">Course Detail</span>
                        </div>

                        <h3 class="text-3xl md:text-4xl font-bold mb-3 text-[#2d3a32] tracking-[0.18em]">中 級 講 座</h3>
                        <p class="text-[#7d9d85] font-bold text-lg mb-8">五行バランスから「原命式」と「運気の流れ」を読み解く</p>

                        <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 lg:gap-12 mb-10">
                            <div class="space-y-4 text-sm md:text-[15px] leading-loose text-gray-600">
                                <p>
                                    木火土金水の五行バランスを軸に、原命式の傾向と運気の流れを捉える力を育てます。四柱推命の基本から、十干・十二支、通変、身旺身弱、内格・外格、用神、そして大運年運までを順序立てて学べる中核講座です。
                                </p>
                                <p>
                                    参考サイトのように「講座の全体像」と「各回で何を学ぶか」がすぐ見える構成に寄せつつ、ふちLABO.の中級講座では、全39項目を15回に整理して、実際の鑑定につながる理解へ落とし込めるようにしています。
                                </p>
                            </div>

                            <div class="bg-[#f8fbf8] rounded-[2rem] border border-[#7d9d85]/15 p-6">
                                <div class="space-y-5 text-left">
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講時間</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">2時間 × 15回 ＋ 質問会（60分）</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講形式</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">Zoom（マンツーマン）<br>※講座後に動画アーカイブをお渡しします</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">学習範囲</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">全39項目</div>
                                    </div>
                                    <div>
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">対象</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">基礎を踏まえた上で、命式全体の見方と運気の流れまで深めたい方</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left mb-12">
                            <div class="bg-green-50/50 p-8 rounded-3xl text-left">
                                <h4 class="font-bold text-sm text-[#7d9d85] mb-4 uppercase tracking-widest italic">目指すゴール</h4>
                                <p class="text-gray-700 leading-relaxed font-bold text-sm text-left">五行バランスから、原命式・運気の流れを見ることができるようになる。</p>
                            </div>
                            <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic">受講特典</h4>
                                <ul class="text-sm text-gray-700 space-y-2 font-bold text-left">
                                    <li>・LINEでの質問無制限</li>
                                    <li>・月1オンライン勉強会に参加</li>
                                    <li>・各回ごとのワーク（宿題）付き</li>
                                </ul>
                            </div>
                        </div>

                        <div class="border-t border-gray-100 pt-10">
                            <div class="mb-8">
                                <h4 class="text-xl md:text-2xl font-bold text-[#2d3a32] tracking-[0.12em] mb-3">講座カリキュラム</h4>
                                <p class="text-sm text-gray-500 leading-relaxed">参考サイトの「日ごとの講座紹介」に寄せて、中級講座の学習内容を回ごとに整理しています。</p>
                            </div>

                            <div class="space-y-5">
                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第1回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">四柱推命の基本</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>01. 四柱推命とは</li>
                                                <li>02. 大自然のイメージで</li>
                                                <li>03. 八文字だけシンプルに</li>
                                                <li>04. 基本的な鑑定方法</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第2回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">十干と十二支の概略</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>05. 五行がもつ特性</li>
                                                <li>06. 日主がもつ特性</li>
                                                <li>07. 十干の字義</li>
                                                <li>08. 十二支の字義</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第3回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">命式の算出と時柱</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>09. 干支の世界の時間概念</li>
                                                <li>10. 命式の算出方法</li>
                                                <li>11. 出生時間不明の場合</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第4回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">陰陽五行・十二支と蔵干 1</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>12. 陰陽論</li>
                                                <li>13. 五行論</li>
                                                <li>14. 五行の関係性</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第5回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">陰陽五行・十二支と蔵干 2</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>15. 生支・正支・墓支</li>
                                                <li>16. 十二支の実態</li>
                                                <li>17. 土の十二支（墓支）</li>
                                                <li>18. 同命式について</li>
                                                <li>19. 火土同根</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第6回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">五行属性の変化・五行鑑定</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>20. 十二支の法則</li>
                                                <li>21. 十干の法則</li>
                                                <li>22. 五行による性格</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第7回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">通変五種の理解</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>23. 通変五種の定義</li>
                                                <li>24. 通変五種の解説</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第8回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">命式の定位・通根・身旺身弱</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>25. 命式の定位</li>
                                                <li>26. 通根</li>
                                                <li>27. 身旺・身弱</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第9回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">内格・外格・用神 1</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>28. 命式の区分</li>
                                                <li>29. 内格の鑑定</li>
                                                <li>30. 外格の鑑定</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第10回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">内格・外格・用神 2</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>31. 用いるとは</li>
                                                <li>32. 用神・喜神</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第11回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">命式のスタイル</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>33. 外格スタイルと流動型スタイル</li>
                                                <li>34. 外格スタイル</li>
                                                <li>35. 流動型スタイル</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第12回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">立運と大運</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>36. 立運</li>
                                                <li>37. 大運</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第13回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">通変が巡る運勢の見方</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>38. それぞれの通変が巡る運勢</li>
                                                <li>39. 接木運・大運・年運</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-dashed border-[#7d9d85]/30 bg-[#f8fbf8] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">第14-15回</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">実践整理・ワーク・質問会</h5>
                                            <ul class="space-y-2 text-sm text-gray-700 leading-relaxed">
                                                <li>学んだ理論を命式読解へ落とし込むワーク</li>
                                                <li>苦手分野の整理と理解の定着</li>
                                                <li>質問会（60分）で疑問点を解消</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 3. 上級講座 -->
                <div class="plan-card bg-white p-8 md:p-16 rounded-[3rem] shadow-sm border border-gray-100">
                    <div class="max-w-5xl">
                        <div class="flex items-center gap-4 mb-6">
                            <span class="bg-[#2d3a32] text-white px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">レベル 03</span>
                            <span class="text-[11px] tracking-[0.35em] text-[#7d9d85] font-bold uppercase">Course Detail</span>
                        </div>

                        <h3 class="text-3xl md:text-4xl font-bold mb-3 text-[#2d3a32] tracking-[0.18em]">上 級 講 座</h3>
                        <p class="text-[#7d9d85] font-bold text-lg mb-8 text-left">鑑定を「生き方の戦略」へと昇華させる</p>

                        <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 lg:gap-12 mb-10">
                            <div class="space-y-4 text-sm md:text-[15px] leading-loose text-gray-600">
                                <p>
                                    「五行バランス」×「命式の景色」を統合し、より深い鑑定へ。仕事・恋愛・相性など具体的テーマも扱いながら、実践力を高めます。
                                </p>
                                <p>
                                    中級までで身につけた土台を前提に、上級ではより高度な推命理論やケース別の読み解き、開運戦略まで踏み込みます。中級と同じ流れで、講座の全体像と学習テーマを追える形に統一しています。
                                </p>
                            </div>

                            <div class="bg-[#f8fbf8] rounded-[2rem] border border-[#7d9d85]/15 p-6">
                                <div class="space-y-5 text-left">
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講時間</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">2時間 × 18回 ＋ 質問会（60分）</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講形式</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">Zoom（マンツーマン）<br>※講座後に動画アーカイブをお渡しします</div>
                                    </div>
                                    <div class="border-b border-[#7d9d85]/10 pb-4">
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">対象</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed">中級講座を踏まえ、より深い鑑定力と応用力を身につけたい方</div>
                                    </div>
                                    <div>
                                        <div class="text-[10px] text-[#7d9d85] mb-1 font-bold uppercase tracking-[0.25em]">受講条件</div>
                                        <div class="text-[#334139] font-bold text-sm leading-relaxed"><span class="text-red-600 text-xs font-bold">※本講座は「中級講座」受講者が対象です</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left mb-12">
                            <div class="bg-gray-50 p-8 rounded-3xl text-left">
                                <h4 class="font-bold text-sm text-[#2d3a32] mb-4 uppercase tracking-widest italic text-left">目指すゴール</h4>
                                <p class="text-gray-700 leading-relaxed font-bold text-sm text-left">「五行バランス」×「命式の景色」で原命式・運気の流れを見ることで、より深い鑑定ができるようになる。</p>
                            </div>
                            <div class="bg-amber-50/30 p-8 rounded-3xl text-left">
                                <h4 class="font-bold text-sm text-amber-700 mb-4 uppercase tracking-widest italic text-left">受講特典</h4>
                                <ul class="text-sm text-gray-700 space-y-2 font-bold text-left">
                                    <li>・LINEでの質問無制限</li>
                                    <li>・月1オンライン勉強会に参加</li>
                                    <li>・各回ごとのワーク（宿題）付き</li>
                                </ul>
                            </div>
                        </div>

                        <div class="border-t border-gray-100 pt-10">
                            <div class="mb-8">
                                <h4 class="text-xl md:text-2xl font-bold text-[#2d3a32] tracking-[0.12em] mb-3">講座カリキュラム</h4>
                                <p class="text-sm text-gray-500 leading-relaxed">上級講座では、実践鑑定へ直結する高度な理論と、テーマ別の深い読み解きを段階的に学びます。</p>
                            </div>

                            <div class="space-y-5">
                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">前半</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">高度な推命理論</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">十干百態論、五行の偏りによる調整法など、より精密な鑑定判断につながる理論を深く学びます。</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">中盤</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">実践鑑定テーマ</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">ビジネス運、恋愛・結婚、対人相性など、現実の相談で扱うテーマごとの見方を磨きます。</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-gray-100 bg-[#fcfdfc] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">後半</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">開運の極意</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">スタイル論を踏まえながら、一人ひとりに最適な戦略や行動の方向性を読み解く力を養います。</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-[2rem] border border-dashed border-[#7d9d85]/30 bg-[#f8fbf8] p-6 md:p-8">
                                    <div class="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                                        <div class="md:w-28 shrink-0">
                                            <div class="text-sm font-bold tracking-[0.2em] text-[#7d9d85]">まとめ</div>
                                        </div>
                                        <div class="flex-1">
                                            <h5 class="text-lg font-bold text-[#2d3a32] mb-3">実践力の統合</h5>
                                            <p class="text-sm text-gray-700 leading-relaxed">学んだ理論とテーマ別の読み方を統合し、より深く・より現実に活かせる鑑定へつなげます。</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 受講生の声 -->
            <div class="mt-20 md:mt-24 p-10 md:p-16 bg-[linear-gradient(135deg,#fcfdfc_0%,#f4f7f2_100%)] rounded-[3rem] border border-[#7d9d85]/10 shadow-xl">
                <div class="max-w-3xl mx-auto text-center mb-12 md:mb-16">
                    <div class="text-[#7d9d85] font-bold tracking-[0.24em] text-xs md:text-sm uppercase mb-5">Voice</div>
                    <h2 class="text-3xl md:text-4xl font-bold text-[#2d3a32] tracking-[0.08em] leading-relaxed mb-6 text-balance">受講生の声</h2>
                    <p class="text-gray-600 leading-loose md:text-lg">実際に学ばれた方のご感想から、講座の雰囲気や変化の実感を少しだけご紹介します。</p>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    ${featuredVoicesHtml}
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
            <a href="https://www.fuchilabo.com/products/kouzasetumei" class="inline-block bg-white text-[#2d3a32] hover:bg-[#7d9d85] hover:text-white px-16 py-6 rounded-full shadow-2xl transition duration-500 tracking-[0.2em] font-bold uppercase text-sm mb-10 text-center">
                無料講座説明会に参加する
            </a>
            <div class="mt-6 text-xs opacity-70 tracking-wide space-x-2">
                <a href="/legal" class="hover:underline">特定商取引法に関する表記</a>
                <span class="opacity-50">｜</span>
                <a href="/terms" class="hover:underline">利用規約</a>
                <span class="opacity-50">｜</span>
                <a href="/privacy" class="hover:underline">プライバシーポリシー</a>
            </div>
            <p class="mt-4 text-xs opacity-40 tracking-widest uppercase text-center">&copy; ふちLABO.  大自然の叡智を、あなたの人生に。</p>
        </div>
    </footer>

</body>
</html>`;
}

// AIセミナーLP専用ページ（/ai-web-seminar）: React アプリ用のシェルHTMLを返す
function renderAiWebSeminarPage() {
  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>知識ゼロからAIで創る WEBサイト構築セミナー</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body class="bg-[#fafaf9]">
    <div id="root"></div>
    <script type="text/babel" src="/ai-web-seminar.js"></script>
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

function renderTouyouPage() {
  const headExtras = `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@200;300;400;600;800&display=swap" rel="stylesheet" />
  `;

  const content = `
    <section class="touyou-hero">
      <div class="touyou-container">
        <div class="touyou-hero-card">
          <img src="/touyou-hero.jpg?v=20260522-1720" alt="四柱推命鑑定士のための東洋思想入門セミナー" class="touyou-hero-image" />
        </div>
        <div class="touyou-hero-cta">
          <a class="touyou-button" href="https://forms.gle/e3thGgqkCQPRi5AP8" target="_blank" rel="noopener noreferrer">四柱推命の“根っこ”を学んでみる</a>
          <a class="touyou-button-secondary" href="#agenda">学習内容を見る</a>
        </div>
      </div>
    </section>

    <section class="touyou-section">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">01</div>
          <div class="touyou-eyebrow">こんな経験、ありませんか？</div>
          <h2 class="touyou-section-heading">星の意味を暗記したのに、<br />なぜか鑑定現場で言葉が詰まってしまう</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-card-grid">
          <article class="touyou-card touyou-card-muted">
            <div class="touyou-card-number">01</div>
            <h3>命式全体になると<br />急に読めなくなる</h3>
            <p>「比肩は自立、食神は表現、正官は真面目…」と単語を覚えたのに、それらが混ざり合うと、どう解釈すべきか分からなくなってしまう。</p>
          </article>
          <article class="touyou-card touyou-card-muted">
            <div class="touyou-card-number">02</div>
            <h3>お客様に何を伝えたら<br />いいか迷ってしまう</h3>
            <p>知識はあるはずなのに、実際の鑑定現場になると適切なアドバイスが出ない。単なる「星の説明」の読み上げで終わってしまう。</p>
          </article>
          <article class="touyou-card touyou-card-muted">
            <div class="touyou-card-number">03</div>
            <h3>別の占術を学び直そうかと<br />思ってしまう</h3>
            <p>今の知識量に限界を感じてしまい、「やっぱりタロットや西洋占星術など、別の占術も手を出さないといけないのか」と焦ってしまう。</p>
          </article>
        </div>

        <div class="touyou-image-text" style="margin-top:4rem;">
          <div class="touyou-image-frame">
            <img src="https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=900&q=80" alt="書物を開いて深く思考する様子" />
          </div>
          <div style="display:grid; gap:1rem;">
            <div class="touyou-eyebrow">なぜそうなってしまうのか？</div>
            <h3 class="touyou-section-heading" style="font-size:1.7rem; text-align:left;">通変星の単語だけを追うと、言葉が「説明」で止まる</h3>
            <p class="touyou-copy">四柱推命の根っこにある「東洋思想」を押さえないまま、通変星や十二運の辞書的な意味だけを記憶して使っていると、状況に合わせた応用ができなくなります。</p>
            <p class="touyou-copy">命式は単語帳ではなく、<strong>「自然の景色」</strong>。山を「緑・茶・白」という色の名前だけで覚えようとしても、その山の美しさは伝えられません。根底にある思想を理解して初めて、命式が一つの生きたストーリーとして相手に伝えられるようになります。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="touyou-section touyou-section-muted">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">02</div>
          <div class="touyou-eyebrow">星の意味ではなく、なぜその意味が宿るのかを学ぶ</div>
          <h2 class="touyou-section-heading">東洋思想という「根っこ」に触れることで、<br />鑑定の言葉が深く、優しく、力強くなる。</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-banner">
          <div class="touyou-banner-content">
            <div>
              <div class="touyou-eyebrow" style="color:#f6f1eb;">命式は、自然の縮図</div>
              <h3>暗記を一度やめてみる。<br />その奥にある陰陽五行思想に目を向ける。</h3>
              <p class="touyou-copy" style="color:rgba(255,255,255,0.84);">その先に見えてくるのは、自然の循環、季節の巡り、そして人がどう在るかという深い思想。それらに触れたとき、鑑定の言葉は初めて、相手の心に届く厚みを持ちます。</p>
            </div>
          </div>
        </div>

        <div class="touyou-solution-grid" style="margin-top:4rem;">
          <div style="display:grid; gap:1.2rem;">
            <h3 class="touyou-section-heading" style="font-size:1.8rem; text-align:left;">陰陽五行は「分類」ではなく<br />「関係性と変化」を読むレンズ</h3>
            <p class="touyou-copy">多くの人が、五行を「木火土金水に物事を分けるための暗記表」だと誤解しています。</p>
            <p class="touyou-copy">本来の陰陽五行は、固定的な分類ではなく、五行どうしの<strong>関係性（相生・相剋・比和）</strong>と<strong>変化（季節・時間の流れ）</strong>を見るための動的な思想です。</p>
            <div class="touyou-highlight-box">
              <strong>「分類を覚える」から「景色を読む」へ。</strong><br />
              日干「木」は、ただの木ではありません。「上へ、外へと伸びようとする力」そのもの。その根っこが見えると、言葉は探さなくても自然と出てきます。
            </div>
          </div>
          <div class="touyou-solution-card">
            <div class="touyou-eyebrow" style="text-align:center;">五行の「動き」と「関係性」</div>
            <div class="touyou-gogyo-diagram" aria-hidden="true">
              <svg viewBox="0 0 100 100" role="presentation">
                <polygon points="50,15 80,75 20,40 80,40 20,75" fill="none" stroke="rgba(197, 168, 128, 0.35)" stroke-width="0.8" stroke-dasharray="2,2"></polygon>
                <circle cx="50" cy="50" r="33" fill="none" stroke="rgba(15, 44, 89, 0.12)" stroke-width="1"></circle>
              </svg>
              <div class="touyou-gogyo-node touyou-wood"><div class="touyou-gogyo-dot">木</div><span>伸びる</span></div>
              <div class="touyou-gogyo-node touyou-fire"><div class="touyou-gogyo-dot">火</div><span>燃え上がる</span></div>
              <div class="touyou-gogyo-node touyou-earth"><div class="touyou-gogyo-dot">土</div><span>受けとめる</span></div>
              <div class="touyou-gogyo-node touyou-metal"><div class="touyou-gogyo-dot">金</div><span>収束する</span></div>
              <div class="touyou-gogyo-node touyou-water"><div class="touyou-gogyo-dot">水</div><span>浸透する</span></div>
            </div>
            <p class="touyou-copy" style="margin-top:1.5rem; text-align:center;">五行が互いに関係し合う「動き」そのものが本来の陰陽五行論です。</p>
          </div>
        </div>
      </div>
    </section>

    <section id="agenda" class="touyou-section">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">03</div>
          <div class="touyou-eyebrow">セミナープログラム</div>
          <h2 class="touyou-section-heading">本セミナーで学べる4つの主要アジェンダ</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-program-grid">
          <article class="touyou-program-card">
            <div class="touyou-program-top">
              <div class="touyou-card-number">01</div>
              <div>
                <h3 style="margin-top:0;">四柱推命はどこから来たのか</h3>
                <div class="touyou-mini-label">歴史・ルーツから理解する</div>
              </div>
            </div>
            <p class="touyou-copy" style="margin-top:1rem;">四柱推命が占いとして突然発生したのではないこと。古代中国における自然観察・陰陽五行・儒教的人間理解が積み重なって出来た「思想の結晶」であることを紐解きます。</p>
          </article>
          <article class="touyou-program-card">
            <div class="touyou-program-top">
              <div class="touyou-card-number">02</div>
              <div>
                <h3 style="margin-top:0;">陰陽五行は「関係性と変化」</h3>
                <div class="touyou-mini-label">思想のレンズへアップデート</div>
              </div>
            </div>
            <p class="touyou-copy" style="margin-top:1rem;">単なる「分類表」の暗記から脱却し、相生・相剋の関係性や時間の流れとして命式を捉えるトレーニング。命式を静止した表ではなく、流動的な「景色」として捉え直します。</p>
          </article>
          <article class="touyou-program-card">
            <div class="touyou-program-top">
              <div class="touyou-card-number">03</div>
              <div>
                <h3 style="margin-top:0;">仁義礼智信が鑑定の言葉を深くする</h3>
                <div class="touyou-mini-label">儒教の徳目と通変星の関係</div>
              </div>
            </div>
            <p class="touyou-copy" style="margin-top:1rem;">儒教の徳目「五常」を五行・通変星と重ねて解釈する方法をお伝えします。「なぜその五行にその徳なのか」――思想史の根拠まで考えることで、鑑定の言葉に知的な確かさが加わります。</p>
          </article>
          <article class="touyou-program-card">
            <div class="touyou-program-top">
              <div class="touyou-card-number">04</div>
              <div>
                <h3 style="margin-top:0;">思想を知ると、行動提案ができる</h3>
                <div class="touyou-mini-label">鑑定から人生の「指針」へ</div>
              </div>
            </div>
            <p class="touyou-copy" style="margin-top:1rem;">命式の単なる「解説・説明」で終わる鑑定から、お客様の未来を具体的に切り開く「人生の行動指針」を提示するための、具体的かつ深みのある言葉の紡ぎ方を伝えます。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="touyou-section touyou-section-muted">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">04</div>
          <div class="touyou-eyebrow">ビフォー・アフター</div>
          <h2 class="touyou-section-heading">思想を背景に持つことで、<br />あなたの鑑定の言葉はここまで変わる。</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-compare-grid">
          <article class="touyou-compare-card">
            <div class="touyou-compare-tag before">BEFORE</div>
            <div class="touyou-mini-label" style="color:#6b7280; margin-top:0.25rem;">従来の暗記スタイル</div>
            <h3 style="color:#6b7280;">「木が強い人ですね」</h3>
            <ul class="touyou-list" style="color:#6b7280;">
              <li><span class="touyou-list-icon" style="color:#9ca3af;">×</span><span>星の表面的な性質をただ「読み上げる」だけ。</span></li>
              <li><span class="touyou-list-icon" style="color:#9ca3af;">×</span><span>言葉が「性質の説明」で止まってしまう。</span></li>
              <li><span class="touyou-list-icon" style="color:#9ca3af;">×</span><span>お客様が「で、結局どうすればいいの？」と感じる。</span></li>
            </ul>
          </article>
          <article class="touyou-compare-card after">
            <div class="touyou-compare-tag after">AFTER</div>
            <div class="touyou-mini-label">これからの思想スタイル</div>
            <h3>「伸びようとする力（曲直）がとても強い方です。ですので…」</h3>
            <ul class="touyou-list">
              <li><span class="touyou-list-icon">○</span><span>「なぜその星にその意味があるのか」が、人間の在り方から自然に説明できる。</span></li>
              <li><span class="touyou-list-icon">○</span><span>お客様の状況に合わせた具体的な行動提案が、迷わず言葉にできる。</span></li>
              <li><span class="touyou-list-icon">○</span><span>お客様が「人生の指針」として深く納得し、言葉を自分のものとして受け取れる。</span></li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="touyou-section">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">05</div>
          <div class="touyou-eyebrow">講師紹介</div>
          <h2 class="touyou-section-heading">「東洋思想を踏まえて四柱推命を伝える」</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-instructor-grid">
          <div class="touyou-instructor-photo">
            <div class="touyou-image-frame">
              <img src="/touyou-instructor.jpg" alt="てつ先生" />
            </div>
          </div>
          <div style="display:grid; gap:1rem;">
            <div class="touyou-mini-label">ふちLABO. 主宰</div>
            <h3 class="touyou-section-heading" style="font-size:2rem; text-align:left; margin:0;">てつ先生</h3>
            <p class="touyou-copy" style="font-weight:700; padding-bottom:0.8rem; border-bottom:1px solid #e5e7eb;">自然派四柱推命講師・鑑定士</p>
            <p class="touyou-copy">大学時代に哲学を専攻し、ドイツ観念論を中心に、人間の知恵や思想史を学ぶ。</p>
            <p class="touyou-copy">その後、四柱推命と出会い、命式の奥にある陰陽五行、自然観察、儒教的人間理解の深みに魅了される。</p>
            <p class="touyou-copy">一方で、一般的な四柱推命の学びが「星のキーワード暗記」に偏りがちなことに違和感を抱き、「東洋思想から四柱推命を伝える」という独自のスタイルを確立。</p>
            <p class="touyou-copy">単語の丸暗記ではなく、「なぜその意味が宿るのか」を根っこから解説する講義は、本質を学びたい鑑定士から「圧倒的に分かりやすい」「これこそ求めていた講義だ」と支持されている。</p>
          </div>
        </div>
      </div>
    </section>

    <section id="register" class="touyou-section touyou-section-muted" style="border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb;">
      <div class="touyou-container">
        <div class="touyou-section-title">
          <div class="touyou-section-number">06</div>
          <div class="touyou-eyebrow">セミナー開催情報</div>
          <h2 class="touyou-section-heading">あなたの鑑定が、<br />説明から<br />人生の指針に変わる時間。</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-register-hero">
          <div class="touyou-image-frame">
            <img src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80" alt="自宅でのオンラインセミナー受講イメージ" />
          </div>
          <div style="display:grid; gap:1rem;">
            <h3 style="margin:0; color:#0f2c59; font-family:'Noto Serif JP', 'Hiragino Mincho ProN', serif;">ご自宅で、リラックスしてご参加いただけます</h3>
            <p class="touyou-copy">セミナーはZoomによるオンライン形式です。温かくリラックスした雰囲気の中で、東洋思想の根っこにじっくり触れていただけます。</p>
            <p class="touyou-copy">当日参加できない場合や、改めてじっくり見直したい場合も、<strong>アーカイブ動画</strong>を参加者全員にお届けします。どうぞ安心してお申し込みください。</p>
            <p class="touyou-copy" style="font-size:0.92rem;">※アーカイブ動画に参加者の皆さまのお顔・お姿は映りませんので、ご安心ください。</p>
          </div>
        </div>

        <div class="touyou-outline-card" style="margin-top:2rem;">
          <h3 class="touyou-outline-heading">四柱推命鑑定士のための東洋思想入門セミナー</h3>
          <div class="touyou-info-list">
            <div class="touyou-info-row">
              <div class="touyou-info-label"><span class="touyou-info-badge">日</span><span>開催日時</span></div>
              <div class="touyou-info-value">
                <div class="touyou-date-chip">【日程A】2026年6月4日(木) 21:00〜22:30 <span class="touyou-status-badge touyou-status-full">満員御礼</span></div>
                <div style="height:0.6rem;"></div>
                <div class="touyou-date-chip">【日程B】2026年6月14日(日) 21:00〜22:30 <span class="touyou-status-badge touyou-status-open">若干名受付可能</span></div>
              </div>
            </div>
            <div class="touyou-info-row">
              <div class="touyou-info-label"><span class="touyou-info-badge">配</span><span>開催方法</span></div>
              <div class="touyou-info-value">
                <div style="font-weight:800; color:#0f2c59;">Zoomによるオンラインリアルタイム配信</div>
              </div>
            </div>
            <div class="touyou-info-row">
              <div class="touyou-info-label"><span class="touyou-info-badge">費</span><span>参加費</span></div>
              <div class="touyou-info-value" style="font-size:1.4rem; font-weight:800; color:#0f2c59;">
                3,980円 <span style="font-size:0.78rem; font-weight:500; color:rgba(15,44,89,0.58);">(税込)</span>
              </div>
            </div>
            <div class="touyou-info-row">
              <div class="touyou-info-label"><span class="touyou-info-badge">支</span><span>支払方法</span></div>
              <div class="touyou-info-value" style="font-weight:800; color:#0f2c59;">
                <div>銀行振込</div>
                <div style="height:0.4rem;"></div>
                <div>クレジットカード（PayPal）</div>
              </div>
            </div>
            <div class="touyou-info-row">
              <div class="touyou-info-label"><span class="touyou-info-badge">特</span><span>豪華セミナー参加特典</span></div>
              <div class="touyou-info-value">
                <div><span class="touyou-gift-chip">特典① 講義資料（PDF）</span></div>
                <div style="height:0.6rem;"></div>
                <div><span class="touyou-gift-chip">特典② アーカイブ録画動画</span></div>
              </div>
            </div>
          </div>

          <div class="touyou-step-box">
            <div class="touyou-mini-label" style="margin-bottom:0.6rem;">お申し込みステップ</div>
            <p class="touyou-copy">下記のボタン（Googleフォーム）より、日程・決済方法を選択してお申し込みください。</p>
            <div class="touyou-flow-grid">
              <div class="touyou-flow-card">
                <div class="touyou-flow-step">STEP 1</div>
                <h4>ご案内メール</h4>
                <p>お申し込み後、決済方法のご案内メールをお送りします。</p>
              </div>
              <div class="touyou-flow-arrow">→</div>
              <div class="touyou-flow-card">
                <div class="touyou-flow-step">STEP 2</div>
                <h4>決済確認</h4>
                <p>ご案内に沿ってお手続きいただき、こちらで決済確認を行います。</p>
              </div>
              <div class="touyou-flow-arrow">→</div>
              <div class="touyou-flow-card">
                <div class="touyou-flow-step">STEP 3</div>
                <h4>Zoomリンク送付</h4>
                <p>確認完了後、当日のZoom参加リンクをお届けします。</p>
              </div>
            </div>
          </div>

          <div class="touyou-register-button-wrap">
            <a class="touyou-button" href="https://forms.gle/e3thGgqkCQPRi5AP8" target="_blank" rel="noopener noreferrer">希望日程を選んで申し込む</a>
            <p class="touyou-register-note">ご入力いただいた個人情報は適切に管理されます</p>
          </div>
        </div>
      </div>
    </section>

    <section class="touyou-section">
      <div class="touyou-container" style="max-width:920px;">
        <div class="touyou-section-title">
          <div class="touyou-section-number">07</div>
          <div class="touyou-eyebrow">よくある質問</div>
          <h2 class="touyou-section-heading">疑問にお答えします</h2>
          <div class="touyou-divider"></div>
        </div>

        <div class="touyou-faq-list">
          <article class="touyou-faq-item">
            <div class="touyou-faq-head">
              <div class="touyou-qmark">Q.</div>
              <div>
                <h3 style="margin:0; font-size:1.05rem;">四柱推命を始めたばかりの初心者ですが、参加しても大丈夫でしょうか？</h3>
                <p class="touyou-copy" style="margin-top:0.8rem;">はい、大歓迎です。難しい専門用語や複雑なロジックを深追いするセミナーではありません。むしろ、最初に東洋思想という大原則を押さえておくと、今後の学習スピードと理解度が何倍も早くなるという内容です。まだご自身の鑑定に自信がない方にこそおすすめです。</p>
              </div>
            </div>
          </article>
          <article class="touyou-faq-item">
            <div class="touyou-faq-head">
              <div class="touyou-qmark">Q.</div>
              <div>
                <h3 style="margin:0; font-size:1.05rem;">プロの鑑定士として既に活動していますが、何か新しい学びはありますか？</h3>
                <p class="touyou-copy" style="margin-top:0.8rem;">十分にございます。本セミナーでは、西洋・東洋の思想史に精通した講師が、陰陽五行説や儒教の五常（仁義礼智信）がどのように歴史の変遷の中で四柱推命の星と結びつけられたのかを紐解きます。キーワードに歴史的・哲学的な裏付けが加わることで、お客様への提案力が深まります。</p>
              </div>
            </div>
          </article>
          <article class="touyou-faq-item">
            <div class="touyou-faq-head">
              <div class="touyou-qmark">Q.</div>
              <div>
                <h3 style="margin:0; font-size:1.05rem;">当日、急に都合が悪くなってしまった場合のキャンセルは可能ですか？</h3>
                <p class="touyou-copy" style="margin-top:0.8rem;">基本的にはキャンセル不可とさせていただいておりますが、別日程への振り替え、またはアーカイブ動画のお渡しで対応いたします。<br />どうしてもキャンセルが必要な場合は、セミナー3時間前までに下記までメールにてご連絡ください。返金は振込にて対応いたしますが、振込手数料はお客様のご負担となります。<br />📩 info@fuchilabo.com</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  `;

  return renderPage({
    title: '四柱推命鑑定士のための東洋思想入門セミナー',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
    bodyClass: 'touyou-body',
    pageClass: 'touyou-page',
    headExtras,
  });
}

function renderYobikouPage() {
  const headExtras = `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;700;800&family=Noto+Serif+JP:wght@300;400;500;700&display=swap" rel="stylesheet" />
  `;

  const ctaUrl = 'https://www.fuchilabo.com/products/yobikou-tetsu';
  const voices = getVoiceTestimonials().slice(0, 4);
  const voiceCards = voices
    .map(
      (voice) => `
        <article class="yobikou-voice-card">
          <div class="yobikou-voice-mark">声</div>
          <h3>${voice.title}</h3>
          <p class="yobikou-voice-meta">${voice.meta}</p>
          <p>${voice.content}</p>
        </article>
      `
    )
    .join('');

  const content = `
    <section class="yobikou-hero">
      <div class="yobikou-hero-backdrop"></div>
      <div class="yobikou-shell yobikou-hero-inner">
        <div class="yobikou-hero-copy">
          <div class="yobikou-kicker">Natural Suimei Prep School</div>
          <div class="yobikou-hero-grid">
            <div class="yobikou-vertical-wrap">
              <div class="yobikou-writing-vertical">学んだ自然派四柱推命を、</div>
              <div class="yobikou-writing-vertical yobikou-writing-accent">「鑑定で使える力」へ。</div>
            </div>
            <div class="yobikou-hero-textbox">
              <h1>自然派四柱推命予備校</h1>
              <p class="yobikou-hero-lead">「読める」を「届けられる」に変える、伴走型の実践サブスク。</p>
              <p>知識を増やすだけでなく、お客様に届く言葉に変えるための練習と添削、そして継続の場をひとつにまとめました。</p>
              <div class="yobikou-cta-row">
                <a class="yobikou-button" href="${ctaUrl}">予備校の詳細を見る</a>
                <a class="yobikou-button yobikou-button-secondary" href="#yobikou-program">学べる内容を見る</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="yobikou-section">
      <div class="yobikou-shell">
        <div class="yobikou-section-head">
          <div class="yobikou-line"></div>
          <div class="yobikou-kicker">こんなお悩みはありませんか</div>
          <h2>学んできたのに、<br />いざ鑑定になると不安になる。</h2>
        </div>
        <div class="yobikou-problem-grid">
          <article class="yobikou-problem-card">
            <span>01</span>
            <h3>命式は読めるのに、<br />伝える言葉が出てこない</h3>
            <p>知識はあるはずなのに、お客様の前で言葉が止まり、「説明」で終わってしまう。</p>
          </article>
          <article class="yobikou-problem-card">
            <span>02</span>
            <h3>鑑定練習の場がなく、<br />自信が育たない</h3>
            <p>ひとりで復習しても、実践の手応えやフィードバックが得られず、前進している実感が持てない。</p>
          </article>
          <article class="yobikou-problem-card">
            <span>03</span>
            <h3>学びっぱなしで終わり、<br />仕事につながらない</h3>
            <p>講座を受けたあとに日常へ戻ると、いつの間にか手が止まり、鑑定の筋力がつきにくい。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="yobikou-section yobikou-section-deep">
      <div class="yobikou-shell">
        <div class="yobikou-story-layout">
          <div class="yobikou-story-copy">
            <div class="yobikou-kicker">予備校という選択</div>
            <h2>自然派四柱推命予備校は、<br />知識を現場の力へ変えるための場所です。</h2>
            <p>自然の景色として命式を読む感覚を、実際の鑑定に落とし込むには、学び直しと実践の往復が欠かせません。</p>
            <p>予備校では、理解を深めるインプットだけでなく、言語化・添削・質問・継続をひとつの流れにして、あなたの「わかる」を「使える」へ育てていきます。</p>
            <div class="yobikou-highlight">
              <strong>講座の続き</strong>ではなく、<strong>鑑定者として育っていくための伴走の場</strong>。
            </div>
          </div>
          <div class="yobikou-story-panel">
            <div class="yobikou-panel-label">変化のイメージ</div>
            <div class="yobikou-flow">
              <div class="yobikou-flow-box">学んだ知識</div>
              <div class="yobikou-flow-arrow">→</div>
              <div class="yobikou-flow-box">命式を景色で捉える</div>
              <div class="yobikou-flow-arrow">→</div>
              <div class="yobikou-flow-box">相手に届く言葉で伝える</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="yobikou-program" class="yobikou-section">
      <div class="yobikou-shell">
        <div class="yobikou-section-head">
          <div class="yobikou-line"></div>
          <div class="yobikou-kicker">学べること</div>
          <h2>予備校で育てていく4つの力</h2>
        </div>
        <div class="yobikou-feature-grid">
          <article class="yobikou-feature-card">
            <div class="yobikou-feature-no">壱</div>
            <h3>命式を立体で読む力</h3>
            <p>単発の知識ではなく、全体の景色や流れとして命式をつかみ、解釈の軸を安定させます。</p>
          </article>
          <article class="yobikou-feature-card">
            <div class="yobikou-feature-no">弐</div>
            <h3>鑑定で届ける言語化力</h3>
            <p>「知っている」を超えて、相手に安心と納得が届く伝え方へ整えていきます。</p>
          </article>
          <article class="yobikou-feature-card">
            <div class="yobikou-feature-no">参</div>
            <h3>質問しながら深める力</h3>
            <p>わからない部分を抱えたままにせず、その都度ほどいて理解を積み上げられます。</p>
          </article>
          <article class="yobikou-feature-card">
            <div class="yobikou-feature-no">四</div>
            <h3>継続して鑑定筋を育てる力</h3>
            <p>単発で終わらない環境の中で、日々の練習を無理なく習慣化し、自信へつなげます。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="yobikou-section">
      <div class="yobikou-shell">
        <div class="yobikou-section-head">
          <div class="yobikou-line"></div>
          <div class="yobikou-kicker">おすすめの方</div>
          <h2>こんな方に、特にフィットします。</h2>
        </div>
        <div class="yobikou-fit-grid">
          <article class="yobikou-fit-card">
            <h3>講座は受けたけれど、まだ鑑定がこわい方</h3>
            <p>最初の一歩を、ひとりで抱え込まずに進めたい方へ。</p>
          </article>
          <article class="yobikou-fit-card">
            <h3>知識を増やすより、使える形に整えたい方</h3>
            <p>学びを積み足すより、今ある理解を実践へ変えたい方へ。</p>
          </article>
          <article class="yobikou-fit-card">
            <h3>自然派四柱推命を、自分の言葉で届けたい方</h3>
            <p>ふちLABO.の世界観を土台に、自分らしい鑑定を育てたい方へ。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="yobikou-section yobikou-section-soft">
      <div class="yobikou-shell">
        <div class="yobikou-section-head">
          <div class="yobikou-line"></div>
          <div class="yobikou-kicker">受講生の声</div>
          <h2>少しずつでも、確かな変化が積み上がっています。</h2>
        </div>
        <div class="yobikou-voice-grid">
          ${voiceCards}
        </div>
      </div>
    </section>

    <section class="yobikou-section">
      <div class="yobikou-shell">
        <div class="yobikou-teacher-card">
          <div class="yobikou-teacher-photo">
            <img src="/touyou-instructor.jpg" alt="てつ先生" />
          </div>
          <div class="yobikou-teacher-copy">
            <div class="yobikou-kicker">Teacher</div>
            <h2>てつ先生</h2>
            <p class="yobikou-teacher-role">自然派四柱推命講師・鑑定士</p>
            <p>大学時代に哲学を学び、その後四柱推命の奥にある陰陽五行や自然観に魅了され、自然派四柱推命の世界を探究。</p>
            <p>キーワードの丸暗記ではなく、「なぜその意味が宿るのか」を景色と思想から解きほぐす講義スタイルで、多くの受講生の実践力を支えてきました。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="yobikou-section yobikou-section-cta">
      <div class="yobikou-shell">
        <div class="yobikou-cta-panel">
          <div class="yobikou-kicker">Final Call</div>
          <h2>「もっと読めるようになりたい」から、<br />「ちゃんと届けられるようになりたい」へ。</h2>
          <p>自然派四柱推命を学んだその先へ進みたい方のために、予備校という継続の場を用意しました。詳細は下記ページからご確認いただけます。</p>
          <a class="yobikou-button" href="${ctaUrl}">自然派四柱推命予備校の詳細を見る</a>
        </div>
      </div>
    </section>

    <div class="yobikou-sticky-cta">
      <a href="${ctaUrl}">予備校の詳細を見る</a>
    </div>
  `;

  return renderPage({
    title: '自然派四柱推命予備校',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
    bodyClass: 'yobikou-body',
    pageClass: 'yobikou-page',
    headExtras,
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

function isLikelySpamContact(body) {
  const honeypot = String((body && body.website) || '').trim();
  if (honeypot) {
    return true;
  }

  const startedAtRaw = Number((body && body.contactFormStartedAt) || 0);
  if (Number.isFinite(startedAtRaw) && startedAtRaw > 0) {
    const elapsedMs = Date.now() - startedAtRaw;
    if (elapsedMs >= 0 && elapsedMs < 2000) {
      return true;
    }
  }

  const name = String((body && body.name) || '').trim();
  const email = String((body && body.email) || '').trim().toLowerCase();
  const message = String((body && body.message) || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return true;
  }

  const japaneseChars = (message.match(/[ぁ-んァ-ヶ一-龠々ー]/g) || []).length;
  const urlCount = (message.match(/https?:\/\/|www\./gi) || []).length;
  const condensedMessage = message.replace(/\s+/g, '');
  const isAsciiOnlyLongToken = /^[A-Za-z0-9_-]+$/.test(condensedMessage) && condensedMessage.length >= 20;
  const asciiOnlyName = /^[A-Za-z0-9_-]{8,}$/.test(name);

  if (urlCount >= 2) {
    return true;
  }

  if (japaneseChars === 0 && isAsciiOnlyLongToken) {
    return true;
  }

  if (japaneseChars === 0 && asciiOnlyName && isAsciiOnlyLongToken) {
    return true;
  }

  return false;
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
    navVariant: 'chigusa',
  });
}

function renderContactPage(errors, body) {
  const safe = (v) => (v == null ? '' : String(v));
  const name = safe(body && body.name);
  const email = safe(body && body.email);
  const phone = safe(body && body.phone);
  const orderNumber = safe(body && body.orderNumber);
  const message = safe(body && body.message);
  const contactFormStartedAt =
    body && body.contactFormStartedAt ? safe(body.contactFormStartedAt) : String(Date.now());

  const errorText = errors && errors.length ? `<p style="color:#dc2626;">入力内容をご確認ください。</p>` : '';

  const content = `
    <section style="max-width: 720px; margin: 0 auto;">
      <div class="panel">
        <h3>お問い合わせ</h3>
        <p>鑑定や講座に関するご質問、ご不明点などがありましたら、こちらのフォームからお送りください。</p>
        ${errorText}
        <form class="reservation-form" method="POST" action="/contact">
          <input type="hidden" name="contactFormStartedAt" value="${contactFormStartedAt}" />
          <div style="position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
            <label for="website">Webサイト</label>
            <input id="website" name="website" type="text" value="" tabindex="-1" autocomplete="off" />
          </div>
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

function renderVoicePage() {
  const content = `
    <style>
      .voice-page {
        margin: -3rem calc(50% - 50vw) -3rem;
        min-height: 100vh;
        background: #fcfbf9;
        color: #292524;
      }
      .voice-container {
        width: min(100%, 1120px);
        margin: 0 auto;
        padding: 0 1.5rem;
        box-sizing: border-box;
      }
      .voice-hero {
        position: relative;
        overflow: hidden;
        padding: 6rem 0;
        background: #ffffff;
        border-bottom: 1px solid #f5f5f4;
        text-align: center;
      }
      .voice-hero::after {
        content: '';
        position: absolute;
        top: -12rem;
        right: -12rem;
        width: 24rem;
        height: 24rem;
        border-radius: 999px;
        background: rgba(254, 243, 199, 0.45);
        filter: blur(42px);
      }
      .voice-hero-inner {
        position: relative;
        z-index: 1;
      }
      .voice-hero h1 {
        margin: 0 0 1.5rem;
        font-size: clamp(2rem, 4vw, 2.9rem);
        letter-spacing: 0.18em;
        font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
        font-weight: 400;
      }
      .voice-hero p {
        max-width: 42rem;
        margin: 0 auto;
        color: #57534e;
        line-height: 2;
        font-size: 1rem;
        font-weight: 500;
      }
      .voice-soft-section {
        padding: 5rem 0;
        background: #f4f1ea;
      }
      .voice-checklist {
        position: relative;
        background: #ffffff;
        padding: 2.75rem 2.5rem;
        border-radius: 2.5rem;
        border: 1px solid #f5f5f4;
        box-shadow: 0 10px 30px rgba(41, 37, 36, 0.05);
      }
      .voice-checklist h3 {
        color: #292524;
        font-size: 1.8rem;
        margin-top: 0;
        margin-bottom: 2.5rem;
        text-align: center;
        font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
        font-weight: 400;
      }
      .voice-checklist ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 1.25rem;
      }
      .voice-checklist li {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        color: #44403c;
        font-weight: 500;
        line-height: 1.8;
      }
      .voice-check-icon {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        margin-top: 0.1rem;
        color: #b45309;
        background: #fef3c7;
        border-radius: 999px;
      }
      .voice-section {
        padding: 5rem 0;
      }
      .voice-section-title {
        text-align: center;
        margin-bottom: 4rem;
      }
      .voice-section-title span {
        display: inline-block;
        padding-bottom: 0.75rem;
        border-bottom: 2px solid #fde68a;
        font-size: 1.6rem;
        color: #292524;
        font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
        font-weight: 400;
      }
      .voice-cards {
        display: grid;
        gap: 3rem;
      }
      .voice-cards.voice-cards-compact {
        gap: 2.5rem;
      }
      .voice-alt {
        background: #fafaf9;
      }
      .voice-card {
        position: relative;
        background: #ffffff;
        border: 1px solid #f5f5f4;
        border-radius: 2rem;
        padding: 2.5rem;
        box-shadow: 0 8px 24px rgba(41, 37, 36, 0.05);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        scroll-margin-top: 7rem;
      }
      .voice-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 40px rgba(41, 37, 36, 0.08);
      }
      .voice-card h4 {
        font-size: 1.35rem;
        color: #292524;
        margin-top: 0;
        margin-bottom: 0.5rem;
        line-height: 1.5;
        font-weight: 700;
      }
      .voice-meta {
        font-size: 0.76rem;
        color: #b45309;
        margin-bottom: 1rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .voice-quote {
        margin-bottom: 1rem;
        color: #fcd34d;
      }
      .voice-text {
        font-size: 1rem;
        color: #44403c;
        white-space: pre-line;
        line-height: 1.9;
        text-align: justify;
      }
      .voice-summary {
        padding: 5rem 0;
        background: #f4f1ea;
      }
      .voice-summary h2 {
        margin: 0 0 2.75rem;
        font-size: clamp(1.9rem, 3vw, 2.5rem);
        text-align: center;
        color: #292524;
        font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
        font-weight: 400;
      }
      .voice-summary-list {
        display: grid;
        gap: 1.25rem;
      }
      .voice-summary-item {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        padding: 1.5rem;
        border-radius: 1.5rem;
        background: #ffffff;
        border: 1px solid rgba(245, 245, 244, 0.7);
        box-shadow: 0 8px 18px rgba(41, 37, 36, 0.04);
      }
      .voice-summary-number {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        background: #fffbeb;
        color: #b45309;
        border: 1px solid #fde68a;
      }
      .voice-summary-item p {
        margin: 0;
        color: #44403c;
        line-height: 1.8;
        font-weight: 500;
      }
      .voice-cta-section {
        padding: 6rem 0;
        background: #ffffff;
        border-top: 1px solid #f5f5f4;
      }
      .voice-cta-section h2 {
        margin-top: 0;
        margin-bottom: 2.5rem;
        font-size: clamp(1.8rem, 3vw, 2.4rem);
        text-align: center;
        color: #292524;
        font-family: "Times New Roman", "Yu Mincho", "Hiragino Mincho ProN", serif;
        font-weight: 400;
      }
      .voice-cta {
        max-width: 48rem;
        margin: 0 auto;
        padding: 2.75rem 2.25rem;
        background: #fcfbf9;
        border: 1px solid #fef3c7;
        border-radius: 2.5rem;
        box-shadow: 0 12px 30px rgba(41, 37, 36, 0.05);
        text-align: center;
      }
      .voice-cta-intro {
        margin: 0 0 2rem;
        color: #44403c;
        line-height: 2.1;
      }
      .voice-cta-points {
        max-width: 26rem;
        margin: 0 auto 2rem;
        display: grid;
        gap: 0.9rem;
        text-align: left;
      }
      .voice-cta-point {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: #57534e;
        line-height: 1.7;
        font-size: 0.95rem;
      }
      .voice-cta-note {
        margin: 0 0 2rem;
        color: #292524;
        font-weight: 700;
      }
      .cta-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        background: #1c1917;
        color: #ffffff;
        text-decoration: none;
        padding: 1.1rem 2.75rem;
        border-radius: 999px;
        font-weight: 700;
        font-size: 1rem;
        transition: background 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
        box-shadow: 0 16px 28px rgba(28, 25, 23, 0.18);
      }
      .cta-button:hover {
        background: #292524;
        transform: scale(1.03);
      }
      .voice-footer-space {
        padding: 3rem 0 0;
      }
      @media (max-width: 640px) {
        .voice-page {
          margin-top: -2rem;
        }
        .voice-hero,
        .voice-soft-section,
        .voice-section,
        .voice-summary,
        .voice-cta-section {
          padding: 4rem 0;
        }
        .voice-checklist,
        .voice-card,
        .voice-cta {
          padding: 1.75rem 1.4rem;
          border-radius: 1.75rem;
        }
        .voice-checklist h3,
        .voice-summary h2,
        .voice-cta-section h2 {
          font-size: 1.6rem;
        }
        .voice-section-title {
          margin-bottom: 2.5rem;
        }
        .voice-section-title span {
          font-size: 1.3rem;
        }
        .voice-card {
          padding: 1.75rem 1.4rem;
        }
        .voice-summary-item {
          align-items: flex-start;
        }
        .voice-summary-number {
          margin-top: 0.1rem;
        }
        .cta-button {
          width: 100%;
        }
      }
    </style>
    <div class="voice-page">
      <section class="voice-hero">
        <div class="voice-container voice-hero-inner">
          <h1>受講生の声</h1>
          <p>自然派四柱推命講座を受講された方のご感想です。<br>他の講座で学んでも鑑定に自信が持てなかった方や、<br>もっと本質的に命式を読みたい方から、こうした声をいただいています。</p>
        </div>
      </section>

      <section class="voice-soft-section">
        <div class="voice-container">
          <div class="voice-checklist">
            <h3>こんな方に選ばれています</h3>
            <ul>
              <li><span class="voice-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span>他の流派や講座で学んだけれど、鑑定に自信が持てなかった方。</span></li>
              <li><span class="voice-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span>難しい理論を、わかりやすく本質から学びたい方。</span></li>
              <li><span class="voice-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span>「景色で読み解く」自然派四柱推命に惹かれた方。</span></li>
              <li><span class="voice-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span>学んで終わりではなく、実践で使える鑑定力を身につけたい方。</span></li>
              <li><span class="voice-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span>講座後のフォローまで含めて、安心して学びたい方。</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section class="voice-section">
        <div class="voice-container">
          <div class="voice-section-title"><span>他で学んだけれど、自信が持てなかった方の声</span></div>
          <div class="voice-cards">
            <article id="voice-difficult-to-find-right-course" class="voice-card">
              <h4>講座難民だった私が、ようやく納得できる講座に出会えました</h4>
              <div class="voice-meta">40代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">いくつか講座を受けても自信が持てなかった四柱推命ですが、てつ先生に教えていただき、「景色で読み解く」ことで、命式を見てその人に合った開運方法や運気が分かり、四柱推命の捉え方が掴めるようになりました。
奥深さや終わりのない学びへの理解も深まり、学ぶことが楽しいだけでなく、実際に使える力へと変わっていく感覚も得られました。
基本を深く丁寧に学べる上に、アフターフォローも充実しており、お人柄の温かさにも支えられながら、実践で使える鑑定力が身についたと実感しています。
講座難民だった私が、ようやく納得できる講座に出会えました。</div>
            </article>

            <article id="voice-confidence-in-reading" class="voice-card">
              <h4>自信を持って鑑定できるようになりました</h4>
              <div class="voice-meta">30代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">四柱推命の多くの講座を受けてきましたが、鑑定に自信が持てず足踏みしていた私。
てつ先生の講座を受けて、お客様に寄り添いながら、自信を持って鑑定できるようになりました。
知識はとても深く、難しい話も分かりやすく教えてくださいます。
講座生の意見を否定せず、疑問には最後まで向き合ってくださいます。
また、講座が終わって終了ではなく、フォローも充実しているので安心です。</div>
            </article>

            <article id="voice-balance-built-confidence" class="voice-card">
              <h4>五行バランスを学び、自信を持って鑑定できるようになりました</h4>
              <div class="voice-meta">50代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">私はいろいろな四柱推命の講座を学んできました。
それでも、鑑定をするってことに自信が持てずにいたところでてつ先生を知り、五行バランスを学んでいくうちに自信がつき鑑定ができるようになりました。
てつ先生の講座はいつでも質問にわかやすく丁寧に答えてくださるのでわからないままにならずに安心して学べる講座だとおもいます。</div>
            </article>

            <article id="voice-podcast-moved-me-forward" class="voice-card">
              <h4>行き詰まりを越えて、鑑定力が着実に身についています</h4>
              <div class="voice-meta">40代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">てつ先生との出会いは、ポッドキャストの「四柱推命な日常がきこえるラジオ」の配信でした。その頃の私は、四柱推命の鑑定ができるようになりたいと思いながらも、学びに行き詰まっていました。
てつ先生が四柱推命の難しい内容をカッコよく、ズバッと解説していらっしゃるのを聞いて、「なんか前に進めそう！この人だ！」と感じ、思い切って講座を受講したいとご連絡させていただきました。
てつ先生の講座は、講座そのものだけでなく、ポッドキャスト、受講生が自由に参加できる勉強会など、学びをフォローアップしていただける仕掛けがこれでもかというほどたくさんあります。こんな講座は、恐らく世界中を探しても他にはないと思います。
仕事で四柱推命の勉強にまとまった時間がなかなか取れませんが、着実に知識と鑑定力が身についていること実感しています。</div>
            </article>

            <article id="voice-authentic-reading" class="voice-card">
              <h4>本質的な鑑定ができるようになりました</h4>
              <div class="voice-meta">40代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">他の講座では難しくて挫折しかけていたのですが、てつ先生のLIVEを見て、「なんて分かりやすいの。私の目指す鑑定はこれだ」と確信して即申し込みました。
てつ先生の教えのおかげで、今では心から楽しく、本質的な鑑定ができるようになりました。</div>
            </article>
          </div>
        </div>
      </section>

      <section class="voice-section voice-alt">
        <div class="voice-container">
          <div class="voice-section-title"><span>わかりやすさ、教え方への声</span></div>
          <div class="voice-cards">
            <article id="voice-best-teacher" class="voice-card">
              <h4>ここまで分かりやすく教えてくれる先生は初めてでした</h4>
              <div class="voice-meta">30代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">四柱推命経験者で受講させていただきました。
まず、四柱推命をこんなに分かりやすく教えてくれる先生は、てつ先生だけでした。
これまで単発講座も合わせてさまざまな講座を受講してきましたが、こんなに分かりやすく、親身になってくれる先生はいませんでした。
分からないを分かるまでとことん教えてくださり、講座外のフォローも手厚すぎて感謝の気持ちでいっぱいです。
四柱推命は中国から流れてきているので、講座外で気になった歴史のことなども詳しく教えてくださり、何を聞いても答えてくれるドラえもんのような先生でした。
今後は、てつ先生が自然派四柱推命を広げていきたいという夢の力になれたらと思っております。
ほんとうにありがとうございました。</div>
            </article>

            <article id="voice-relearning-helped" class="voice-card">
              <h4>学び直しで理解がぐっと深まりました</h4>
              <div class="voice-meta">30代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">一度四柱推命を学んだものの、なんとなくわかっていないところがありました。
学び直しとしててつ先生の講座を受けましたが、さすが塾の先生！具体例も多いし、専門用語もわかりやすく教えてくださるので、とても理解が進みました！
添削も丁寧にしてくださるのでありがたいです。</div>
            </article>

            <article id="voice-gentle-and-clear" class="voice-card">
              <h4>難しい四柱推命を、丁寧にわかりやすく教えてもらえます</h4>
              <div class="voice-meta">40代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">てつ先生の講座は、丁寧に難しい四柱推命をわかりやすく教えて頂けます。
塾講師をされていただけあって、教え方や覚え方の工夫はとてもされていると思います。
わからない所や質問も細かく丁寧に説明して頂けるので、独学でしていた頃に比べると本当に有り難く、安心です。
講座もあっという間に時間が過ぎますし、持ってる知識を惜しみなく教えて下さるので、次の講座が待ち遠しいです。</div>
            </article>

            <article id="voice-kind-recommendation" class="voice-card">
              <h4>優しく丁寧に学びたい人にはおすすめです</h4>
              <div class="voice-meta">40代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">インスタでてつ先生を見つけて、とても優しそうな印象と安心感、説明がわかりやすかったので受講を決めました。
授業は自分の命式を使って説明をしてくれるので、難しい話も頭に入りやすく、自分の深掘りもできます。
優しく丁寧に学びたい人にはおすすめです。</div>
            </article>
          </div>
        </div>
      </section>

      <section class="voice-section">
        <div class="voice-container">
          <div class="voice-section-title"><span>「景色で読み解く」自然派四柱推命への声</span></div>
          <div class="voice-cards voice-cards-compact">
            <article id="voice-natural-scenery-entry" class="voice-card">
              <h4>公開鑑定で出会った「自然の景色」が、学びたい気持ちの入口になりました</h4>
              <div class="voice-meta">30代女性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">てつ先生の公開鑑定を受けた際に、自分の中にある「自然の景色」に初めて触れ、とても嬉しかったのを覚えています。
そこから、「学んでみたい」という気持ちが大きくなり、勇気を出して飛び込んでみました。
てつ先生は、深い知識はもちろんのこと、講座中の小さな疑問にもすぐ応えてくださいます。
なおかつ、理解しやすい言葉を選んで話してくださるので、イメージもつくし、スッと頭に入ってくるのです。
毎回、「難しい。でもすごく楽しい」と思いながら受講させて頂いています。</div>
            </article>

            <article id="voice-natural-landscape-style" class="voice-card">
              <h4>命式を自然の風景として理解できる鑑定に惹かれました</h4>
              <div class="voice-meta">40代男性</div>
              <div class="voice-quote"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg></div>
              <div class="voice-text">YouTubeの実践鑑定Liveを観て講座に応募しました。
命式を自然の風景として実際に画像に起こして、命式をより直感的に理解できる鑑定はとても分かりやすいです。
自分もこのスタイルで命式を見られるようになりたいと思い応募しました。
実際の講義もマンツーマンで、どんな疑問にも答えてくれるというスタンスで、毎回の講義が楽しみです。</div>
            </article>
          </div>
        </div>
      </section>

      <section class="voice-summary">
        <div class="voice-container">
          <h2>この講座が選ばれる理由</h2>
          <div class="voice-summary-list">
            <div class="voice-summary-item"><span class="voice-summary-number"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><p>難しい四柱推命を、わかりやすく本質から学べること。</p></div>
            <div class="voice-summary-item"><span class="voice-summary-number"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><p>「景色で読み解く」という自然派ならではの視点で、命式を立体的に理解できること。</p></div>
            <div class="voice-summary-item"><span class="voice-summary-number"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><p>過去の学びで自信を持てなかった方が、実践で使える鑑定力を身につけていけること。</p></div>
            <div class="voice-summary-item"><span class="voice-summary-number"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><p>そして、学んで終わりではなく、講座後のフォローまで含めて安心して学べること。</p></div>
          </div>
        </div>
      </section>

      <section class="voice-cta-section">
        <div class="voice-container">
          <h2>もっと詳しく知りたい方へ</h2>
          <div class="voice-cta">
            <p class="voice-cta-intro">無料講座説明会では、自然派四柱推命の学び方や、講座の進め方、<br>どんな方に向いているかを詳しくお伝えしています。</p>
            <div class="voice-cta-points">
              <div class="voice-cta-point"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg><span>「自分にも合う講座なのか知りたい」</span></div>
              <div class="voice-cta-point"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg><span>「他の講座との違いを聞いてみたい」</span></div>
              <div class="voice-cta-point"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg><span>「景色で読み解く四柱推命をもっと知りたい」</span></div>
            </div>
            <p class="voice-cta-note">そのような方は、まずは無料講座説明会にお越しください。</p>
            <a href="https://www.fuchilabo.com/products/kouzasetumei" class="cta-button">無料講座説明会はこちら<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg></a>
          </div>
          <div class="voice-footer-space"></div>
        </div>
      </section>
    </div>
  `;

  return renderPage({
    title: '',
    subtitle: '',
    content,
    backLink: '/',
    hideHeading: true,
  });
}

function renderAdminHome(message) {
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

  const notice = message ? `<p style="color:#16a34a; margin-bottom:1rem; font-weight:bold;">${message}</p>` : '';

  const content = `
    <div class="panel">
      ${notice}
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

      <hr style="margin: 2rem 0;" />

      <h3>配布用PDFのアップロード</h3>
      <p><code>/haifu-PDF</code> で配信されるPDFファイルを差し替えることができます。</p>
      <form method="POST" action="/admin/upload-haifu-pdf" enctype="multipart/form-data" class="reservation-form" style="display:flex; gap:1rem; align-items:center;">
        <div>
          <input type="file" name="pdf" accept="application/pdf" required />
        </div>
        <button class="button" type="submit" style="margin:0;">PDFをアップロード</button>
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
        <div class="compatibility-option-row" style="display:flex; align-items:flex-start; gap:0.5rem;">
          <input id="compatibilityOptionEnabled" type="checkbox" name="compatibilityOptionEnabled" value="1" />
          <div>
            <label for="compatibilityOptionEnabled" style="display:block; cursor:pointer;">
              <div style="font-size:0.95rem; margin-top:0.1rem;"><strong>相性鑑定</strong></div>
              <div style="font-size:0.9rem; margin-top:0.25rem;"><strong>${priceText}（税込）／＋30分／1名ごと</strong></div>
            </label>
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
        </div>
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

  const detailItems = product.details.map((item) => `<li>${formatLinkedText(item)}</li>`).join('');
  const rawBenefit =
    product.benefit && String(product.benefit).trim()
      ? String(product.benefit)
      : String(product.summary || '');
  const benefitHtml = formatLinkedText(rawBenefit);
  const benefitLinks = renderExternalLinks([
    ...extractUrls(rawBenefit),
    ...product.details.flatMap((item) => extractUrls(item)),
  ]);

  const content = `
    <div style="margin-bottom: 1rem;">
      <a href="javascript:history.back()" style="color:#0ea5e9; text-decoration:none;">
        ← 前のページに戻る
      </a>
    </div>
    <div class="product-layout">
      <figure class="product-figure">
        <img src="${product.image}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <div class="product-meta">
          <div class="badge">${product.typeLabel}</div>
          <div class="title"><strong>${escapeHtml(product.title)}</strong></div>
          <div class="price">${
            isFree ? '無料イベントです' : formatCurrency(product.currency, numericPrice)
          }</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
        </div>
        <p class="product-benefit">${benefitHtml}</p>
        ${benefitLinks}
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
    navVariant: product.personId === 'chigusa' ? 'chigusa' : 'default',
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

  if (isReadMethod && parsedUrl.pathname === '/voice') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderVoicePage());
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

  if (isReadMethod && parsedUrl.pathname === '/touyou') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderTouyouPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/yobikou') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderYobikouPage());
    return;
  }

  if (isReadMethod && parsedUrl.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const msg = parsedUrl.query && parsedUrl.query.msg;
    res.end(req.method === 'HEAD' ? undefined : renderAdminHome(msg));
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

  //配布用PDF配信
  if (isReadMethod && parsedUrl.pathname === '/haifu-PDF') {
    const pdfPath = path.join(storageRoot, 'haifu-PDF.pdf');
    if (fs.existsSync(pdfPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="haifu-PDF.pdf"'
      });
      fs.createReadStream(pdfPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('PDF not found');
    }
    return;
  }

  // AIセミナーLP（/ai-web-seminar）
  if (isReadMethod && parsedUrl.pathname === '/ai-web-seminar') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderAiWebSeminarPage());
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

  if (req.method === 'POST' && parsedUrl.pathname === '/admin/upload-haifu-pdf') {
    try {
      const { data } = await parseMultipartPdf(req);
      const targetPath = path.join(storageRoot, 'haifu-PDF.pdf');
      fs.writeFileSync(targetPath, data, 'binary');

      res.writeHead(302, { Location: '/admin?msg=' + encodeURIComponent('PDFをアップロードしました。すぐに反映されます。') });
      res.end();
    } catch (error) {
      console.error('Failed to upload PDF', error);
      res.writeHead(302, { Location: '/admin?msg=' + encodeURIComponent('PDFのアップロードに失敗しました。ファイル形式とサイズをご確認ください。') });
      res.end();
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

      if (isLikelySpamContact(body)) {
        console.warn('Blocked spam contact submission', {
          email: body.email || '',
          name: body.name || '',
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderContactComplete(body));
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
