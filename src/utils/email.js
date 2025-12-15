const fs = require('fs');
const path = require('path');

const recipient = process.env.RESERVATION_RECIPIENT || 'fuchi.labo.2025@gmail.com';

function buildMessage(reservation) {
  return [
    `件名: 【予約確定】${reservation.productTitle} / ${reservation.date} ${reservation.timeSlot}`,
    `宛先: ${recipient}`,
    '',
    '以下の内容で予約を受け付けました。',
    '',
    `■ 予約商品: ${reservation.productTitle}`,
    `■ 日時: ${reservation.date} ${reservation.timeSlot}`,
    `■ お名前: ${reservation.name}`,
    `■ メール: ${reservation.email}`,
    reservation.phone ? `■ 電話番号: ${reservation.phone}` : '',
    reservation.birthday ? `■ 生年月日: ${reservation.birthday}` : '',
    reservation.address ? `■ ご住所: ${reservation.address}` : '',
    '',
    '▼ ご要望・メモ',
    reservation.notes || '（未入力）',
    '',
    'このメールはシステムから自動生成されています。'
  ]
    .filter(Boolean)
    .join('\n');
}

function sendReservationEmail(reservation) {
  const outbox = path.join(__dirname, '..', '..', 'storage', 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const content = buildMessage(reservation);
  const filePath = path.join(outbox, `reservation-${Date.now()}.txt`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { recipient, filePath };
}

module.exports = { sendReservationEmail, recipient };
