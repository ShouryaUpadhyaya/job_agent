// Human-behaviour layer injected into wellfound-auto-apply.js by build-wellfound-paste.js.
// Timing model: log-normal (heavy right tail) instead of uniform random, since real
// reaction/keystroke/reading times are log-normally distributed and uniform jitter is an easy
// statistical fingerprint. Also: bezier mouse paths with ease-in/out, per-key typing with
// dwell/flight variation + occasional typos, reading pauses, idle wandering, periodic breaks,
// and a persistent daily cap.
const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const logn = (median, sigma, lo, hi) => Math.min(hi, Math.max(lo, median * Math.exp(sigma * randn())));
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => rawSleep(logn(ms, 0.25, ms * 0.5, ms * 2.2)); // every pause in the script now jitters

const HUMAN = {
  DAILY_CAP: __HUMAN_DAILY_CAP__,        // live applications per calendar day (persisted in localStorage)
  GAP_MEDIAN_S: 95, GAP_MIN_S: 40, GAP_MAX_S: 330,   // pause between applications
  BREAK_EVERY: [4, 7], BREAK_MEDIAN_MIN: 6,          // longer coffee break every 4-7 applications
  TYPE_MEDIAN_MS: 140,                               // per-keystroke flight time (~45-50 wpm)
  PASTE_OVER_CHARS: 160,                             // longer text is "pasted", like a saved template
};
let __appCount = 0, __nextBreakAt = Math.round(rnd(...HUMAN.BREAK_EVERY));
const mouse = { x: rnd(200, 800), y: rnd(150, 500) };

const fire = (el, type, init = {}) => el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: mouse.x, clientY: mouse.y, ...init }));

async function humanMoveTo(el) {
  const r = el.getBoundingClientRect();
  // land near the centre (gaussian), never on the exact pixel centre
  const tx = Math.min(r.right - 2, Math.max(r.left + 2, r.left + r.width / 2 + randn() * r.width * 0.15));
  const ty = Math.min(r.bottom - 2, Math.max(r.top + 2, r.top + r.height / 2 + randn() * r.height * 0.15));
  const sx = mouse.x, sy = mouse.y, dist = Math.hypot(tx - sx, ty - sy);
  const c1 = { x: sx + (tx - sx) * 0.3 + randn() * dist * 0.1, y: sy + (ty - sy) * 0.3 + randn() * dist * 0.1 };
  const c2 = { x: sx + (tx - sx) * 0.7 + randn() * dist * 0.08, y: sy + (ty - sy) * 0.7 + randn() * dist * 0.08 };
  const steps = Math.round(Math.min(45, Math.max(12, dist / 18 + rnd(4, 10))));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps, t = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease-in-out (Fitts-like accel/decel)
    const u = 1 - t;
    mouse.x = u * u * u * sx + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * tx;
    mouse.y = u * u * u * sy + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ty;
    fire(document.elementFromPoint(mouse.x, mouse.y) || document.body, 'mousemove');
    await rawSleep(rnd(7, 22));
  }
  fire(el, 'mouseover'); fire(el, 'mouseenter', { bubbles: false });
}

async function humanClick(el) {
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  await rawSleep(logn(700, 0.3, 350, 1600));
  await humanMoveTo(el);
  await rawSleep(logn(220, 0.4, 90, 700));                 // aim/hesitate
  fire(el, 'pointerdown'); fire(el, 'mousedown');
  await rawSleep(logn(80, 0.3, 40, 180));                  // button dwell time
  fire(el, 'pointerup'); fire(el, 'mouseup');
  el.click();
  await rawSleep(300);
  if (el.form && typeof el.form.requestSubmit === 'function') {
    try { el.form.requestSubmit(el); } catch (e) {}
  }
}

