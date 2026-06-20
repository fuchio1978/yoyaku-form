const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');

loadEnv();

// 永続ストレージのルート（Render の Persistent Disk など）
const storageRoot = process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const storePath = path.join(storageRoot, 'reservations.json');

function loadReservations() {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const raw = fs.readFileSync(storePath, 'utf-8');
  return JSON.parse(raw);
}

function saveReservation(reservation) {
  const data = loadReservations();
  data.push(reservation);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  return reservation;
}

module.exports = { loadReservations, saveReservation };
