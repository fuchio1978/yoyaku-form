const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, '..', '..', 'storage', 'reservations.json');

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