async function humanScrollFeed() {
  // wheel-like increments down the feed, occasional small scroll back up
  let steps = 0;
  while (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 50 && steps++ < 70) {
    window.scrollBy({ top: logn(130, 0.3, 50, 320), behavior: 'auto' });
    await rawSleep(logn(55, 0.4, 25, 200));
    if (Math.random() < 0.04) { window.scrollBy(0, -rnd(80, 260)); await rawSleep(logn(600, 0.4, 250, 1500)); }
    if (Math.random() < 0.06) await rawSleep(logn(1200, 0.5, 400, 4000)); // skimming a card
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
}

async function readingPause() { await rawSleep(logn(9000, 0.4, 4000, 26000)); } // reading the JD / panel
async function reviewPause() { await rawSleep(logn(5000, 0.4, 2500, 13000)); }  // re-reading before Send

const NEIGHBOURS = { a: 'sq', s: 'ad', d: 'sf', f: 'dg', g: 'fh', h: 'gj', j: 'hk', k: 'jl', l: 'k', e: 'wr', r: 'et', t: 'ry', o: 'ip', i: 'uo', u: 'yi', n: 'bm', m: 'n' };
function setNative(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
}
function keyEv(el, type, key) { el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })); }
function typeChar(el, ch) {
  keyEv(el, 'keydown', ch); keyEv(el, 'keypress', ch);
  setNative(el, el.value + ch);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  keyEv(el, 'keyup', ch);
}
function backspace(el) {
  keyEv(el, 'keydown', 'Backspace');
  setNative(el, el.value.slice(0, -1));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  keyEv(el, 'keyup', 'Backspace');
}

async function humanFill(el, text) {
  await humanClick(el); el.focus();
  if (text.length > HUMAN.PASTE_OVER_CHARS) {
    // people paste saved templates or AI notes: "compose" pause, paste, notify React
    await rawSleep(logn(2000, 0.4, 1000, 5000));
    keyEv(el, 'keydown', 'v');
    setNative(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertFromPaste' }));
    keyEv(el, 'keyup', 'v');
    await rawSleep(logn(Math.min(text.length * 10, 8000), 0.35, 1200, 10000));
    return;
  }
  setNative(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const fatigue = 1 + Math.min(__appCount, 20) * 0.01; // slows a touch over the session
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (Math.random() < 0.02 && NEIGHBOURS[ch.toLowerCase()]) { // typo → notice → fix
      const wrong = NEIGHBOURS[ch.toLowerCase()][Math.floor(Math.random() * NEIGHBOURS[ch.toLowerCase()].length)];
      typeChar(el, wrong); await rawSleep(logn(HUMAN.TYPE_MEDIAN_MS, 0.4, 50, 500));
      const extra = Math.random() < 0.5 && i + 1 < text.length ? 1 : 0;
      if (extra) { typeChar(el, text[i + 1]); await rawSleep(logn(HUMAN.TYPE_MEDIAN_MS, 0.4, 50, 500)); }
      await rawSleep(logn(450, 0.4, 200, 1200)); // notice the mistake
      for (let b = 0; b < 1 + extra; b++) { backspace(el); await rawSleep(logn(110, 0.3, 60, 250)); }
    }
    typeChar(el, ch);
    let d = logn(HUMAN.TYPE_MEDIAN_MS * fatigue, 0.4, 45, 600);
    if (ch === ' ') d += rnd(40, 160);
    else if (/[.,!?;:]/.test(ch)) d += rnd(150, 500);
    if (Math.random() < 0.01) d += rnd(600, 2000); // thinking
    await rawSleep(d);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function idleWander(ms) { // wait like a person: occasional mouse drift + small scrolls
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await rawSleep(logn(6000, 0.5, 2000, 20000));
    if (Date.now() >= end) break;
    const roll = Math.random();
    if (roll < 0.5) {
      const tx = Math.min(window.innerWidth - 5, Math.max(5, mouse.x + randn() * 160));
      const ty = Math.min(window.innerHeight - 5, Math.max(5, mouse.y + randn() * 120));
      const t = document.body.appendChild(Object.assign(document.createElement('i'), {}));
      t.style.cssText = `position:fixed;left:${tx}px;top:${ty}px;width:1px;height:1px;pointer-events:none`;
      await humanMoveTo(t); t.remove();
    } else if (roll < 0.75) {
      window.scrollBy({ top: rnd(-120, 160), behavior: 'smooth' });
    }
  }
}

async function humanBetweenApps() {
  __appCount++;
  let ms = logn(HUMAN.GAP_MEDIAN_S, 0.45, HUMAN.GAP_MIN_S, HUMAN.GAP_MAX_S) * 1000;
  let why = 'gap';
  if (__appCount >= __nextBreakAt) {
    ms = logn(HUMAN.BREAK_MEDIAN_MIN, 0.4, 3, 15) * 60000;
    __nextBreakAt = __appCount + Math.round(rnd(...HUMAN.BREAK_EVERY));
    why = 'break';
  }
  log(`⏳ next application in ${(ms / 1000).toFixed(0)}s (${why})`);
  await idleWander(ms);
}

const __dayKey = () => 'wfHumanDaily:' + new Date().toDateString();
const dailyCount = () => +(localStorage.getItem(__dayKey()) || 0);
const dailyOk = () => { if (dailyCount() >= HUMAN.DAILY_CAP) { log(`🛑 daily cap ${HUMAN.DAILY_CAP} reached — stopping until tomorrow`); return false; } return true; };
const bumpDaily = () => { if (!CONFIG.DRY_RUN) localStorage.setItem(__dayKey(), dailyCount() + 1); };

// Between applications: dismiss any lingering dialog (e.g. post-submit AI interview modal,
// or a "similar jobs" apply modal) and make sure we are back on the /jobs feed.
async function ensureFeed() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="modal" i], [data-test="DiscoverModal"]')].filter(visible);
  for (const dlg of dialogs) {
    // Only the real post-submit dialog (short, specific wording). A job overlay can mention "AI interview"
    // in its description, and its "Save" button bookmarks the job — never click that, and never in a dry run.
    const postSubmit = dlg.textContent.length < 2500 && /application has been submitted|ai interview is being shared|congrats/i.test(dlg.textContent);
    if (postSubmit) {
      const saveBtn = CONFIG.DRY_RUN ? null : [...dlg.querySelectorAll('button')].find((b) => /^save$/i.test(b.textContent.trim()) && visible(b));
      if (saveBtn) {
        log('↩ closing post-submit AI interview modal with Save');
        await humanClick(saveBtn);
        saveBtn.click();
        await rawSleep(1000);
      }
      const closeBtn = dlg.querySelector('button[aria-label="Close" i], [class*="close" i]') ||
                       [...dlg.querySelectorAll('button')].find((b) => /^✕$|^×$|^close$|^done$/i.test(b.textContent.trim()) && visible(b));
      if (closeBtn) {
        closeBtn.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      }
      await rawSleep(800);
      if (dlg.parentElement && visible(dlg)) dlg.style.display = 'none';
      break;
    } else if (!/jobdescription/i.test(dlg.outerHTML)) {
      const cancelBtn = [...dlg.querySelectorAll('button')].find((b) => /^cancel$/i.test(b.textContent.trim()) && visible(b));
      if (cancelBtn) {
        log('↩ closing leftover dialog with Cancel');
        await humanClick(cancelBtn);
        cancelBtn.click();
        await rawSleep(800);
        break;
      }
    }
  }
  if (!/^\/jobs\/?$/.test(location.pathname)) {
    log(`↩ not on the jobs feed (${location.pathname}) — returning`);
    if (window.next?.router?.push) window.next.router.push('/jobs'); else history.back();
    await rawSleep(5000);
  }
}

