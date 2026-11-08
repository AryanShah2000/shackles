'use strict';

(function () {
  var MAX_HABITS = 3;
  var LOG_MAX = 2000;
  var SLIP_CYCLE_MAX = 5;
  var KEY = 'three.v1';
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  var ACTS = ['done', 'undone', 'slip', 'unslip'];
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

  // marks[date][habitId] is a count. Good habits use 1. Bad habits count slips.
  // Older saves stored `true`, which reads as 1.
  function markCount(marks, date, id) {
    var m = marks[date];
    var v = m && m[id];
    if (!v) return 0;
    return typeof v === 'number' ? v : 1;
  }

  // One habit on one day:
  // none (before habit existed), future, off (not scheduled),
  // done / miss / pending (good habits), clean / slip (bad habits)
  function habitStatus(h, date, marks, t) {
    if (date > t) return 'future';
    if (date < h.start) return 'none';
    if (h.days.indexOf(dow(date)) === -1) return 'off';
    var marked = markCount(marks, date, h.id) > 0;
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

  // Total marks (slips) for a habit over the last `days` days, today included.
  function countIn(h, marks, t, days) {
    var n = 0;
    for (var i = 0; i < days; i++) n += markCount(marks, addDays(t, -i), h.id);
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

  // The history log: one entry per tap, stamped with the real time of the tap.
  // { t: ms since epoch, id, name, type, date: the day it applies to, act, n: count after }
  function sanitizeLog(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (typeof e.t !== 'number' || !isFinite(e.t) || e.t <= 0) return;
      if (typeof e.id !== 'string' || ACTS.indexOf(e.act) === -1) return;
      if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) return;
      out.push({
        t: Math.floor(e.t),
        id: e.id,
        name: String(e.name || '').slice(0, 40),
        type: e.type === 'bad' ? 'bad' : 'good',
        date: e.date,
        act: e.act,
        n: Number.isInteger(e.n) && e.n >= 0 && e.n <= 99 ? e.n : 0
      });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(-LOG_MAX);
  }

  // Union of two logs, so history from two devices is never lost.
  function mergeLogs(a, b) {
    var seen = {};
    var out = [];
    a.concat(b).forEach(function (e) {
      var k = e.t + '|' + e.id + '|' + e.act;
      if (!seen[k]) { seen[k] = true; out.push(e); }
    });
    out.sort(function (x, y) { return x.t - y.t; });
    return out.slice(-LOG_MAX);
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
      Object.keys(src[d]).forEach(function (id) {
        if (!seen.has(id)) return;
        var v = src[d][id];
        var n = typeof v === 'number' ? Math.floor(v) : (v ? 1 : 0);
        if (n > 0) m[id] = Math.min(n, 99);
      });
      if (Object.keys(m).length) marks[d] = m;
    });
    var updated = typeof s.updated === 'number' && isFinite(s.updated) ? Math.floor(s.updated) : 0;
    return { habits: habits, marks: marks, log: sanitizeLog(s.log), updated: updated };
  }

  var core = {
    habitStatus: habitStatus, dayStatus: dayStatus, currentStreak: currentStreak,
    stats: stats, habitStreak: habitStreak, normalize: normalize, addDays: addDays,
    weekStart: weekStart, fmt: fmt, parse: parse, markCount: markCount, countIn: countIn,
    sanitizeLog: sanitizeLog, mergeLogs: mergeLogs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  /* ---------- UI ---------- */

  var WEEKS = 14;
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
  function times(n) { return n === 1 ? 'once' : n + ' times'; }

  var state = load();
  var renderedDay = todayStr();
  var currentTab = 'today';
  var openGrids = {}; // which habit grids are expanded, kept across re-renders

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var n = normalize(JSON.parse(raw));
        if (n) {
          if (!n.updated && n.habits.length) n.updated = Date.now(); // data from before sync existed
          return n;
        }
      }
    } catch (e) { /* fall through */ }
    return { habits: [], marks: {}, log: [], updated: 0 };
  }

  function persistLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Storage may be blocked.'); }
  }

  // Every local change stamps the data and queues a sync.
  function save() {
    state.updated = Date.now();
    persistLocal();
    scheduleSync();
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

  function logEvent(h, date, act, n) {
    state.log.push({ t: Date.now(), id: h.id, name: h.name, type: h.type, date: date, act: act, n: n });
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
  }

  // The one place marks change. Writes the mark, logs the tap, saves, redraws.
  function setCount(id, date, next, act) {
    var h = findHabit(id);
    if (!h) return;
    var t = todayStr();
    if (date > t || date < h.start || h.days.indexOf(dow(date)) === -1) return;
    next = Math.max(0, Math.min(99, next));
    var cur = markCount(state.marks, date, id);
    if (next === cur) return;
    var m = state.marks[date] || (state.marks[date] = {});
    if (next > 0) m[id] = next; else delete m[id];
    if (!Object.keys(m).length) delete state.marks[date];
    logEvent(h, date, act, next);
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
      .map(function (p) {
        if (p.s === 'miss') return 'missed ' + p.h.name;
        var c = markCount(state.marks, date, p.h.id);
        return 'slipped on ' + p.h.name + (c > 1 ? ' (' + c + 'x)' : '');
      });
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

  /* ---------- rendering: today ---------- */

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
      '<div><div class="big">' + s.current + '</div><div class="big-label">day streak</div></div>' +
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

  function habitRow(h, t) {
    var ts = habitStatus(h, t, state.marks, t);
    var count = markCount(state.marks, t, h.id);
    var streak = habitStreak(h, state.marks, t);
    var id = h.id;
    var open = !!openGrids[id];

    var action, state_ = '';
    if (h.type === 'good') {
      if (ts === 'done') action = '<button type="button" class="btn sm done" data-act="toggle" data-id="' + id + '" aria-pressed="true">Done ✓</button>';
      else if (ts === 'pending') action = '<button type="button" class="btn sm primary" data-act="toggle" data-id="' + id + '" aria-pressed="false">Mark done</button>';
      else action = '<button type="button" class="btn sm" disabled>Rest day</button>';
      state_ = streak ? streak + '-day streak' : 'No streak yet';
    } else if (ts === 'off') {
      action = '<button type="button" class="btn sm" disabled>Off today</button>';
      state_ = 'Not tracked today';
    } else {
      action = '<button type="button" class="btn sm slipbtn' + (count ? ' hot' : '') + '" data-act="slip" data-id="' + id + '">' + (count ? 'I slipped again' : 'I slipped') + '</button>' +
        (count ? '<button type="button" class="btn sm undo" data-act="unslip" data-id="' + id + '" aria-label="Undo last slip">Undo</button>' : '');
      state_ = count ? '<span class="bad">Slipped ' + times(count) + ' today</span>' : '<span class="good">Clean today</span>';
    }
    var meta = '<span class="' + h.type + '">' + (h.type === 'good' ? 'Good' : 'Bad') + '</span> · ' + freqText(h.days) + ' · ' + state_;

    var more = '';
    if (open) {
      var calStart = addDays(weekStart(t), -28);
      var cells = '';
      for (var i = 0; i < 35; i++) {
        var d = addDays(calStart, i);
        var s = habitStatus(h, d, state.marks, t);
        var tap = TAPPABLE.indexOf(s) !== -1;
        var c = markCount(state.marks, d, id);
        var word = STATUS_WORD[s] + (h.type === 'bad' && c > 1 ? ' ' + c + ' times' : '');
        cells += '<button type="button" class="c ' + CLS[s] + (d === t ? ' t' : '') + '"' +
          (h.type === 'bad' && c > 1 ? ' data-n="' + c + '"' : '') +
          (tap ? ' data-date="' + d + '" data-id="' + id + '"' : ' disabled tabindex="-1"') +
          ' aria-label="' + label(d) + ': ' + word + '"></button>';
      }
      var heads = DAY_LETTERS.map(function (l) { return '<span>' + l + '</span>'; }).join('');
      var hint = h.type === 'bad' ? 'Tap a past day to add a slip. Keep tapping to add more, up to ' + SLIP_CYCLE_MAX + ', then it clears.' : 'Tap a past day to fix it.';
      more = '<div class="hrow-more"><div class="cal-head" aria-hidden="true">' + heads + '</div><div class="cal">' + cells + '</div>' +
        '<p class="cal-hint">' + hint + '</p>' +
        '<button type="button" class="link edit-link" data-act="edit" data-id="' + id + '">Edit habit</button></div>';
    }

    return '<article class="hrow' + (open ? ' open' : '') + '">' +
      '<div class="hrow-main">' +
      '<button type="button" class="hrow-name" data-act="expand" data-id="' + id + '" aria-expanded="' + open + '">' +
      '<span class="hname">' + esc(h.name) +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>' +
      '<span class="hmeta">' + meta + '</span></button>' +
      '<div class="hrow-actions">' + action + '</div></div>' + more + '</article>';
  }

  function renderHabits(t) {
    var html;
    if (!state.habits.length) {
      html = '<div class="card empty"><h3>Pick up to three</h3><p>Good habits you want to do, bad habits you want to avoid. Keep it small so you can keep it going.</p></div>';
    } else {
      html = '<div class="card habit-list">' + state.habits.map(function (h) { return habitRow(h, t); }).join('') + '</div>';
    }
    $('#habits').innerHTML = html;
    $('#add-wrap').innerHTML = state.habits.length < MAX_HABITS
      ? '<button type="button" class="add" id="add-btn">+ Add a habit <span>' + state.habits.length + '/' + MAX_HABITS + '</span></button>'
      : '<p class="full">Three of three. Remove one to make room.</p>';
  }

  /* ---------- rendering: history ---------- */

  function tzAbbr() {
    try {
      var p = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date())
        .filter(function (x) { return x.type === 'timeZoneName'; })[0];
      return p ? p.value : '';
    } catch (e) { return ''; }
  }

  function actText(e) {
    var tapDay = fmt(new Date(e.t));
    var suffix = e.date !== tapDay ? ' for ' + label(e.date) : '';
    if (e.act === 'done') return 'marked done' + suffix;
    if (e.act === 'undone') return 'unmarked' + suffix;
    if (e.act === 'slip') return (e.n > 1 ? 'slipped again (#' + e.n + ')' : 'slipped') + suffix;
    return (e.n === 0 ? 'cleared all slips' : 'undid a slip (now ' + e.n + ')') + suffix;
  }

  function dayTitle(day, t) {
    var full = parse(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (day === t) return 'Today · ' + full;
    if (day === addDays(t, -1)) return 'Yesterday · ' + full;
    return full;
  }

  function renderHistory() {
    var t = todayStr();
    var bads = state.habits.filter(function (h) { return h.type === 'bad'; });
    $('#slip-summary').innerHTML = bads.length
      ? '<div class="card slips"><h2>Slips</h2>' + bads.map(function (h) {
        return '<div class="slip-row"><b>' + esc(h.name) + '</b><span>Today ' + countIn(h, state.marks, t, 1) +
          ' · Last 7 days ' + countIn(h, state.marks, t, 7) +
          ' · Last 30 days ' + countIn(h, state.marks, t, 30) + '</span></div>';
      }).join('') + '</div>'
      : '';

    var tz = tzAbbr();
    var note = '<p class="hist-note">Every tap is logged with its time, in your device\'s local time' + (tz ? ' (' + esc(tz) + ')' : '') + '.</p>';
    var log = state.log.slice().sort(function (a, b) { return b.t - a.t; });
    if (!log.length) {
      $('#history').innerHTML = note + '<p class="hist-note">Nothing logged yet. Tap a habit on the Today tab and it will show up here.</p>';
      return;
    }
    var shown = log.slice(0, 400);
    var html = note, lastDay = '';
    shown.forEach(function (e) {
      var d = new Date(e.t);
      var day = fmt(d);
      if (day !== lastDay) {
        if (lastDay) html += '</div>';
        html += '<div class="hist-day"><h3>' + dayTitle(day, t) + '</h3>';
        lastDay = day;
      }
      var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      var dot = e.act === 'done' ? 'g' : e.act === 'slip' ? 'r' : '';
      html += '<div class="hist-row"><span class="hist-time">' + esc(time) + '</span><i class="dot ' + dot + '"></i>' +
        '<span class="hist-what"><b>' + esc(e.name) + '</b> ' + esc(actText(e)) + '</span></div>';
    });
    html += '</div>';
    if (log.length > shown.length) html += '<p class="hist-note">Showing the latest ' + shown.length + ' of ' + log.length + ' entries.</p>';
    $('#history').innerHTML = html;
  }

  function render() {
    var t = todayStr();
    renderedDay = t;
    $('#today-label').textContent = label(t);
    renderHero(t);
    renderMaster(t);
    renderHabits(t);
    if (currentTab === 'history') renderHistory();
  }

  function setTab(name) {
    currentTab = name;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === name));
    });
    $('#view-today').hidden = name !== 'today';
    $('#view-history').hidden = name !== 'history';
    if (name === 'history') renderHistory();
    window.scrollTo(0, 0);
  }

  /* ---------- add / edit sheet ---------- */

  var sheet = $('#sheet');
  var editing = null;
  var form = { type: 'good', days: ALL_DAYS.slice() };
  var HINTS = {
    good: 'Mark it on each scheduled day. Done turns the square green, a miss turns it red.',
    bad: 'Stays green as long as you leave it unmarked. Each slip you log turns the day red and is counted.'
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
    if (!window.confirm('Delete "' + h.name + '" and its grid? Its entries stay in History.')) return;
    state.habits = state.habits.filter(function (x) { return x.id !== h.id; });
    Object.keys(state.marks).forEach(function (d) {
      delete state.marks[d][h.id];
      if (!Object.keys(state.marks[d]).length) delete state.marks[d];
    });
    delete openGrids[h.id];
    save();
    closeSheet();
    render();
  }

  /* ---------- backup ---------- */

  function exportData() {
    var json = JSON.stringify({ app: 'three', version: 2, exported: new Date().toISOString(), habits: state.habits, marks: state.marks, log: state.log }, null, 2);
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

  /* ---------- cloud sync (Neon via /api/data) ---------- */

  // Local storage stays the source of truth for the UI, so the app works offline.
  // When a passcode is set, the whole document syncs to the server. Newest edit wins,
  // and history logs from both sides are merged so no entries are lost.
  var PASS_KEY = 'three.passcode';
  var syncStatus = 'off';
  var syncing = false;
  var syncAgain = false;
  var syncTimer;

  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function setPass(v) { try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch (e) { /* ignore */ } }

  function api(method, body) {
    return fetch('./api/data', {
      method: method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPass() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 401) { var a = new Error('auth'); a.code = 401; throw a; }
        if (!r.ok && r.status !== 409) { var e = new Error(j.error || 'error'); e.code = r.status; throw e; }
        j.status = r.status;
        return j;
      });
    });
  }

  function setSyncStatus(s) { syncStatus = s; renderSync(); }

  function renderSync() {
    var text = { off: 'Saved on this device only.', syncing: 'Syncing...', synced: 'Synced across your devices.',
      offline: 'Offline. Will retry.', auth: 'Wrong passcode.' }[syncStatus];
    $('#sync-line').textContent = text;
    $('#sync-actions').innerHTML = getPass()
      ? '<button type="button" class="link" data-sync="now">Sync now</button> <span aria-hidden="true">/</span> <button type="button" class="link" data-sync="off">Turn off sync</button>'
      : '<button type="button" class="link" data-sync="on">Turn on sync</button>';
  }

  function scheduleSync() {
    if (!getPass()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 800);
  }

  function adopt(remote) {
    var rd = normalize(remote);
    if (!rd) return false;
    rd.log = mergeLogs(state.log, rd.log);
    state = rd;
    persistLocal();
    render();
    return true;
  }

  function syncNow() {
    if (!getPass()) { setSyncStatus('off'); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    setSyncStatus('syncing');
    api('GET')
      .then(function (res) {
        var remote = res.data ? normalize(res.data) : null;
        if (remote && remote.updated > state.updated) { adopt(res.data); return; }
        if (!remote || state.updated > remote.updated) {
          return api('PUT', { data: { habits: state.habits, marks: state.marks, log: mergeLogs(state.log, remote ? remote.log : []), updated: state.updated } })
            .then(function (put) { if (put.status === 409 && put.data) adopt(put.data); });
        }
      })
      .then(function () { setSyncStatus('synced'); })
      .catch(function (err) { setSyncStatus(err && err.code === 401 ? 'auth' : 'offline'); })
      .then(function () {
        syncing = false;
        if (syncAgain) { syncAgain = false; syncNow(); }
      });
  }

  /* ---------- events ---------- */

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  $('#sync-actions').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sync]');
    if (!b) return;
    if (b.dataset.sync === 'on') {
      var p = window.prompt('Enter your sync passcode (the APP_PASSCODE you set in Vercel):');
      if (p && p.trim()) { setPass(p.trim()); syncNow(); }
    } else if (b.dataset.sync === 'off') {
      if (window.confirm('Turn off sync on this device? Your data stays here and in the cloud.')) { setPass(''); setSyncStatus('off'); }
    } else {
      syncNow();
    }
  });

  $('#mgrid').addEventListener('click', function (e) {
    var c = e.target.closest('.c[data-date]');
    if (c) $('#mcap').textContent = dayDetail(c.dataset.date);
  });

  $('#habits').addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    var t = todayStr();
    if (act) {
      var id = act.dataset.id;
      var cur = markCount(state.marks, t, id);
      if (act.dataset.act === 'toggle') setCount(id, t, cur ? 0 : 1, cur ? 'undone' : 'done');
      else if (act.dataset.act === 'slip') setCount(id, t, cur + 1, 'slip');
      else if (act.dataset.act === 'unslip') setCount(id, t, cur - 1, 'unslip');
      else if (act.dataset.act === 'expand') { openGrids[id] = !openGrids[id]; renderHabits(t); }
      else if (act.dataset.act === 'edit') openSheet(id);
      return;
    }
    // Tapping a past day in a habit grid
    var c = e.target.closest('.cal .c[data-date]');
    if (!c) return;
    var h = findHabit(c.dataset.id);
    if (!h) return;
    var n = markCount(state.marks, c.dataset.date, h.id);
    if (h.type === 'good') {
      setCount(h.id, c.dataset.date, n ? 0 : 1, n ? 'undone' : 'done');
    } else {
      var next = n >= SLIP_CYCLE_MAX ? 0 : n + 1;
      setCount(h.id, c.dataset.date, next, next > n ? 'slip' : 'unslip');
    }
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
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkDay(); syncNow(); } });
  window.addEventListener('online', syncNow);
  window.addEventListener('focus', checkDay);
  setInterval(checkDay, 30000);

  /* ---------- boot ---------- */

  document.documentElement.style.setProperty('--weeks', WEEKS);
  $('#logo').innerHTML = logoSvg();
  render();
  renderSync();
  syncNow();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
})();
