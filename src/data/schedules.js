const fs = require('fs');
const path = require('path');

// 永続ストレージのルート（Render の Persistent Disk など）
const storageRoot = process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const schedulesPath = path.join(storageRoot, 'schedules.json');

function getSchedules() {
  if (!fs.existsSync(schedulesPath)) {
    return [];
  }
  const raw = fs.readFileSync(schedulesPath, 'utf-8');
  let all;
  try {
    all = JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed to parse schedules.json', e);
    return [];
  }

  // 今日より前の日付の枠は自動的に除外する
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  return (all || []).map((person) => {
    const schedule = Array.isArray(person.schedule) ? person.schedule : [];
    const filtered = schedule
      .filter((entry) => entry && typeof entry.date === 'string' && entry.date >= today)
      .map((entry) => ({
        date: entry.date,
        slots: Array.isArray(entry.slots) ? entry.slots.slice() : [],
      }));
    return {
      ...person,
      schedule: filtered,
    };
  });
}

function saveSchedules(all) {
  fs.mkdirSync(path.dirname(schedulesPath), { recursive: true });
  fs.writeFileSync(schedulesPath, JSON.stringify(all, null, 2));
}

function getScheduleForPerson(personId) {
  const all = getSchedules();
  const person = all.find((p) => p.personId === personId);
  return person ? person.schedule || [] : [];
}

function getPersonName(personId) {
  const all = getSchedules();
  const person = all.find((p) => p.personId === personId);
  return person ? person.name || '' : '';
}

function updateScheduleForPerson(personId, date, time) {
  const all = getSchedules();
  const idx = all.findIndex((p) => p.personId === personId);
  if (idx === -1) return;

  const person = all[idx];
  const schedule = Array.isArray(person.schedule) ? person.schedule : [];

  person.schedule = schedule
    .map((entry) => {
      if (entry.date !== date) return entry;
      const remaining = (entry.slots || []).filter((slot) => slot !== time);
      return { date: entry.date, slots: remaining };
    })
    .filter((entry) => entry.slots && entry.slots.length > 0);

  all[idx] = person;
  saveSchedules(all);
}

module.exports = {
  getSchedules,
  saveSchedules,
  getScheduleForPerson,
  getPersonName,
  updateScheduleForPerson,
};
