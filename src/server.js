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
const contactsStorePath = path.join(__dirname, '..', 'storage', 'contacts.json');
const outboxDir = path.join(__dirname, '..', 'storage', 'outbox');
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

function parseScheduleText(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      const date = idx === -1 ? line : line.slice(0, idx);
      const times = idx === -1 ? '' : line.slice(idx + 1);
      const slots = (times || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
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
  const cards = products
    .map(
      (product) => `
      <a class="product-card" href="/products/${product.id}">
        <img src="${product.image}" alt="${product.title}" />
        <div class="card-body">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${formatCurrency(product.currency, product.price)}</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
          <div class="title">${product.title}</div>
          <p class="subtitle">${product.summary}</p>
        </div>
      </a>
    `
    )
    .join('');

  const content = `
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
            <label for="orderNumber">オーダー番号（任意）</label>
            <input id="orderNumber" name="orderNumber" type="text" value="${orderNumber}" />
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
    ['オーダー番号', safe(body.orderNumber) || '未入力'],
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
  const rows = [
    ['商品', reservation.productTitle],
    ['日時', `${reservation.date} ${reservation.timeSlot}`],
    ['お名前', reservation.name],
    ['メール', reservation.email],
    ['生年月日', reservation.birthday || '未入力'],
    ['生まれ時間', reservation.birthTime || '未入力'],
    ['出身地', reservation.birthPlace || '未入力'],
    ['お支払方法',
      reservation.paymentMethod === 'bank'
        ? '銀行振込（振込手数料はお客様のご負担となります）'
        : reservation.paymentMethod === 'paypal'
        ? 'PAYPAL'
        : '未入力',
    ],
  ]
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
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
        <input type="hidden" name="name" value="${reservation.name}" />
        <input type="hidden" name="email" value="${reservation.email}" />
        <input type="hidden" name="birthday" value="${reservation.birthday || ''}" />
        <input type="hidden" name="birthTime" value="${reservation.birthTime || ''}" />
        <input type="hidden" name="birthPlace" value="${reservation.birthPlace || ''}" />
        <input type="hidden" name="paymentMethod" value="${reservation.paymentMethod || ''}" />
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
      <p>1行につき1日分の予約枠を入力してください。例）<code>2025-12-19:10:00,13:30</code></p>
      <form method="POST" action="/admin/schedules" class="reservation-form">
        <div class="field">
          <label for="tetsuyaSchedule">てつ先生 の予約枠</label>
          <textarea id="tetsuyaSchedule" name="tetsuyaSchedule" rows="6" placeholder="2025-12-19:10:00,13:30">${tetsuyaText}</textarea>
        </div>
        <div class="field">
          <label for="chigusaSchedule">ちぐさ の予約枠</label>
          <textarea id="chigusaSchedule" name="chigusaSchedule" rows="6" placeholder="2025-12-19:09:00,11:00">${chigusaText}</textarea>
        </div>
        <button class="button" type="submit">保存する</button>
        <a class="button secondary" href="/admin" style="margin-left:0.5rem;">商品一覧へ戻る</a>
      </form>
    </div>
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
〒470-0155
愛知県愛知郡東郷町白鳥4-2-3　402-501

電話番号
0561-39-4181
（平日 10:00〜18:00）
※営業・勧誘のお電話はご遠慮ください。
※お問い合わせは原則としてお問い合わせフォームまたはメールにてお願いいたします。

連絡先メールアドレス
fuchi.labo.2025@gmail.com

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
      <a class="button secondary" href="/admin/product">新規商品を追加</a>
      <a class="button" href="/admin/schedules" style="margin-left:0.5rem;">予約枠を編集</a>
      <table class="schedule-table" style="margin-top:1rem;">
        <thead>
          <tr><th>ID</th><th>タイトル</th><th>価格</th><th>表示順</th><th>操作</th></tr>
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
          <label for="title">商品名</label>
          <input id="title" name="title" type="text" required value="${safe(product && product.title)}" />
        </div>
        <div class="field">
          <label for="price">価格</label>
          <input id="price" name="price" type="number" min="0" step="1" required value="${safe(product && product.price)}" />
        </div>
        <div class="field">
          <label for="currency">通貨記号</label>
          <input id="currency" name="currency" type="text" value="${safe((product && product.currency) || '¥')}" />
        </div>
        <div class="field">
          <label for="image">画像パス</label>
          <input id="image" name="image" type="text" placeholder="/images/xxx.svg" value="${safe(product && product.image)}" />
        </div>
        <div class="field">
          <label for="summary">概要（カードに表示）</label>
          <textarea id="summary" name="summary">${safe(product && product.summary)}</textarea>
        </div>
        <div class="field">
          <label for="details">詳細（1行1項目）</label>
          <textarea id="details" name="details">${product ? product.details.join('\n') : ''}</textarea>
        </div>
        <div class="field">
          <label for="duration">時間</label>
          <input id="duration" name="duration" type="text" value="${safe(product && product.duration)}" />
        </div>
        <div class="field">
          <label for="typeLabel">種別ラベル</label>
          <input id="typeLabel" name="typeLabel" type="text" value="${safe(product && product.typeLabel)}" />
        </div>
        <div class="field">
          <label for="displayOrder">表示順（小さい数字ほど上に表示されます）</label>
          <input id="displayOrder" name="displayOrder" type="number" step="1" min="0" value="${safe(
            (product && product.displayOrder) || ''
          )}" />
        </div>
        <div class="field">
          <label for="personId">担当者</label>
          <select id="personId" name="personId">
            <option value="">未選択</option>
            <option value="tetsuya" ${product && product.personId === 'tetsuya' ? 'selected' : ''}>てつ先生</option>
            <option value="chigusa" ${product && product.personId === 'chigusa' ? 'selected' : ''}>ちぐさ</option>
          </select>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" name="requiresSchedule" ${requiresSchedule ? 'checked' : ''} />
            予約日時の指定が必要な商品にする
          </label>
          <small>セミナーや対面鑑定など日時予約が必要な場合はチェックを入れます。動画販売など日時不要の商品はチェックを外してください。</small>
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

function renderScheduleTable(product) {
  if (!product.requiresSchedule && product.requiresSchedule !== undefined) {
    return '';
  }
  const effectivePersonId = product.personId || 'tetsuya';
  const schedule = effectivePersonId ? getScheduleForPerson(effectivePersonId) : [];
  const rows = schedule
    .map((entry) => {
      const timeBadges = entry.slots
        .map(
          (time) =>
            `<span class="time-chip" data-date="${entry.date}" data-time="${time}" onclick="window.__selectTimeSlot && window.__selectTimeSlot('${entry.date}','${time}', this);">${time}</span>`
        )
        .join('');
      return `<tr><th scope="row">${entry.date}</th><td>${timeBadges}</td></tr>`;
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

  let dateTimeFields = '';

  if (requiresSchedule) {
    const effectivePersonId = product.personId || 'tetsuya';
    const schedule = effectivePersonId ? getScheduleForPerson(effectivePersonId) : [];
    const dateOptions = schedule
      .map((entry) => `<option value="${entry.date}">${entry.date}</option>`)
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

  return `
    <form class="reservation-form" method="POST" action="/reserve/confirm">
      <input type="hidden" name="productId" value="${product.id}" />
      <input type="hidden" name="personId" value="${product.personId || 'tetsuya'}" />
      ${dateTimeFields}
      <div class="field">
        <label for="name">お名前</label>
        <input id="name" name="name" type="text" placeholder="例）山田 花子" required />
      </div>
      <div class="field">
        <label for="email">メールアドレス</label>
        <input id="email" name="email" type="email" placeholder="sample@example.com" required />
      </div>
      <div class="field">
        <label for="emailConfirm">メールアドレス（確認用）</label>
        <input id="emailConfirm" name="emailConfirm" type="email" placeholder="確認のためもう一度入力してください" required />
      </div>
      <div class="field">
        <label for="birthday">生年月日</label>
        <input id="birthday" name="birthday" type="date" value="1980-01-01" />
      </div>
      <div class="field">
        <label for="birthTime">生まれ時間</label>
        <input id="birthTime" name="birthTime" type="text" placeholder="例）14:52" />
      </div>
      <div class="field">
        <label for="birthPlace">出身地</label>
        <input id="birthPlace" name="birthPlace" type="text" placeholder="例）愛知県" />
      </div>
      <div class="field">
        <label for="paymentMethod">お支払方法</label>
        <select id="paymentMethod" name="paymentMethod">
          <option value="">選択してください</option>
          <option value="bank">銀行振込（振込手数料はお客様のご負担となります）</option>
          <option value="paypal">PAYPAL</option>
        </select>
        <small id="paymentMethodNote" style="display: none; font-size: 0.85rem; color: #6b7280;">
          ※銀行振込をお選びの場合、振込手数料はお客さまのご負担となります。
        </small>
      </div>
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

  const detailItems = product.details.map((item) => `<li>${item}</li>`).join('');

  const content = `
    <div class="product-layout">
      <figure class="product-figure">
        <img src="${product.image}" alt="${product.title}" />
        <div class="product-meta">
          <div class="badge">${product.typeLabel}</div>
          <div class="price">${formatCurrency(product.currency, product.price)}</div>
          ${product.providerLabel ? `<div class="provider">${product.providerLabel}</div>` : ''}
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
        var emailInput = document.getElementById('email');
        var emailConfirmInput = document.getElementById('emailConfirm');
        var paymentSelect = document.getElementById('paymentMethod');
        var paymentNote = document.getElementById('paymentMethodNote');

        if (form && emailInput && emailConfirmInput) {
          form.addEventListener('submit', function(e) {
            if (emailInput.value !== emailConfirmInput.value) {
              e.preventDefault();
              alert('メールアドレスと確認用メールアドレスが一致しません。入力内容をご確認ください。');
              emailConfirmInput.focus();
            }
          });
        }

        if (paymentSelect && paymentNote) {
          function updatePaymentNote() {
            if (paymentSelect.value === 'bank') {
              paymentNote.style.display = 'block';
            } else {
              paymentNote.style.display = 'none';
            }
          }

          paymentSelect.addEventListener('change', updatePaymentNote);
          updatePaymentNote();
        }
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
  const summaryRows = [
    ['商品', reservation.productTitle],
    ['日時', `${reservation.date} ${reservation.timeSlot}`],
    ['お名前', reservation.name],
    ['メール', reservation.email],
    ['生年月日', reservation.birthday || '未入力'],
    ['生まれ時間', reservation.birthTime || '未入力'],
    ['出身地', reservation.birthPlace || '未入力'],
    ['お支払方法',
      reservation.paymentMethod === 'bank'
        ? '銀行振込（振込手数料はお客様のご負担となります）'
        : reservation.paymentMethod === 'paypal'
        ? 'PAYPAL'
        : '未入力',
    ],
  ]
    .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
    .join('');

  const content = `
    <div class="panel">
      <h3>予約を受け付けました</h3>
      <p style="white-space: pre-line; margin-bottom: 1rem;">
ご予約ありがとうございます。
内容を確認のうえ、24時間以内にご入金先などの詳細をメールにてご案内いたします。
※メールが届かない場合は、迷惑メールフォルダもご確認ください。
      </p>
      <p style="white-space: pre-line;">
ご連絡先として fuchi.labo.2025@gmail.com を登録しております。
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

  const required = ['productId', 'name', 'email'];
  if (product && product.requiresSchedule && !personId) {
    required.push('personId');
  }
  if (requiresSchedule) {
    required.push('date', 'timeSlot');
  }
  const missing = required.filter((key) => !body[key]);

  if (missing.length > 0 || !product) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage({ title: 'エラー', content: '<p>入力内容を確認してください。</p>', backLink: '/' }));
    return;
  }

  const reservation = {
    productId: product.id,
    productTitle: product.title,
    personId,
    personName: personId ? getPersonName(personId) : '',
    date: requiresSchedule ? body.date : '',
    timeSlot: requiresSchedule ? body.timeSlot : '',
    name: body.name,
    email: body.email,
    birthday: body.birthday || '',
    birthTime: body.birthTime || '',
    birthPlace: body.birthPlace || '',
    paymentMethod: body.paymentMethod || '',
    notes: body.notes || '',
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

      const required = ['productId', 'name', 'email'];
      if (product && product.requiresSchedule && !personId) {
        required.push('personId');
      }
      if (requiresSchedule) {
        required.push('date', 'timeSlot');
      }
      const missing = required.filter((key) => !body[key]);

      if (missing.length > 0 || !product) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPage({ title: 'エラー', content: '<p>入力内容を確認してください。</p>', backLink: '/' }));
        return;
      }

      const reservation = {
        productId: product.id,
        productTitle: product.title,
        personId,
        personName: personId ? getPersonName(personId) : '',
        date: requiresSchedule ? body.date : '',
        timeSlot: requiresSchedule ? body.timeSlot : '',
        name: body.name,
        email: body.email,
        birthday: body.birthday || '',
        birthTime: body.birthTime || '',
        birthPlace: body.birthPlace || '',
        paymentMethod: body.paymentMethod || '',
        notes: body.notes || '',
      };

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderReservationConfirmPage(reservation));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage({ title: 'エラー', content: '<p>サーバーで問題が発生しました。</p>', backLink: '/' }));
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
        orderNumber: body.orderNumber || '',
        message: body.message || '',
        createdAt: new Date().toISOString(),
      };

      saveContactMessage(contact);
      saveContactOutbox(contact);

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
      const displayOrder = body.displayOrder !== undefined && body.displayOrder !== ''
        ? Number(body.displayOrder)
        : undefined;
      const personId = body.personId || '';
      const providerLabel = personId === 'tetsuya'
        ? '担当：てつ先生'
        : personId === 'chigusa'
        ? '担当：ちぐさ'
        : '';

      const product = {
        id: body.id,
        title: body.title,
        price: Number(body.price || 0),
        currency: body.currency || '¥',
        image: body.image || '',
        summary: body.summary || '',
        details,
        duration: body.duration || '',
        typeLabel: body.typeLabel || '',
         displayOrder,
        requiresSchedule: !!body.requiresSchedule,
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
