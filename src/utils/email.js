const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

const adminRecipient = process.env.RESERVATION_RECIPIENT || 'fuchi.labo.2025@gmail.com';

function buildAdminMessage(reservation) {
  return [
    '【管理者控え】予約を受け付けました。',
    '',
    `■ 予約商品: ${reservation.productTitle}`,
    `■ 日時: ${reservation.date || '（未指定）'} ${reservation.timeSlot || ''}`.trim(),
    `■ お名前: ${reservation.name}`,
    `■ メール: ${reservation.email}`,
    reservation.birthday ? `■ 生年月日: ${reservation.birthday}` : '',
    reservation.birthTime ? `■ 生まれ時間: ${reservation.birthTime}` : '',
    reservation.birthPlace ? `■ 出身地: ${reservation.birthPlace}` : '',
    reservation.paymentMethod
      ? `■ お支払方法: ${
          reservation.paymentMethod === 'bank'
            ? '銀行振込（振込手数料はお客様のご負担となります）'
            : reservation.paymentMethod === 'paypal'
            ? 'PAYPAL'
            : reservation.paymentMethod
        }`
      : '',
    '',
    '▼ ご要望・メモ',
    reservation.notes || '（未入力）',
  ]
    .filter(Boolean)
    .join('\n');
}

function sendReservationEmail(reservation) {
  const outbox = path.join(__dirname, '..', '..', 'storage', 'outbox');
  fs.mkdirSync(outbox, { recursive: true });

  const adminContent = buildAdminMessage(reservation);
  const timestamp = Date.now();
  const adminFilePath = path.join(outbox, `reservation-admin-${timestamp}.txt`);

  // まずは従来どおりファイルに書き出す
  try {
    fs.writeFileSync(adminFilePath, adminContent, 'utf-8');
  } catch (e) {
    console.error('Failed to write reservation email to outbox', e);
  }

  // SendGrid API キーが設定されていれば、SendGrid 経由でメール送信を試みる
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const fromAddress = process.env.SENDGRID_FROM || adminRecipient;

  if (sendgridApiKey) {
    try {
      sgMail.setApiKey(sendgridApiKey);

      const subject = `【予約控え】${reservation.productTitle || ''} / ${reservation.name || ''}`.trim();

      sgMail
        .send({
          to: adminRecipient,
          from: fromAddress,
          subject: subject || '【予約控え】新しい予約を受け付けました',
          text: adminContent,
        })
        .then(() => {
          console.log('Reservation email sent to admin via SendGrid');
        })
        .catch((err) => {
          console.error('Failed to send reservation email via SendGrid', err);
        });
    } catch (e) {
      console.error('Failed to configure SendGrid client', e);
    }
  }

  return {
    transport: sendgridApiKey ? 'sendgrid+file' : 'file',
    adminRecipient,
    adminFilePath,
  };
}

module.exports = { sendReservationEmail, recipient: adminRecipient };
