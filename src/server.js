const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const querystring = require('querystring');
const { products, getProduct } = require('./data/products');
const { renderPage, formatCurrency } = require('./utils/render');
const { saveReservation } = require('./utils/reservations');
const { sendReservationEmail, recipient } = require('./utils/email');

const publicDir = path.join(__dirname, '..', 'public');

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

function renderHomePage() {
  const cards = products
    .map(
      (product) => `
      <a class="product-card" href="/products/${product.id}">
        <img src="${product.image}" alt="${product.title}" />
        <div class="card-body">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${formatCurrency(product.currency, product.price)}</div>
          <div class="title">${product.title}</div>
          <p class="subtitle">${product.summary}</p>
        </div>
      </a>
    `
    )
    .join('');

  const content = `
    <div class="stepper">
      <div class="step">① 商品を選ぶ</div>
      <div class="step">② 日時・プランを確認</div>
      <div class="step">③ 予約情報を入力</div>
      <div class="step">④ 予約確定メールが届く</div>
    </div>
    <div class="cards-grid">${cards}</div>
  `;

  return renderPage({ title: '商品ラインナップ', subtitle: '四柱推命の鑑定・講座の予約サイト', content });
}

function renderScheduleTable(product) {
  const rows = product.schedule
    .map((entry) => {
      const timeBadges = entry.slots
        .map((time) => `<span class="time-chip">${time}</span>`)
        .join('');
      return `<tr><th scope="row">${entry.date}</th><td>${timeBadges}</td></tr>`;
    })
    .join('');

  return `
    <table class="schedule-table" aria-label="予約枠">
      <thead><tr><th>日付</th><th>選べる時間</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderReservationForm(product) {
  const dateOptions = product.schedule
    .map((entry) => `<option value="${entry.date}">${entry.date}</option>`)
    .join('');
  const timeOptions = product.schedule
    .flatMap((entry) => entry.slots)
    .map((slot) => `<option value="${slot}">${slot}</option>`)
    .join('');

  return `
    <form class="reservation-form" method="POST" action="/reserve">
      <input type="hidden" name="productId" value="${product.id}" />
      <div class="field">
        <label for="date">ご希望日</label>
        <select id="date" name="date" required>
          <option value="">日付を選択</option>
          ${dateOptions}
        </select>
      </div>
      <div class="field">
        <label for="timeSlot">時間</label>
        <select id="timeSlot" name="timeSlot" required>
          <option value="">時間を選択</option>
          ${timeOptions}
        </select>
        <small>※ 日付と同じ枠の時間をお選びください。</small>
      </div>
      <div class="field">
        <label for="name">お名前</label>
        <input id="name" name="name" type="text" placeholder="例）山田 花子" required />
      </div>
      <div class="field">
        <label for="email">メールアドレス</label>
        <input id="email" name="email" type="email" placeholder="sample@example.com" required />
      </div>
      <div class="field">
        <label for="phone">電話番号</label>
        <input id="phone" name="phone" type="tel" placeholder="090-1234-5678" />
      </div>
      <div class="field">
        <label for="birthday">生年月日</label>
        <input id="birthday" name="birthday" type="date" />
      </div>
      <div class="field">
        <label for="address">ご住所</label>
        <input id="address" name="address" type="text" placeholder="都道府県・市区町村まで" />
      </div>
      <div class="field">
        <label for="notes">ご要望・メモ</label>
        <textarea id="notes" name="notes" placeholder="質問や希望をお書きください"></textarea>
      </div>
      <button class="button" type="submit">予約を確定する</button>
    </form>
  `;
}

function renderProductPage(product) {
  const scheduleTable = renderScheduleTable(product);
  const reservationForm = renderReservationForm(product);

  const detailItems = product.details.map((item) => `<li>${item}</li>`).join('');

  const content = `
    <div class="product-layout">
      <figure class="product-figure">
        <img src="${product.image}" alt="${product.title}" />
        <div class="product-meta">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${formatCurrency(product.currency, product.price)}</div>
        </div>
        <p>${product.summary}</p>
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
  `;

  return renderPage({
    title: product.title,
    subtitle: product.typeLabel,
    content,
    backLink: '/',
  });
}

function renderNotFound() {
  const content = '<p>お探しの商品は見つかりませんでした。</p>';
  return renderPage({ title: '404', content, backLink: '/' });
}

function renderConfirmation(reservation) {
  const summaryRows = [
    ['商品', reservation.productTitle],
    ['日時', `${reservation.date} ${reservation.timeSlot}`],
    ['お名前', reservation.name],
    ['メール', reservation.email],
    ['電話', reservation.phone || '未入力'],
    ['生年月日', reservation.birthday || '未入力'],
    ['住所', reservation.address || '未入力'],
  ]
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
      <h3>予約を受け付けました</h3>
      <p>確認メールを ${recipient} 宛てに送信しました。内容は以下の通りです。</p>
      <table class="schedule-table"><tbody>${summaryRows}</tbody></table>
      <div>
        <strong>ご要望・メモ</strong>
        <p>${reservation.notes || '（未入力）'}</p>
      </div>
      <a class="button secondary" href="/">トップへ戻る</a>
    </div>
  `;

  return renderPage({ title: '予約完了', subtitle: 'Thank you!', content, backLink: '/' });
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
  const required = ['productId', 'date', 'timeSlot', 'name', 'email'];
  const missing = required.filter((key) => !body[key]);
  const product = getProduct(body.productId);

  if (missing.length > 0 || !product) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage({ title: 'エラー', content: '<p>入力内容を確認してください。</p>', backLink: '/' }));
    return;
  }

  const reservation = {
    productId: product.id,
    productTitle: product.title,
    date: body.date,
    timeSlot: body.timeSlot,
    name: body.name,
    email: body.email,
    phone: body.phone || '',
    birthday: body.birthday || '',
    address: body.address || '',
    notes: body.notes || '',
    createdAt: new Date().toISOString(),
  };

  saveReservation(reservation);
  sendReservationEmail(reservation);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderConfirmation(reservation));
}

const server = http.createServer(async (req, res) => {
  const isReadMethod = req.method === 'GET' || req.method === 'HEAD';

  if (serveStaticFile(req, res)) {
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (isReadMethod && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : renderHomePage());
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

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : renderNotFound());
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Reservation site ready on http://localhost:${port}`);
});
