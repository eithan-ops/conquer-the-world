/* commentator.js — the football-style announcer that runs only on the host's phone.
   Lines are built from fragments (player name · phrase · country) so every piece can be cached as audio
   and the commentary keeps up with the game. If recorded audio is unavailable, it falls back to the browser voice. */
window.Commentator = (function () {
  'use strict';
  const L = {
    he: {
      start: ['המשחק מתחיל! מי יכבוש את העולם?', 'יוצאים לדרך! כל העולם פתוח!', 'שלוש דקות של קרב על כדור הארץ — מתחילים!'],
      claim: ['{n} כובש את {c}!', '{n} לוקח את {c}! איזה מהלך!', 'ו-{c} עוברת ל{n}!', '{n} מרחיב את האימפריה — {c}!'],
      claimBig: ['וואו! {n} כובש את {c}! מדינה ענקית!', '{n} עם מכה גדולה — {c} שלו!'],
      steal: ['דרמה! {n} לוקח את {c} מ{v}!', '{n} גונב את {c}! {v} מאבד שטח!', 'איזו התקפה! {c} עוברת מ{v} ל{n}!'],
      attack: ['{n} תוקף את {c}! {v} בלחץ!', 'התקפה! {n} הולך על {c}!'],
      defend: ['{v} מחזיק את {c}! ההתקפה של {n} נהדפה!', 'לא עובר! {c} נשארת אצל {v}!'],
      streak: ['{n} ברצף! שלוש ברצף!', '{n} בוער! אי אפשר לעצור אותו!', '{n} ברצף מטורף!'],
      lead: ['{n} עולה להובלה!', 'יש לנו מוביל חדש — {n}!'],
      golden: ['דקת הזהב! כל מדינה שווה כפול! עכשיו או לעולם לא!'],
      ten: ['עשר שניות לסיום!'], five: ['חמש… ארבע… שלוש… שתיים… אחת!'],
      end: ['זהו! נגמר! {n} שולט בעולם!', 'הסיום! {n} הוא הכובש הגדול!'],
      close: ['מתח! ההפרש בין {n} ל{v} זעיר!'],
    },
    en: {
      start: ['The game is on! Who will conquer the world?', 'And we are off! The whole planet is up for grabs!'],
      claim: ['{n} takes {c}!', '{n} conquers {c}! What a move!', 'And {c} goes to {n}!', '{n} expands the empire — {c}!'],
      claimBig: ['Wow! {n} takes {c}! A giant!', 'Huge hit by {n} — {c} is theirs!'],
      steal: ['Drama! {n} takes {c} from {v}!', '{n} steals {c}! {v} loses ground!'],
      attack: ['{n} is attacking {c}! Pressure on {v}!', 'Attack! {n} goes for {c}!'],
      defend: ['{v} holds {c}! {n} is pushed back!', 'Not today! {c} stays with {v}!'],
      streak: ['{n} is on a streak!', '{n} is on fire! Unstoppable!'],
      lead: ['{n} takes the lead!', 'New leader — {n}!'],
      golden: ['Golden minute! Every country counts double! Now or never!'],
      ten: ['Ten seconds left!'], five: ['Five… four… three… two… one!'],
      end: ["That's it! {n} rules the world!", 'Full time! {n} is the great conqueror!'],
      close: ['So close! {n} and {v} are neck and neck!'],
    }
  };
  let lang = 'he', enabled = false, queue = [], playing = false, ac = null, onDuck = null, useRecorded = true, lastSpoke = 0;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fill = (s, v) => s.replace(/\{n\}/g, v.n || '').replace(/\{c\}/g, v.c || '').replace(/\{v\}/g, v.v || '');

  function init(opts) { lang = opts.lang || 'he'; onDuck = opts.onDuck || null; useRecorded = opts.recorded !== false; }
  function setEnabled(on) { enabled = !!on; if (!on) { queue = []; try { speechSynthesis.cancel(); } catch (e) { } } }
  function say(kind, vars, priority) {
    if (!enabled) return; const set = L[lang] || L.he; if (!set[kind]) return;
    const text = fill(pick(set[kind]), vars || {});
    // keep the queue short: high-priority lines jump ahead, low-priority ones are dropped when busy
    if (priority === 'high') queue.unshift({ text, kind }); else if (queue.length < 2) queue.push({ text, kind });
    pump();
  }
  async function pump() {
    if (playing || !queue.length) return; playing = true;
    const item = queue.shift();
    try { if (onDuck) onDuck(true); await speak(item.text); } catch (e) { } finally { if (onDuck) onDuck(false); playing = false; lastSpoke = Date.now(); if (queue.length) setTimeout(pump, 150); }
  }
  async function speak(text) {
    if (useRecorded && window.CW) {
      // recorded voice when it is ready in time; otherwise the browser voice says this line and the recording is cached for next time
      const url = await Promise.race([window.CW.tts(text, lang), new Promise(r => setTimeout(() => r(null), 4500))]);
      if (url) { await playUrl(url); return; }
    }
    await speakBrowser(text);
  }
  function playUrl(url) {
    return new Promise((resolve) => {
      const a = new Audio(url); a.volume = 1; let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
      a.onended = fin; a.onerror = fin; a.play().catch(fin); setTimeout(fin, 8000);
    });
  }
  function speakBrowser(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      try {
        const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'he' ? 'he-IL' : 'en-US'; u.rate = 1.12; u.pitch = 1.15; u.volume = 1;
        const voices = speechSynthesis.getVoices(); const v = voices.find(x => x.lang && x.lang.toLowerCase().startsWith(lang === 'he' ? 'he' : 'en')); if (v) u.voice = v;
        u.onend = () => resolve(); u.onerror = () => resolve(); speechSynthesis.speak(u); setTimeout(resolve, 7000);
      } catch (e) { resolve(); }
    });
  }
  // Warm the cache for a lobby: player names and the most common lines are requested before the game starts
  async function prewarm(names, countries) {
    if (!enabled || !useRecorded || !window.CW) return;
    const set = L[lang] || L.he; const jobs = [];
    for (const n of names) for (const tpl of set.claim.slice(0, 2)) for (const c of countries.slice(0, 2)) jobs.push(fill(tpl, { n, c }));
    jobs.push(fill(pick(set.start), {})); jobs.push(set.golden[0]); jobs.push(set.ten[0]); jobs.push(set.five[0]);
    for (const t of jobs.slice(0, 12)) { try { await window.CW.tts(t, lang); } catch (e) { } }
  }
  return { init, setEnabled, say, prewarm, get enabled() { return enabled; } };
})();
