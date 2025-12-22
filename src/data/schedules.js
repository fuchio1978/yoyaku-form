const fs = require('fs');
const path = require('path');

const schedulesPath = path.join(__dirname, '..', '..', 'storage', 'schedules.json');

function getSchedules() {
  if (!fs.existsSync(schedulesPath)) {
    return [];
  }
  const raw = fs.readFileSync(schedulesPath, 'utf-8');
  try {
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed to parse schedules.json', e);
    return [];
  }
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
