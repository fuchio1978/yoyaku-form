const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const { loadEnv } = require('./env');

loadEnv();

const adminRecipient = process.env.RESERVATION_RECIPIENT || 'info@fuchilabo.com';

function buildAdminMessage(reservation) {
  const amount =
    typeof reservation.displayPrice === 'number' && reservation.displayPrice > 0
      ? reservation.displayPrice
      : typeof reservation.price === 'number'
      ? reservation.price
      : 0;
  const amountText =
    amount > 0 && reservation.currency
      ? `${reservation.currency}${amount.toLocaleString('ja-JP')}`
      : amount > 0
      ? `${amount.toLocaleString('ja-JP')}円`
      : '';

  return [
    '【管理者控え】予約を受け付けました。',
    '',
    `■ 予約商品: ${reservation.productTitle}`,
    `■ 日時: ${reservation.date || '（未指定）'} ${reservation.timeSlot || ''}`.trim(),
    `■ お名前: ${reservation.name}`,
    `■ メール: ${reservation.email}`,
    reservation.birthday ? `■ 生年月日: ${reservation.birthday}` : '',
    reservation.genderAtBirth ? `■ 性別（出生時）: ${reservation.genderAtBirth}` : '',
    reservation.birthTime ? `■ 生まれ時間: ${reservation.birthTime}` : '',
    reservation.birthPlace ? `■ 出身地: ${reservation.birthPlace}` : '',
    reservation.sessionType ? `■ 対面／オンライン: ${reservation.sessionType}` : '',
    reservation.paymentMethod
      ? `■ お支払方法: ${
          reservation.paymentMethod === 'bank'
            ? '銀行振込（振込手数料はお客様のご負担となります）'
            : reservation.paymentMethod === 'paypal'
            ? 'PAYPAL'
            : reservation.paymentMethod
        }`
      : '',
    amountText ? `■ 金額: ${amountText}` : '',
    '',
    '▼ ご要望・メモ',
    reservation.notes || '（未入力）',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCustomerMessage(reservation) {
  const amount =
    typeof reservation.displayPrice === 'number' && reservation.displayPrice > 0
      ? reservation.displayPrice
      : typeof reservation.price === 'number'
      ? reservation.price
      : 0;
  const amountText =
    amount > 0 && reservation.currency
      ? `${reservation.currency}${amount.toLocaleString('ja-JP')}`
      : amount > 0
      ? `${amount.toLocaleString('ja-JP')}円`
      : '';

  return [
    `${reservation.name || 'お申込者'} 様`,
    '',
    'このたびはお申し込みいただき、ありがとうございます。',
    '以下の内容でお申し込みを受け付けました。',
    '',
    `■ 講座名: ${reservation.productTitle || ''}`,
    reservation.date || reservation.timeSlot
      ? `■ 日時: ${reservation.date || ''} ${reservation.timeSlot || ''}`.trim()
      : '',
    `■ お名前: ${reservation.name || ''}`,
    `■ メールアドレス: ${reservation.email || ''}`,
    reservation.paymentMethod
      ? `■ お支払方法: ${
          reservation.paymentMethod === 'bank'
            ? '銀行振込（振込手数料はお客様のご負担となります）'
            : reservation.paymentMethod === 'paypal'
            ? 'PAYPAL'
            : reservation.paymentMethod
        }`
      : '',
    amountText ? `■ 金額: ${amountText}` : '',
    reservation.notes ? `■ ご要望・メモ: ${reservation.notes}` : '',
    '',
    reservation.paymentMethod === 'bank'
      ? 'お振込先などの詳細は、内容を確認のうえ改めてご案内いたします。'
      : '内容を確認のうえ、必要なご案内を改めてお送りします。',
    '',
    'このメールに心当たりがない場合は、info@fuchilabo.com までご連絡ください。',
    '',
    'ふちLABO.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendReservationEmail(reservation) {
  const storageRoot =
    process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
  const outbox = path.join(storageRoot, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });

  const adminContent = buildAdminMessage(reservation);
  const customerContent = buildCustomerMessage(reservation);
  const timestamp = Date.now();
  const adminFilePath = path.join(outbox, `reservation-admin-${timestamp}.txt`);
  const customerFilePath = path.join(outbox, `reservation-customer-${timestamp}.txt`);

  // 配信障害時にも内容を確認できるよう、管理者・申込者向けの本文をファイルへ保存する
  try {
    fs.writeFileSync(adminFilePath, adminContent, 'utf-8');
    fs.writeFileSync(customerFilePath, customerContent, 'utf-8');
  } catch (e) {
    console.error('Failed to write reservation email to outbox', e);
  }

  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const fromAddress = process.env.SENDGRID_FROM || adminRecipient;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;
  const adminSubject = `【予約控え】${reservation.productTitle || ''} / ${reservation.name || ''}`.trim();
  const customerSubject = `【お申し込み受付】${reservation.productTitle || ''}`.trim();

  if (sendgridApiKey) {
    try {
      sgMail.setApiKey(sendgridApiKey);
      await Promise.all([
        sgMail.send({
          to: adminRecipient,
          from: fromAddress,
          replyTo: reservation.email || undefined,
          subject: adminSubject || '【予約控え】新しい予約を受け付けました',
          text: adminContent,
        }),
        sgMail.send({
          to: reservation.email,
          from: fromAddress,
          replyTo: adminRecipient,
          subject: customerSubject || '【お申し込み受付】ふちLABO.',
          text: customerContent,
        }),
      ]);
      console.log('Reservation emails sent to admin and customer via SendGrid');
      return {
        transport: 'sendgrid+file',
        adminRecipient,
        customerRecipient: reservation.email,
        adminFilePath,
        customerFilePath,
        adminSent: true,
        customerSent: true,
      };
    } catch (e) {
      console.error('Failed to send reservation emails via SendGrid', e);
      return {
        transport: 'sendgrid+file',
        adminRecipient,
        customerRecipient: reservation.email,
        adminFilePath,
        customerFilePath,
        adminSent: false,
        customerSent: false,
        error: e && e.message ? e.message : String(e),
      };
    }
  }

  // 既存環境でGmailの認証情報が設定されている場合はSMTPをフォールバックとして利用する
  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });
      await Promise.all([
        transporter.sendMail({
          from: gmailUser,
          to: adminRecipient,
          replyTo: reservation.email || undefined,
          subject: adminSubject || '【予約控え】新しい予約を受け付けました',
          text: adminContent,
        }),
        transporter.sendMail({
          from: gmailUser,
          to: reservation.email,
          replyTo: adminRecipient,
          subject: customerSubject || '【お申し込み受付】ふちLABO.',
          text: customerContent,
        }),
      ]);
      console.log('Reservation emails sent to admin and customer via Gmail');
      return {
        transport: 'gmail+file',
        adminRecipient,
        customerRecipient: reservation.email,
        adminFilePath,
        customerFilePath,
        adminSent: true,
        customerSent: true,
      };
    } catch (e) {
      console.error('Failed to send reservation emails via Gmail', e);
      return {
        transport: 'gmail+file',
        adminRecipient,
        customerRecipient: reservation.email,
        adminFilePath,
        customerFilePath,
        adminSent: false,
        customerSent: false,
        error: e && e.message ? e.message : String(e),
      };
    }
  }

  console.error('Reservation email delivery is not configured');
  return {
    transport: 'file',
    adminRecipient,
    customerRecipient: reservation.email,
    adminFilePath,
    customerFilePath,
    adminSent: false,
    customerSent: false,
    error: 'Email delivery is not configured',
  };
}

module.exports = {
  buildAdminMessage,
  buildCustomerMessage,
  sendReservationEmail,
  recipient: adminRecipient,
};