// ---------- Gemini ----------
// Under the Playwright runner the key never enters the page: window.__aaGemini is a binding that
// calls Gemini from Node. The pasted Zen bundle only has a key if it was built with --with-key.
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
async function geminiText(prompt) {
  if (typeof window.__aaGemini === 'function') {
    try { return String((await window.__aaGemini(prompt)) || ''); } catch (e) { log(`  ⚠ Gemini (runner) failed: ${e.message}`); return ''; }
  }
  const key = CONFIG.geminiKey;
  if (!key) return '';
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
        if (text) return text;
      } catch (e) { log(`  ⚠ Gemini ${model} failed: ${e.message}`); }
    }
    await rawSleep(1500 * (attempt + 1));
  }
  return '';
}

// job description text from the open job overlay ("About the job" section), for tailoring
function scrapeJobText() {
  const h = [...document.querySelectorAll('h1,h2,h3,h4,div,span')].find((e) => e.children.length === 0 && /^about the job$/i.test(e.textContent.trim()));
  let el = h;
  for (let i = 0; el && i < 4 && (el.innerText || '').length < 600; i++) el = el.parentElement;
  return ((el && el.innerText) || '').replace(/\s+/g, ' ').slice(0, 3000);
}

async function aiCoverLetter(company, title) {
  const jd = scrapeJobText();
  const prompt = `You are my job application writing agent. You have access to my resume. Use it as the source of truth for my skills, experience, projects, education, and achievements.

## Task: Generate Tailored Job Application Answer
Generate a concise, personalised answer to the application question "What interests you about working for this company?" that I can submit directly.

### Inputs
- Company Name: ${company || 'the team'}
- Target Role: ${title}
- Job Listing & Responsibilities: ${jd || '(not available)'}
- Candidate Resume & Profile:
${JSON.stringify(CV, null, 2)}

### Workflow & Rules
1. Extract the company's product domain, engineering challenges, and relevant tech stack from the listing.
2. Ground your response in my actual resume. Identify the 2-3 most relevant skills or projects (e.g. OpenPumTa, Moss X, Cook Off 10.0, Nepbyte). Prioritize production experience, measurable impact, and technical ownership.
3. Explain why the role and company's work specifically interests me, connecting it directly to evidence from my experience. Explain what I can contribute and what I want to learn.
4. Style & Length:
   - Target 90–130 words.
   - First-person language ("I"), natural, warm, and professional English.
   - Avoid generic corporate language, clichés, empty praise, and technical keyword lists.
   - Plain text only: NO markdown, NO asterisks (**), NO bullet points, NO placeholder brackets like [Company].
5. Structure:
   - Salutation: "Dear ${company ? company + ' team' : 'Hiring Manager'},"
   - Body: 2 concise paragraphs.
   - Sign-off: "Best regards,\n${CV.name || 'Candidate'}"
6. Validation: Never invent skills, companies, metrics, experience, or company-specific facts. Every claim must be supported by my CV.

Return ONLY the final application answer ready to submit.`;

  const text = (await geminiText(prompt)).replace(/\*\*|__|^#+\s*/gm, '').trim();
  if (text.length < 120 || /\[[^\]]{2,40}\]/.test(text)) {
    log('  ✍ Gemini letter fallback — using template');
    return coverLetter(company, title);
  }
  log('  ✍ cover letter generated by Gemini');
  return text;
}

