'use strict';

(function () {
  var MAX_HABITS = 3;
  var KEY = 'three.v1';
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- dates (always local time, never UTC) ---------- */

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function todayStr() { return fmt(new Date()); }
  function dow(s) { return parse(s).getDay(); }
  function weekStart(s) { return addDays(s, -dow(s)); }
  function uid() { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- core logic ---------- */

  // One habit on one day:
  // none (before habit existed), future, off (not scheduled),
  // done / miss / pending (good habits), clean / slip (bad habits)
  function habitStatus(h, date, marks, t) {
    if (date > t) return 'future';
    if (date < h.start) return 'none';
    if (h.days.indexOf(dow(date)) === -1) return 'off';
    var marked = !!(marks[date] && marks[date][h.id]);
    if (h.type === 'good') return marked ? 'done' : (date === t ? 'pending' : 'miss');
    return marked ? 'slip' : 'clean';
  }

  // All habits on one day: green, red, pending, none, future
  function dayStatus(habits, date, marks, t) {
    if (date > t) return 'future';
    var active = habits.filter(function (h) { return h.start <= date; });
    if (!active.length) return 'none';
    var sts = active.map(function (h) { return habitStatus(h, date, marks, t); });
    if (sts.some(function (s) { return s === 'miss' || s === 'slip'; })) return 'red';
    if (sts.some(function (s) { return s === 'pending'; })) return 'pending';
    return 'green';
  }

  // Consecutive green days. Today only counts once it is green;
  // an unfinished today does not break the streak.
  function currentStreak(habits, marks, t) {
    var d = t;
    var n = 0;
    if (dayStatus(habits, d, marks, t) === 'pending') d = addDays(d, -1);
    while (dayStatus(habits, d, marks, t) === 'green') {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  function stats(habits, marks, t) {
    var out = { current: 0, best: 0, greens: 0 };
    if (!habits.length) return out;
    out.current = currentStreak(habits, marks, t);
    var d = habits.map(function (h) { return h.start; }).sort()[0];
    var run = 0;
    while (d <= t) {
      var s = dayStatus(habits, d, marks, t);
      if (s === 'green') {
        run++;
        out.greens++;
        if (run > out.best) out.best = run;
      } else if (s !== 'pending') {
        run = 0;
      }
      d = addDays(d, 1);
    }
    return out;
  }

  // Streak for a single habit. Rest days neither add nor break.
  function habitStreak(h, marks, t) {
    var d = t;
    var n = 0;
    if (habitStatus(h, d, marks, t) === 'pending') d = addDays(d, -1);
    while (d >= h.start) {
      var s = habitStatus(h, d, marks, t);
      if (s === 'done' || s === 'clean') n++;
      else if (s !== 'off') break;
      d = addDays(d, -1);
    }
    return n;
  }

  function sanitizeHabit(h) {
    if (!h || typeof h !== 'object') return null;
    var name = typeof h.name === 'string' ? h.name.trim().slice(0, 40) : '';
    if (!name) return null;
    var type = h.type === 'bad' ? 'bad' : 'good';
    var days = Array.isArray(h.days) ? h.days.filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 6; }) : ALL_DAYS;
    days = Array.from(new Set(days)).sort(function (a, b) { return a - b; });
    if (!days.length) days = ALL_DAYS.slice();
    var start = typeof h.start === 'string' && DATE_RE.test(h.start) ? h.start : todayStr();
    var id = typeof h.id === 'string' && h.id ? h.id : uid();
    return { id: id, name: name, type: type, days: days, start: start };
  }

  function normalize(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.habits)) return null;
    var seen = new Set();
    var habits = [];
    s.habits.forEach(function (raw) {
      var h = sanitizeHabit(raw);
      if (h && !seen.has(h.id) && habits.length < MAX_HABITS) { seen.add(h.id); habits.push(h); }
    });
    var marks = {};
    var src = s.marks && typeof s.marks === 'object' ? s.marks : {};
    Object.keys(src).forEach(function (d) {
      if (!DATE_RE.test(d) || !src[d] || typeof src[d] !== 'object') return;
      var m = {};
      Object.keys(src[d]).forEach(function (id) { if (seen.has(id) && src[d][id]) m[id] = true; });
      if (Object.keys(m).length) marks[d] = m;
    });
    return { habits: habits, marks: marks };
  }

  var core = {
    habitStatus: habitStatus, dayStatus: dayStatus, currentStreak: currentStreak,
    stats: stats, habitStreak: habitStreak, normalize: normalize, addDays: addDays,
    weekStart: weekStart, fmt: fmt, parse: parse
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  /* ---------- UI ---------- */

  var WEEKS = 20;
  var CLS = { green: 'g', red: 'r', pending: 'p', none: 'n', future: 'f',
    done: 'g', clean: 'g', miss: 'r', slip: 'r', off: 'o' };
  var STATUS_WORD = { done: 'done', clean: 'clean', miss: 'missed', slip: 'slipped', pending: 'not done yet',
    off: 'not scheduled', none: 'before this habit', future: 'upcoming' };
  var TAPPABLE = ['done', 'clean', 'miss', 'slip', 'pending'];

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function label(d) { return parse(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function monthName(d) { return parse(d).toLocaleDateString(undefined, { month: 'short' }); }

  var state = load();
  var renderedDay = todayStr();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var n = normalize(JSON.parse(raw)); if (n) return n; }
    } catch (e) { /* fall through */ }
    return { habits: [], marks: {} };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Storage may be blocked.'); }
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2300);
  }

  function findHabit(id) { return state.habits.filter(function (h) { return h.id === id; })[0]; }

  function toggleMark(id, date) {
    var h = findHabit(id);
    if (!h) return;
    var t = todayStr();
    if (date > t || date < h.start || h.days.indexOf(dow(date)) === -1) return;
    var m = state.marks[date] || (state.marks[date] = {});
    if (m[id]) delete m[id]; else m[id] = true;
    if (!Object.keys(m).length) delete state.marks[date];
    save();
    render();
    if (date !== t) toast(label(date) + ' updated');
  }

  function freqText(days) {
    var k = days.join(',');
    if (k === '0,1,2,3,4,5,6') return 'Every day';
    if (k === '1,2,3,4,5') return 'Weekdays';
    if (k === '0,6') return 'Weekends';
    return days.map(function (d) { return DAY_NAMES[d]; }).join(', ');
  }

  function dayDetail(date) {
    var t = todayStr();
    var active = state.habits.filter(function (h) { return h.start <= date; });
    if (!active.length) return label(date) + ': no habits yet';
    var parts = active.map(function (h) { return { h: h, s: habitStatus(h, date, state.marks, t) }; });
    var bad = parts.filter(function (p) { return p.s === 'miss' || p.s === 'slip'; })
      .map(function (p) { return (p.s === 'miss' ? 'missed ' : 'slipped on ') + p.h.name; });
    if (bad.length) return label(date) + ': red. ' + bad.join(', ') + '.';
    var left = parts.filter(function (p) { return p.s === 'pending'; }).length;
    if (left) return label(date) + ': in progress, ' + left + ' to go.';
    return label(date) + ': green. Everything on track.';
  }

  function logoSvg() {
    var lit = ['111', '001', '111', '001', '111'];
    var s = 10, g = 2, out = '';
    lit.forEach(function (row, r) {
      row.split('').forEach(function (ch, c) {
        out += '<rect x="' + (c * (s + g)) + '" y="' + (r * (s + g)) + '" width="' + s + '" height="' + s + '" rx="2.5" fill="' +
          (ch === '1' ? '#6ee7a1' : 'rgba(255,255,255,0.14)') + '"/>';
      });
    });
    return '<svg viewBox="0 0 34 58" xmlns="http://www.w3.org/2000/svg">' + out + '</svg>';
  }

  /* ---------- rendering ---------- */

  function renderHero(t) {
    var s = stats(state.habits, state.marks, t);
    var today = dayStatus(state.habits, t, state.marks, t);
    var msg, cls = '';
    if (!state.habits.length) {
      msg = 'Add your first habit to start a streak.';
    } else if (today === 'green') {
      msg = 'Today is green. Nice.'; cls = 'good';
    } else if (today === 'red') {
      msg = 'Today went red. Tomorrow is a fresh square.'; cls = 'bad';
    } else {
      var left = state.habits.filter(function (h) { return habitStatus(h, t, state.marks, t) === 'pending'; }).length;
      msg = left + (left === 1 ? ' habit' : ' habits') + ' left to do today.';
    }
    $('#hero').innerHTML =
      '<div><div class="big">' + s.current + '</div><div class="big-label">' + (s.current === 1 ? 'day streak' : 'day streak') + '</div></div>' +
      '<div class="hero-stats">' +
      '<div class="stat"><b>' + s.best + '</b><span>Best streak</span></div>' +
      '<div class="stat"><b>' + s.greens + '</b><span>Green days</span></div>' +
      '</div>' +
      '<p class="hero-msg ' + cls + '">' + msg + '</p>';
  }

  function renderMaster(t) {
    var start = addDays(weekStart(t), -(WEEKS - 1) * 7);
    var months = '', cols = '';
    for (var w = 0; w < WEEKS; w++) {
      var ws = addDays(start, w * 7);
      var cells = '';
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i);
        var s = dayStatus(state.habits, d, state.marks, t);
        cells += '<button type="button" class="c ' + CLS[s] + (d === t ? ' t' : '') + '" data-date="' + d + '" aria-label="' + label(d) + '"' +
          (s === 'future' ? ' disabled tabindex="-1"' : '') + '></button>';
        if (d.slice(8) === '01') months += '<span style="grid-column:' + (w + 1) + '">' + monthName(d) + '</span>';
      }
      cols += '<div class="wk">' + cells + '</div>';
    }
    $('#months').innerHTML = months;
    $('#mgrid').innerHTML = cols;
  }

  function habitCard(h, t) {
    var ts = habitStatus(h, t, state.marks, t);
    var streak = habitStreak(h, state.marks, t);
    var calStart = addDays(weekStart(t), -28);
    var cells = '';
    for (var i = 0; i < 35; i++) {
      var d = addDays(calStart, i);
      var s = habitStatus(h, d, state.marks, t);
      var tap = TAPPABLE.indexOf(s) !== -1;
      cells += '<button type="button" class="c ' + CLS[s] + (d === t ? ' t' : '') + '"' +
        (tap ? ' data-date="' + d + '" data-id="' + h.id + '"' : ' disabled tabindex="-1"') +
        ' aria-label="' + label(d) + ': ' + STATUS_WORD[s] + '"></button>';
    }
    var heads = DAY_LETTERS.map(function (l) { return '<span>' + l + '</span>'; }).join('');

    var action, line = '';
    if (h.type === 'good') {
      if (ts === 'done') action = '<button type="button" class="btn done" data-act="toggle" data-id="' + h.id + '" aria-pressed="true">Done today ✓</button>';
      else if (ts === 'pending') action = '<button type="button" class="btn primary" data-act="toggle" data-id="' + h.id + '" aria-pressed="false">Mark done</button>';
      else action = '<button type="button" class="btn" disabled>Rest day</button>';
    } else {
      if (ts === 'slip') { action = '<button type="button" class="btn slip" data-act="toggle" data-id="' + h.id + '" aria-pressed="true">Slipped. Undo</button>'; line = '<div class="state-line bad">Slipped today</div>'; }
      else if (ts === 'clean') { action = '<button type="button" class="btn ghost" data-act="toggle" data-id="' + h.id + '" aria-pressed="false">I slipped</button>'; line = '<div class="state-line good">Clean so far today</div>'; }
      else action = '<button type="button" class="btn" disabled>Not tracked today</button>';
    }

    return '<article class="card habit">' +
      '<div><div class="cal-head" aria-hidden="true">' + heads + '</div><div class="cal">' + cells + '</div></div>' +
      '<div class="info">' +
      '<div class="info-top"><h3>' + esc(h.name) + '</h3>' +
      '<button type="button" class="icon-btn" data-act="edit" data-id="' + h.id + '" aria-label="Edit ' + esc(h.name) + '">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div>' +
      '<div class="meta"><span class="pill ' + h.type + '">' + (h.type === 'good' ? 'Good habit' : 'Bad habit') + '</span><span>' + freqText(h.days) + '</span></div>' +
      '<div class="streak">' + (streak ? streak + '-day streak' : 'No streak yet') + '</div>' +
      line + action +
      '</div></article>';
  }

  function renderHabits(t) {
    var html = state.habits.map(function (h) { return habitCard(h, t); }).join('');
    if (!state.habits.length) {
      html = '<div class="card empty"><h3>Pick up to three</h3><p>Good habits you want to do, bad habits you want to avoid. Keep it small so you can keep it going.</p></div>';
    }
    $('#habits').innerHTML = html;
    $('#add-wrap').innerHTML = state.habits.length < MAX_HABITS
      ? '<button type="button" class="add" id="add-btn">+ Add a habit <span>' + state.habits.length + '/' + MAX_HABITS + '</span></button>'
      : '<p class="full">Three of three. Remove one to make room.</p>';
  }

  function render() {
    var t = todayStr();
    renderedDay = t;
    $('#today-label').textContent = label(t);
    renderHero(t);
    renderMaster(t);
    renderHabits(t);
  }

  /* ---------- add / edit sheet ---------- */

  var sheet = $('#sheet');
  var editing = null;
  var form = { type: 'good', days: ALL_DAYS.slice() };
  var HINTS = {
    good: 'Mark it on each scheduled day. Done turns the square green, a miss turns it red.',
    bad: 'Stays green as long as you leave it unmarked. If you slip, mark it and the day turns red.'
  };

  function syncSheet() {
    document.querySelectorAll('#f-type button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.type === form.type));
      b.disabled = !!editing;
    });
    $('#f-type').classList.toggle('bad', form.type === 'bad');
    $('#f-hint').textContent = HINTS[form.type] + (editing ? ' Type cannot change after creation. Changing days also changes how past days are counted.' : '');
    $('#f-freq-label').textContent = form.type === 'good' ? 'Days to do it' : 'Days to avoid it';
    document.querySelectorAll('#f-days button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(form.days.indexOf(Number(b.dataset.day)) !== -1));
    });
  }

  function openSheet(id) {
    editing = id || null;
    var h = editing ? findHabit(editing) : null;
    form = h ? { type: h.type, days: h.days.slice() } : { type: 'good', days: ALL_DAYS.slice() };
    $('#sheet-title').textContent = h ? 'Edit habit' : 'New habit';
    $('#f-name').value = h ? h.name : '';
    $('#f-err').textContent = '';
    $('#f-delete').hidden = !h;
    $('#f-save').textContent = h ? 'Save changes' : 'Add habit';
    syncSheet();
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('open'); });
    if (!h) setTimeout(function () { $('#f-name').focus(); }, 60);
  }

  function closeSheet() {
    sheet.classList.remove('open');
    setTimeout(function () { sheet.hidden = true; }, 200);
  }

  function saveForm() {
    var name = $('#f-name').value.trim().replace(/\s+/g, ' ');
    var err = $('#f-err');
    if (!name) { err.textContent = 'Give your habit a name.'; return; }
    if (!form.days.length) { err.textContent = 'Pick at least one day.'; return; }
    var days = form.days.slice().sort(function (a, b) { return a - b; });
    if (editing) {
      var h = findHabit(editing);
      if (h) { h.name = name; h.days = days; }
    } else {
      if (state.habits.length >= MAX_HABITS) { err.textContent = 'You already have three habits.'; return; }
      state.habits.push({ id: uid(), name: name, type: form.type, days: days, start: todayStr() });
    }
    save();
    closeSheet();
    render();
  }

  function deleteHabit() {
    var h = findHabit(editing);
    if (!h) return;
    if (!window.confirm('Delete "' + h.name + '" and its history?')) return;
    state.habits = state.habits.filter(function (x) { return x.id !== h.id; });
    Object.keys(state.marks).forEach(function (d) {
      delete state.marks[d][h.id];
      if (!Object.keys(state.marks[d]).length) delete state.marks[d];
    });
    save();
    closeSheet();
    render();
  }

  /* ---------- backup ---------- */

  function exportData() {
    var json = JSON.stringify({ app: 'three', version: 1, exported: new Date().toISOString(), habits: state.habits, marks: state.marks }, null, 2);
    var name = 'three-backup-' + todayStr() + '.json';
    var file;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'three backup' }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      var next = null;
      try { next = normalize(JSON.parse(r.result)); } catch (e) { next = null; }
      if (!next) { toast('That is not a valid three backup.'); return; }
      if (!window.confirm('Replace your current habits with this backup?')) return;
      state = next;
      save();
      render();
      toast('Backup restored');
    };
    r.readAsText(file);
  }

  /* ---------- events ---------- */

  $('#mgrid').addEventListener('click', function (e) {
    var c = e.target.closest('.c[data-date]');
    if (c) $('#mcap').textContent = dayDetail(c.dataset.date);
  });

  $('#habits').addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'toggle') toggleMark(act.dataset.id, todayStr());
      else if (act.dataset.act === 'edit') openSheet(act.dataset.id);
      return;
    }
    var c = e.target.closest('.cal .c[data-date]');
    if (c) toggleMark(c.dataset.id, c.dataset.date);
  });

  $('#add-wrap').addEventListener('click', function (e) { if (e.target.closest('#add-btn')) openSheet(); });

  var chips = '';
  DAY_NAMES.forEach(function (n, i) { chips += '<button type="button" data-day="' + i + '" aria-pressed="false">' + n + '</button>'; });
  $('#f-days').innerHTML = chips;

  $('#f-days').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-day]');
    if (!b) return;
    var d = Number(b.dataset.day);
    var i = form.days.indexOf(d);
    if (i === -1) form.days.push(d); else form.days.splice(i, 1);
    $('#f-err').textContent = '';
    syncSheet();
  });

  document.querySelector('.presets').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-preset]');
    if (!b) return;
    form.days = b.dataset.preset === 'all' ? ALL_DAYS.slice() : b.dataset.preset === 'week' ? [1, 2, 3, 4, 5] : [0, 6];
    $('#f-err').textContent = '';
    syncSheet();
  });

  $('#f-type').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-type]');
    if (!b || editing) return;
    form.type = b.dataset.type;
    syncSheet();
  });

  $('#f-save').addEventListener('click', saveForm);
  $('#f-delete').addEventListener('click', deleteHabit);
  $('#sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  $('#f-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveForm(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  $('#export').addEventListener('click', exportData);
  $('#import').addEventListener('click', function () { $('#import-file').click(); });
  $('#import-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) importData(f);
    e.target.value = '';
  });

  // Roll over to the new day without a reload
  function checkDay() { if (todayStr() !== renderedDay) render(); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDay(); });
  window.addEventListener('focus', checkDay);
  setInterval(checkDay, 30000);

  /* ---------- boot ---------- */

  document.documentElement.style.setProperty('--weeks', WEEKS);
  $('#logo').innerHTML = logoSvg();
  render();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
})();
