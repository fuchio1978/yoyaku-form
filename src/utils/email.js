const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

  // 環境変数が設定されていれば Gmail 経由でメール送信を試みる
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;

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

      const subject = `【予約控え】${reservation.productTitle || ''} / ${reservation.name || ''}`.trim();

      transporter
        .sendMail({
          from: gmailUser,
          to: adminRecipient,
          subject: subject || '【予約控え】新しい予約を受け付けました',
          text: adminContent,
        })
        .then(() => {
          // 成功時はログだけ出す（アプリの挙動には影響させない）
          console.log('Reservation email sent to admin via Gmail');
        })
        .catch((err) => {
          console.error('Failed to send reservation email via Gmail', err);
        });
    } catch (e) {
      console.error('Failed to configure Gmail transporter', e);
    }
  }

  return {
    transport: gmailUser && gmailPass ? 'gmail+file' : 'file',
    adminRecipient,
    adminFilePath,
  };
}

module.exports = { sendReservationEmail, recipient: adminRecipient };
