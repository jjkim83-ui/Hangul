/* =========================================================
   class.js — the class layer for the online version.
   6 student accounts (tap your avatar, no PIN), stars per round,
   a daily time limit, a weekly scoreboard with a crown, and a
   teacher login (PIN) for names, points and the chapter.

   Storage: works on one device with localStorage. When
   CLASS_CONFIG.supabaseUrl + supabaseKey are filled in, the same
   API reads/writes the shared Supabase database instead.
   Everything below is synchronous for the pages (they read a
   cache); network writes happen in the background.
========================================================= */
(function () {
  'use strict';

  const CONFIG = Object.assign({
    supabaseUrl: '',          // e.g. https://xxxx.supabase.co
    supabaseKey: '',          // the project's anon / publishable key
    classId: 'hangul-4-1'
  }, window.CLASS_CONFIG || {});

  const LS_DATA = 'hangul_class_v1';
  const LS_ME = 'hangul_me_v1';
  const LS_TEACHER = 'hangul_teacher_v1';
  const LS_ROOM = 'hangul_room_v1';

  /* ---------- rules ---------- */
  const RULES = {
    roundsPerGame: 3,        // rounds per game per day that earn stars
    dailyMinutes: 15,        // after this, rounds are practice only
    maxRoundMinutes: 10,     // one round never counts more time than this
    // accuracy (0..1) -> stars; [for 3 stars, for 2 stars]
    thresholds: { memory: [0.55, 0.4], quiz: [0.9, 0.7], crossword: [0.85, 0.6], syllables: [0.9, 0.7], chosung: [0.85, 0.6] },
    roundSize: { memory: 8, quiz: 10, crossword: 8, syllables: 8, chosung: 8 }   // fixed size for students, so stars are fair
  };
  const GAME_NAMES = { memory: '카드 짝맞추기', quiz: '단어 퀴즈', crossword: '십자말풀이', syllables: '글자 조각', chosung: '초성 퀴즈', race: '주사위 보드게임' };

  /* ---------- default class ---------- */
  const DEFAULT_CFGS = [
    { head: 0, hair: 1, eyes: 3, brows: 0, nose: 0, mouth: 0, glasses: 0, shirt: 2, acc: 0, skin: 1, hairC: 0, shirtC: 0, accC: 3, blush: true, freckles: false, bg: 0 },
    { head: 1, hair: 3, eyes: 1, brows: 2, nose: 2, mouth: 1, glasses: 1, shirt: 0, acc: 0, skin: 3, hairC: 1, shirtC: 2, accC: 5, blush: true, freckles: true, bg: 1 },
    { head: 0, hair: 2, eyes: 0, brows: 1, nose: 1, mouth: 4, glasses: 0, shirt: 3, acc: 4, skin: 0, hairC: 4, shirtC: 5, accC: 1, blush: true, freckles: true, bg: 4 },
    { head: 2, hair: 4, eyes: 5, brows: 0, nose: 0, mouth: 5, glasses: 2, shirt: 1, acc: 3, skin: 5, hairC: 0, shirtC: 4, accC: 1, blush: false, freckles: false, bg: 3 },
    { head: 1, hair: 6, eyes: 2, brows: 1, nose: 3, mouth: 2, glasses: 0, shirt: 2, acc: 1, skin: 2, hairC: 2, shirtC: 3, accC: 0, blush: true, freckles: false, bg: 2 },
    { head: 2, hair: 8, eyes: 4, brows: 2, nose: 1, mouth: 3, glasses: 1, shirt: 0, acc: 5, skin: 4, hairC: 1, shirtC: 7, accC: 2, blush: false, freckles: true, bg: 5 }
  ];
  const DEFAULT_NAMES = ['레오', '수민', '세나', '리안', '하얀', '규빈'];
  function defaultData() {
    return {
      students: DEFAULT_CFGS.map((cfg, i) => ({ id: 's' + (i + 1), name: DEFAULT_NAMES[i], cfg })),
      settings: { lessons: [4], chapterTitle: '4과 외모보다 성격', period: 'week', pinHash: '' },
      plays: []
    };
  }

  /* ---------- dates — always Swiss time (Europe/Zurich), whatever the device says.
     A scoring week runs from Saturday 12:00 to the next Saturday 12:00 (class to class).
     Daily limits reset at midnight. ---------- */
  const TZ = 'Europe/Zurich';
  const WEEK_START_DAY = 6;      // Saturday
  const WEEK_START_HOUR = 12;    // noon
  const pad = (n) => (n < 10 ? '0' : '') + n;
  let fmt = null;
  try { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); } catch (e) {}
  function wall(d) {             // Swiss wall-clock time as a UTC-based Date (for calendar maths only)
    d = d || new Date();
    if (!fmt) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
    const p = {}; fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second));
  }
  const ymd = (u) => u.getUTCFullYear() + '-' + pad(u.getUTCMonth() + 1) + '-' + pad(u.getUTCDate());
  function dayKey(d) { return ymd(wall(d)); }
  function weekKey(d) {          // the Saturday (date) on which the current week began at noon
    const t = new Date(wall(d).getTime() - WEEK_START_HOUR * 3600 * 1000);
    const back = (t.getUTCDay() - WEEK_START_DAY + 7) % 7;
    return ymd(new Date(t.getTime() - back * 86400 * 1000));
  }
  function prevWeekKey(wk) { const u = new Date(wk + 'T00:00:00Z'); return ymd(new Date(u.getTime() - 7 * 86400 * 1000)); }
  function weekLabel(wk) {
    const a = new Date(wk + 'T00:00:00Z'), b = new Date(a.getTime() + 7 * 86400 * 1000);
    return (a.getUTCMonth() + 1) + '/' + a.getUTCDate() + ' 12:00 – ' + (b.getUTCMonth() + 1) + '/' + b.getUTCDate() + ' 12:00';
  }

  /* ---------- cache + backends ---------- */
  let data = null;
  const listeners = [];
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  const online = !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);

  function fixup(d) {
    const def = defaultData();
    if (!d || !Array.isArray(d.students) || !d.students.length) d = Object.assign(def, d && d.plays ? { plays: d.plays } : {});
    d.settings = Object.assign({}, def.settings, d.settings || {});
    d.plays = Array.isArray(d.plays) ? d.plays : [];
    return d;
  }
  data = fixup(lsGet(LS_DATA));

  /* Supabase REST (no library needed) */
  const SB = {
    h(extra) { const k = CONFIG.supabaseKey, b = { apikey: k, 'Content-Type': 'application/json' }; if (/^eyJ/.test(k)) b.Authorization = 'Bearer ' + k; return Object.assign(b, extra || {}); },
    url(p) { return CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + p; },
    get(p) { return fetch(SB.url(p), { headers: SB.h() }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); },
    post(p, body, prefer) { return fetch(SB.url(p), { method: 'POST', headers: SB.h({ Prefer: prefer || 'return=minimal' }), body: JSON.stringify(body) }).then(r => { if (!r.ok) return r.text().then(t => { throw new Error(r.status + ' ' + t); }); return r.status === 204 ? null : r.json().catch(() => null); }); },
    rpc(fn, args) { return SB.post('rpc/' + fn, args, 'return=representation'); }
  };
  let syncError = '';
  function pull() {
    if (!online) return Promise.resolve();
    const c = encodeURIComponent(CONFIG.classId);
    const since = new Date(); since.setDate(since.getDate() - 35);
    return Promise.all([
      SB.get('students?class_id=eq.' + c + '&order=sort.asc'),
      SB.get('class_settings?class_id=eq.' + c + '&select=class_id,settings,has_pin'),
      SB.get('plays?class_id=eq.' + c + '&at=gte.' + since.toISOString() + '&order=at.asc&limit=5000')
    ]).then(([st, se, pl]) => {
      const d = defaultData();
      if (st.length) d.students = st.map(s => ({ id: s.id, name: s.name, cfg: s.cfg }));
      if (se.length) d.settings = Object.assign(d.settings, se[0].settings || {}, { hasPin: !!se[0].has_pin });
      delete d.settings.pinHash;
      d.plays = pl.map(p => ({ id: p.id, sid: p.student_id, game: p.game, stars: p.stars, acc: p.acc, dur: p.dur, day: p.day, week: p.week, at: p.at, counted: p.counted, note: p.note || '' }));
      data = fixup(d); lsSet(LS_DATA, data); syncError = ''; syncToday(); emit();
    }).catch(e => { syncError = String(e.message || e); emit(); });
  }
  function save() { lsSet(LS_DATA, data); emit(); }

  /* ---------- helpers ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function cleanName(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 10); }
  function sha(text) {
    try {
      if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', new TextEncoder().encode('hangul:' + text)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));
    } catch (e) {}
    let h = 5381; const s = 'hangul:' + text; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Promise.resolve('djb' + (h >>> 0).toString(16));
  }

  /* ---------- public API ---------- */
  const CP = {
    online, RULES, GAME_NAMES,
    dayKey, weekKey, prevWeekKey, weekLabel,
    syncError: () => syncError,
    onChange(fn) { listeners.push(fn); },
    refresh: pull,

    students() { return data.students; },
    student(id) { return data.students.find(s => s.id === id) || null; },
    settings() { return data.settings; },
    lessons() { return (data.settings.lessons || [4]).slice(); },
    me() { const id = lsGet(LS_ME); return id ? CP.student(id) : null; },
    setMe(id) { lsSet(LS_ME, id); syncToday(); emit(); },
    logout() { try { localStorage.removeItem(LS_ME); } catch (e) {} emit(); },

    updateMe(patch) {
      const me = CP.me(); if (!me) return;
      const name = patch.name !== undefined ? cleanName(patch.name) || me.name : me.name;
      const cfg = patch.cfg || me.cfg;
      Object.assign(me, { name, cfg }); save();
      if (online) SB.rpc('student_update_self', { p_class: CONFIG.classId, p_id: me.id, p_name: name, p_cfg: cfg }).catch(e => { syncError = String(e.message || e); emit(); });
    },

    /* ----- stars ----- */
    playsFor(sid, filter) { return data.plays.filter(p => p.sid === sid && (!filter || filter(p))); },
    today(sid) {
      const day = dayKey();
      const plays = CP.playsFor(sid, p => p.day === day && p.game !== 'teacher');
      const minutes = plays.reduce((a, p) => a + (p.dur || 0), 0) / 60;
      const rounds = {};
      plays.forEach(p => { if (p.counted) rounds[p.game] = (rounds[p.game] || 0) + 1; });
      const stars = plays.reduce((a, p) => a + (p.counted ? p.stars : 0), 0);
      return { minutes, rounds, stars, timeLeft: Math.max(0, RULES.dailyMinutes - minutes) };
    },
    status(game) {
      const me = CP.me();
      if (!me) return { canEarn: false, line: '', roundsLeft: 0 };
      const t = CP.today(me.id);
      const used = t.rounds[game] || 0;
      const left = Math.max(0, RULES.roundsPerGame - used);
      const timeUp = t.minutes >= RULES.dailyMinutes;
      const canEarn = left > 0 && !timeUp;
      let line;
      if (timeUp) line = '⏰ 오늘 시간 끝! 연습만 돼요 · Zeit um, nur Übung';
      else if (!left) line = '오늘 이 게임 별은 다 받았어요 · Heute keine Sterne mehr hier';
      else line = '⭐ 별 받을 수 있는 판 ' + left + '/' + RULES.roundsPerGame + ' · ' + Math.ceil(t.timeLeft) + '분 남음';
      return { canEarn, line, roundsLeft: left, minutesLeft: t.timeLeft };
    },
    _start: {},
    start(game) { CP._start[game] = Date.now(); CP._startCan = CP._startCan || {}; CP._startCan[game] = CP.status(game).canEarn; },
    finish(game, acc) {
      const me = CP.me(); if (!me) return null;
      const began = CP._start[game] || Date.now();
      const dur = Math.min(RULES.maxRoundMinutes * 60, Math.round((Date.now() - began) / 1000));
      const th = RULES.thresholds[game] || [0.9, 0.7];
      acc = Math.max(0, Math.min(1, acc || 0));
      const stars = acc >= th[0] ? 3 : acc >= th[1] ? 2 : 1;
      const counted = !!(CP._startCan && CP._startCan[game]);
      const now = new Date();
      const play = { id: uid(), sid: me.id, game, stars, acc: Math.round(acc * 100) / 100, dur, day: dayKey(now), week: weekKey(now), at: now.toISOString(), counted, note: '' };
      data.plays.push(play); save();
      delete CP._start[game];
      if (online) SB.post('plays', { id: play.id, class_id: CONFIG.classId, student_id: play.sid, game, stars, acc: play.acc, dur, day: play.day, week: play.week, at: play.at, counted, note: '' }).catch(e => { syncError = String(e.message || e); emit(); });
      const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      const line = counted
        ? starStr + '  +' + stars + ' 별 · Sterne — ' + me.name
        : starStr + '  연습 판 · Übungsrunde (오늘 별은 끝)';
      return { stars, counted, line, starStr };
    },

    /* ----- scoreboard ----- */
    board(wk) {
      wk = wk || weekKey();
      const rows = data.students.map(s => {
        const ps = data.plays.filter(p => p.sid === s.id && p.week === wk);
        const stars = ps.reduce((a, p) => a + (p.counted || p.game === 'teacher' ? p.stars : 0), 0);
        const days = {};
        ps.forEach(p => { if (p.game !== 'teacher') days[p.day] = true; });
        const minutes = ps.reduce((a, p) => a + (p.dur || 0), 0) / 60;
        return { student: s, stars, rounds: ps.filter(p => p.game !== 'teacher').length, days: Object.keys(days).length, minutes };
      });
      rows.sort((a, b) => b.stars - a.stars || b.days - a.days || a.student.name.localeCompare(b.student.name));
      let rank = 0, last = null;
      rows.forEach((r, i) => { if (r.stars !== last) { rank = i + 1; last = r.stars; } r.rank = rank; });
      return rows;
    },
    crownIds(wk) {   // winners of the given (finished) week
      const rows = CP.board(wk);
      if (!rows.length || rows[0].stars <= 0) return [];
      return rows.filter(r => r.stars === rows[0].stars).map(r => r.student.id);
    },
    hasCrown(sid) { return CP.crownIds(prevWeekKey(weekKey())).indexOf(sid) >= 0; },
    weeksWithPlays() {
      const set = {}; data.plays.forEach(p => { set[p.week] = true; }); set[weekKey()] = true;
      return Object.keys(set).sort().reverse();
    },

    /* ----- teacher ----- */
    isTeacher() {
      const t = lsGet(LS_TEACHER);
      if (!t || t.until < Date.now()) return false;
      return online ? !!t.ok : !!(t.hash === data.settings.pinHash && data.settings.pinHash);
    },
    hasPin() { return online ? data.settings.hasPin !== false : !!data.settings.pinHash; },
    teacherLogin(pin) {
      if (online) {
        return SB.rpc('teacher_check', { p_class: CONFIG.classId, p_pin: pin }).then(r => {
          if (r === 'nopin') { data.settings.hasPin = false; emit(); return { ok: false, needSetup: true }; }
          if (r !== 'ok') return { ok: false };
          lsSet(LS_TEACHER, { ok: true, until: Date.now() + 1000 * 60 * 60 * 8, pin }); emit();
          return { ok: true };
        }).catch(e => { syncError = String(e.message || e); emit(); return { ok: false, offline: true }; });
      }
      return sha(pin).then(hash => {
        if (!data.settings.pinHash) return { ok: false, needSetup: true };
        if (hash !== data.settings.pinHash) return { ok: false };
        lsSet(LS_TEACHER, { hash, until: Date.now() + 1000 * 60 * 60 * 8, pin }); emit();
        return { ok: true };
      });
    },
    teacherLogout() { try { localStorage.removeItem(LS_TEACHER); localStorage.removeItem(LS_ROOM); } catch (e) {} emit(); },
    /* class mode: the teacher runs the screen, picks who is here, games are played together (no stars) */
    roomOn() { return !!(lsGet(LS_ROOM) && CP.isTeacher()); },
    setRoom(on) {
      if (on && !CP.isTeacher()) return false;
      // class mode starts on this week's chapter; the word pool page can still change it for the lesson
      if (on) { const t = {}; CP.lessons().forEach(n => { t[n] = true; }); lsSet('hangul_today_v1', { today: t, off: {}, at: Date.now() }); lsSet(LS_ROOM, true); } else { try { localStorage.removeItem(LS_ROOM); } catch (e) {} } emit(); return true; },
    studentMode() { return !!CP.me() && !CP.roomOn(); },
    _pin() { const t = lsGet(LS_TEACHER); return t ? t.pin : ''; },
    setPin(newPin) {   // first time: anyone on the teacher page; later: only when logged in
      const old = CP._pin();
      if (online) {
        return SB.rpc('teacher_set_pin', { p_class: CONFIG.classId, p_old: old || '', p_new: newPin }).then(r => {
          if (r !== 'ok') return false;
          data.settings.hasPin = true;
          lsSet(LS_TEACHER, { ok: true, until: Date.now() + 1000 * 60 * 60 * 8, pin: newPin }); emit();
          return true;
        }).catch(e => { syncError = String(e.message || e); emit(); return false; });
      }
      if (data.settings.pinHash && !CP.isTeacher()) return Promise.resolve(false);
      return sha(newPin).then(hash => {
        data.settings.pinHash = hash; save();
        lsSet(LS_TEACHER, { hash, until: Date.now() + 1000 * 60 * 60 * 8, pin: newPin }); emit();
        return true;
      });
    },
    _teacher(fn, args, local) {
      if (!CP.isTeacher()) return false;
      local(); save();
      if (online) SB.rpc(fn, Object.assign({ p_class: CONFIG.classId, p_pin: CP._pin() }, args)).then(() => pull()).catch(e => { syncError = String(e.message || e); emit(); });
      return true;
    },
    renameStudent(id, name) {
      const s = CP.student(id); name = cleanName(name); if (!s || !name) return false;
      return CP._teacher('teacher_update_student', { p_id: id, p_name: name, p_cfg: s.cfg }, () => { s.name = name; });
    },
    adjust(id, stars, note) {
      const now = new Date();
      const cur = (CP.board().find(r => r.student.id === id) || { stars: 0 }).stars;
      if (cur + stars < 0) stars = -cur;          // the week total never goes below 0
      if (!stars) return Promise.resolve(false);
      const play = { id: uid(), sid: id, game: 'teacher', stars: Math.round(stars), acc: 1, dur: 0, day: dayKey(now), week: weekKey(now), at: now.toISOString(), counted: true, note: cleanName(note || '선생님') };
      return CP._teacher('teacher_add_play', { p_play: Object.assign({}, play, { student_id: id }) }, () => { data.plays.push(play); });
    },
    removePlay(playId) {
      return CP._teacher('teacher_delete_play', { p_id: playId }, () => { data.plays = data.plays.filter(p => p.id !== playId); });
    },
    setLessons(lessons, title) {
      return CP._teacher('teacher_set_settings', { p_settings: Object.assign({}, data.settings, { lessons, chapterTitle: title || data.settings.chapterTitle }) }, () => { data.settings.lessons = lessons; if (title) data.settings.chapterTitle = title;
        if (CP.roomOn()) { const t = {}; lessons.forEach(n => { t[n] = true; }); lsSet('hangul_today_v1', { today: t, off: {}, at: Date.now() }); } });
    },
    resetLocal() { data = defaultData(); save(); }
  };

  window.ClassPlay = CP;
  window.addEventListener('storage', (e) => { if (e.key === LS_DATA) { data = fixup(lsGet(LS_DATA)); emit(); } else if (e.key === LS_ME || e.key === LS_TEACHER || e.key === LS_ROOM) emit(); });
  // student mode: the word pool shows this week's chapter (games already use it)
  function syncToday() { try { if (!CP.studentMode()) return; const t = {}; CP.lessons().forEach(n => { t[n] = true; }); const cur = lsGet('hangul_today_v1'); if (cur && JSON.stringify(cur.today) === JSON.stringify(t)) return; lsSet('hangul_today_v1', { today: t, off: {}, at: Date.now() }); } catch (e) {} }
  syncToday();
  if (online) { pull(); setInterval(() => { if (!document.hidden) pull(); }, 30000); }
})();
