(function () {
  var root = document.getElementById('scheduleApp');
  if (!root) return;

  var HOURS = [];
  // 8:00〜23:00 まで 1時間刻みで表示
  for (var h = 8; h <= 23; h++) {
    HOURS.push(h);
  }

  function formatHour(h) {
    return h + ':00';
  }

  function parseText(text) {
    var map = {};
    if (!text) return map;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split(':');
      var rawDate = (parts[0] || '').trim();
      // 日付は "2026-1-9" / "2026-01-09" など様々な表記を "YYYY-MM-DD" に正規化する
      var date = rawDate;
      var dm = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (dm) {
        var y = dm[1];
        var m = parseInt(dm[2], 10);
        var d = parseInt(dm[3], 10);
        if (!isNaN(m) && !isNaN(d)) {
          var mm = m < 10 ? '0' + m : String(m);
          var dd = d < 10 ? '0' + d : String(d);
          date = y + '-' + mm + '-' + dd;
        }
      }
      var slotsPart = parts.slice(1).join(':');
      if (!date) continue;
      var rawSlots = (slotsPart || '').split(',');
      if (!map[date]) map[date] = {};
      for (var j = 0; j < rawSlots.length; j++) {
        var slot = rawSlots[j].trim();
        if (!slot) continue;
        map[date][slot] = true;
      }
    }
    return map;
  }

  function mapToText(map) {
    var dates = Object.keys(map).sort();
    var lines = [];
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var slotsMap = map[date] || {};
      var slots = Object.keys(slotsMap).filter(function (s) {
        return !!slotsMap[s];
      });
      slots.sort();
      if (!slots.length) continue;
      lines.push(date + ':' + slots.join(','));
    }
    return lines.join('\n');
  }

  function createElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function buildCalendar(container, state, onDateClick) {
    container.innerHTML = '';

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var currentYear = today.getFullYear();
    var currentMonth = today.getMonth(); // 0-based
    var maxMonth = (currentMonth + 1) % 12;
    var maxYear = currentYear + (currentMonth + 1 >= 12 ? 1 : 0);

    var header = createElement('div', 'schedule-admin-cal-header');
    var prevBtn = createElement('button', 'schedule-admin-cal-nav', '<');
    prevBtn.type = 'button';
    var nextBtn = createElement('button', 'schedule-admin-cal-nav', '>');
    nextBtn.type = 'button';
    var title = createElement('div', 'schedule-admin-cal-title');
    header.appendChild(prevBtn);
    header.appendChild(title);
    header.appendChild(nextBtn);
    container.appendChild(header);

    var table = createElement('table', 'schedule-admin-cal-table');
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    for (var i = 0; i < weekdays.length; i++) {
      var th = document.createElement('th');
      th.textContent = weekdays[i];
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    container.appendChild(table);

    function updateCalendar() {
      var cmpMin = new Date(today.getFullYear(), today.getMonth(), 1);
      var cmpMax = new Date(maxYear, maxMonth, 1);
      var cur = new Date(state.year, state.month, 1);
      if (cur < cmpMin) {
        state.year = cmpMin.getFullYear();
        state.month = cmpMin.getMonth();
      }
      if (cur > cmpMax) {
        state.year = cmpMax.getFullYear();
        state.month = cmpMax.getMonth();
      }

      title.textContent = state.year + '年 ' + (state.month + 1) + '月';
      tbody.innerHTML = '';

      var firstDay = new Date(state.year, state.month, 1);
      var startWeekday = firstDay.getDay();
      var daysInMonth = new Date(state.year, state.month + 1, 0).getDate();

      var row = document.createElement('tr');
      for (var i = 0; i < startWeekday; i++) {
        row.appendChild(document.createElement('td'));
      }

      for (var day = 1; day <= daysInMonth; day++) {
        var date = new Date(state.year, state.month, day);
        var td = document.createElement('td');
        var btn = createElement('button', 'schedule-admin-cal-day', String(day));
        btn.type = 'button';
        // タイムゾーンによるズレを避けるため、Date.toISOString() は使わず手動で YYYY-MM-DD を組み立てる
        var m = state.month + 1;
        var iso = state.year + '-' + (m < 10 ? '0' + m : String(m)) + '-' + (day < 10 ? '0' + day : String(day));
        btn.setAttribute('data-date', iso);

        if (date < today) {
          btn.disabled = true;
          btn.classList.add('schedule-admin-cal-day-disabled');
        }

        if (state.selectedDate === iso) {
          btn.classList.add('schedule-admin-cal-day-selected');
        }

        btn.addEventListener('click', function (e) {
          var d = e.currentTarget.getAttribute('data-date');
          state.selectedDate = d;
          updateCalendar();
          if (onDateClick) onDateClick(d);
        });

        td.appendChild(btn);
        row.appendChild(td);

        if ((startWeekday + day) % 7 === 0 || day === daysInMonth) {
          tbody.appendChild(row);
          row = document.createElement('tr');
        }
      }

      prevBtn.disabled = state.year === currentYear && state.month === currentMonth;
      nextBtn.disabled = state.year === maxYear && state.month === maxMonth;
    }

    prevBtn.addEventListener('click', function () {
      if (state.month === 0) {
        state.month = 11;
        state.year -= 1;
      } else {
        state.month -= 1;
      }
      updateCalendar();
    });

    nextBtn.addEventListener('click', function () {
      if (state.month === 11) {
        state.month = 0;
        state.year += 1;
      } else {
        state.month += 1;
      }
      updateCalendar();
    });

    updateCalendar();
  }

  function buildTimeList(container, personState, onChange) {
    container.innerHTML = '';
    var info = createElement('div', 'schedule-admin-time-info', '日付を選択すると、この日の時間帯が編集できます。');
    container.appendChild(info);

    var list = createElement('div', 'schedule-admin-time-list');
    container.appendChild(list);

    function renderTimes() {
      list.innerHTML = '';
      if (!personState.selectedDate) {
        info.textContent = 'まずカレンダーから日付を選択してください。';
        return;
      }
      info.textContent = '編集中の日付: ' + personState.selectedDate;
      var dateMap = personState.map[personState.selectedDate] || {};
      for (var i = 0; i < HOURS.length; i++) {
        var h = HOURS[i];
        var label = formatHour(h);
        var item = createElement('label', 'schedule-admin-time-item');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!dateMap[label];
        (function (lbl) {
          cb.addEventListener('change', function (e) {
            if (!personState.map[personState.selectedDate]) {
              personState.map[personState.selectedDate] = {};
            }
            // 実際に変更されたチェックボックスの状態を使って反映する
            personState.map[personState.selectedDate][lbl] = !!e.target.checked;
            if (onChange) onChange();
          });
        })(label);
        var span = createElement('span', '', label);
        item.appendChild(cb);
        item.appendChild(span);
        list.appendChild(item);
      }
    }

    personState.renderTimes = renderTimes;
    renderTimes();
  }

  var tetsuyaTextarea = document.getElementById('tetsuyaSchedule');
  var chigusaTextarea = document.getElementById('chigusaSchedule');

  var now = new Date();
  var tetsuyaState = {
    map: parseText(tetsuyaTextarea ? tetsuyaTextarea.value : ''),
    year: now.getFullYear(),
    month: now.getMonth(),
    selectedDate: null,
    renderTimes: null,
    summaryContainer: null,
  };
  var chigusaState = {
    map: parseText(chigusaTextarea ? chigusaTextarea.value : ''),
    year: now.getFullYear(),
    month: now.getMonth(),
    selectedDate: null,
    renderTimes: null,
    summaryContainer: null,
  };

  function syncTextareas() {
    if (tetsuyaTextarea) {
      tetsuyaTextarea.value = mapToText(tetsuyaState.map);
    }
    if (chigusaTextarea) {
      chigusaTextarea.value = mapToText(chigusaState.map);
    }
    // サマリー表示も更新
    renderSummary(tetsuyaState);
    renderSummary(chigusaState);
  }

  var tabs = createElement('div', 'schedule-admin-tabs');
  var tTab = createElement('button', 'schedule-admin-tab active', 'てつ先生の予約枠');
  tTab.type = 'button';
  var cTab = createElement('button', 'schedule-admin-tab', 'ちぐさの予約枠');
  cTab.type = 'button';
  tabs.appendChild(tTab);
  tabs.appendChild(cTab);
  root.appendChild(tabs);

  var contentWrap = createElement('div', 'schedule-admin-content');
  root.appendChild(contentWrap);

  var tContainer = createElement('div', 'schedule-admin-person schedule-admin-person-active');
  var cContainer = createElement('div', 'schedule-admin-person');
  contentWrap.appendChild(tContainer);
  contentWrap.appendChild(cContainer);

  function renderSummary(state) {
    if (!state.summaryContainer) return;
    var container = state.summaryContainer;
    container.innerHTML = '';
    var dates = Object.keys(state.map).sort();
    if (!dates.length) {
      container.textContent = '現在登録されている予約枠はありません。';
      return;
    }
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var slotsMap = state.map[date] || {};
      var slots = Object.keys(slotsMap).filter(function (k) { return !!slotsMap[k]; });
      if (!slots.length) continue;
      slots.sort();
      var row = createElement('div', 'schedule-admin-summary-row');
      row.textContent = date + ' : ' + slots.join(', ');
      container.appendChild(row);
    }
  }

  function createPersonUI(container, state) {
    var layout = createElement('div', 'schedule-admin-layout');
    var calCol = createElement('div', 'schedule-admin-cal');
    var timeCol = createElement('div', 'schedule-admin-times');
    layout.appendChild(calCol);
    layout.appendChild(timeCol);
    container.appendChild(layout);

    var summaryTitle = createElement('div', 'schedule-admin-summary-title', '現在の登録済み予約枠');
    var summaryBox = createElement('div', 'schedule-admin-summary');
    container.appendChild(summaryTitle);
    container.appendChild(summaryBox);
    state.summaryContainer = summaryBox;

    var calState = { year: state.year, month: state.month, selectedDate: state.selectedDate };

    buildCalendar(calCol, calState, function (dateStr) {
      state.selectedDate = dateStr;
      state.year = calState.year;
      state.month = calState.month;
      if (state.renderTimes) state.renderTimes();
    });

    buildTimeList(timeCol, state, syncTextareas);
  }

  createPersonUI(tContainer, tetsuyaState);
  createPersonUI(cContainer, chigusaState);

  syncTextareas();

  tTab.addEventListener('click', function () {
    tTab.classList.add('active');
    cTab.classList.remove('active');
    tContainer.classList.add('schedule-admin-person-active');
    cContainer.classList.remove('schedule-admin-person-active');
  });

  cTab.addEventListener('click', function () {
    cTab.classList.add('active');
    tTab.classList.remove('active');
    cContainer.classList.add('schedule-admin-person-active');
    tContainer.classList.remove('schedule-admin-person-active');
  });
})();
