const fs = require('fs');
const path = require('path');

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

  fs.writeFileSync(adminFilePath, adminContent, 'utf-8');

  return {
    transport: 'file',
    adminRecipient,
    adminFilePath,
  };
}

module.exports = { sendReservationEmail, recipient: adminRecipient };