async function aiAnswerQuestion(questionText, company, title) {
  const jd = scrapeJobText();
  const prompt = `You are my job application writing agent. You have access to my resume. Use it as the source of truth for my skills, experience, projects, education, and achievements.

## Task: Generate Tailored Application Answer
Generate a concise, direct, personalised answer for this specific application screening question:
"${questionText}"

### Inputs
- Application Question: "${questionText}"
- Company Name: ${company || 'the company'}
- Target Role: ${title || 'Software Engineer Intern'}
- Job Listing & Context: ${jd || '(not available)'}
- Candidate Resume & Profile:
${JSON.stringify(CV, null, 2)}

### Workflow & Rules
1. Answer the exact question directly in the opening sentence.
2. Ground the response strictly in my resume. Highlight production systems, architecture, and measurable outcomes.
3. If I lack an exact requested skill, emphasize relevant adjacent transferable experience honestly without making false claims.
4. Style & Length:
   - Target 50–90 words (or 2-4 direct sentences).
   - Natural, professional, first-person English.
   - Plain text only: NO markdown, NO asterisks, NO bullet points, NO greetings or sign-offs, NO placeholder brackets.
5. Never invent skills, achievements, or metrics.

Return ONLY the final answer.`;

  const text = (await geminiText(prompt)).replace(/\*\*|__|^#+\s*/gm, '').trim();
  if (text && text.length > 20 && !/\[[^\]]{2,40}\]/.test(text)) {
    log(`  ✍ Custom Q&A answered by Gemini: "${questionText.slice(0, 40)}..."`);
    return text;
  }
  return null;
}

// "Congrats! Your application has been submitted" → "Your AI interview is being shared" modal: click Save
async function dismissPostSubmit() {
  const congrats = await waitFor(() => [...document.querySelectorAll('div,section,[role="dialog"]')].find((e) => (/application has been submitted/i.test(e.textContent) || /ai interview is being shared/i.test(e.textContent)) && e.textContent.length < 2500 && e.querySelector('button')), 8000);
  if (!congrats) return;
  const btn = [...congrats.querySelectorAll('button')].find((b) => /^save$/i.test(b.textContent.trim()) && visible(b))
           || [...congrats.querySelectorAll('button')].find((b) => /done|close|continue|ok|got it/i.test(b.textContent.trim()) && visible(b))
           || congrats.querySelector('button[aria-label="Close" i]');
  if (btn) {
    const isSave = /^save$/i.test(btn.textContent.trim());
    log(`  ↩ post-submit dialog: clicking "${btn.textContent.trim() || 'close'}"`);
    await rawSleep(logn(1500, 0.4, 700, 3000));
    await humanClick(btn);
    btn.click();
    await rawSleep(1000);

    if (isSave) {
      const closeBtn = congrats.querySelector('button[aria-label="Close" i], [class*="close" i]')
                    || [...congrats.querySelectorAll('button')].find((b) => /^✕$|^×$|^done$|^close$/i.test(b.textContent.trim()) && visible(b));
      if (closeBtn) {
        await humanClick(closeBtn);
        closeBtn.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      }
      await rawSleep(800);
      if (congrats.parentElement && visible(congrats)) congrats.style.display = 'none';
    }
  }
}
