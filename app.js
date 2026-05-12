// ===== STATE =====
const SPREADSHEET_ID = '1CTL73bUHivzWoQKTb8zdJfxJPMl9ItVtDS30CecdJXo';
const SHEET_NAME = 'Training Log';
const RACE_DATE = new Date('2026-10-11');
const STRAVA_PROXY = 'https://runai-pro-strava.workers.dev/api/strava';
const STRAVA_CLIENT_ID = '204938';

let state = {
  trainingDays: [],
  currentDay: null,
  selectedWeek: null,
  isLoading: false,
  lastSynced: null,
  error: null,
  garminActivities: [],
  garminActivityDates: [],
  rpeLog: [],
  selectedDetailDay: null,
  stravaToken: null,
  stravaAthleteId: null,
  stravaExpiry: null
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  loadRPEFromStorage();
  initStrava();
  renderCountdown();
  renderToday();
  renderWeek();
  renderProgress();
  initSwipeNav();
  if (state.trainingDays.length === 0) {
    checkToken();
  }
  updateOnlineStatus();
});

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ===== STRAVA INIT — runs once on load =====
function initStrava() {
  // Load stored tokens from localStorage
  const stored = localStorage.getItem('strava_tokens');
  if (stored) {
    try {
      const tokens = JSON.parse(stored);
      state.stravaToken = tokens.access_token || null;
      state.stravaAthleteId = tokens.athlete_id || null;
      state.stravaExpiry = tokens.expires_at ? new Date(tokens.expires_at * 1000) : null;
    } catch(e) { /* corrupt storage — clear */ }
  }

  // Parse OAuth redirect hash on page load
  const hash = window.location.hash;
  if (hash.startsWith('#strava=')) {
    const fragment = hash.slice(8); // strip '#strava='
    try {
      const decoded = JSON.parse(atob(fragment.replace(/-/g, '+').replace(/_/g, '/')));
      state.stravaToken = decoded.at || null;
      state.stravaAthleteId = decoded.aid || null;
      state.stravaExpiry = decoded.ex ? new Date(decoded.ex * 1000) : null;

      // Persist tokens
      localStorage.setItem('strava_tokens', JSON.stringify({
        access_token: decoded.at,
        refresh_token: decoded.rt,
        expires_at: decoded.ex,
        athlete_id: decoded.aid,
        athlete_name: decoded.an
      }));

      // Show connected toast
      showToast(`Strava connected — ${decoded.an || 'Athlete'}`);
    } catch(e) {
      showToast('Strava auth failed — try again');
    }
    // Clean the hash from URL without reload
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } else if (hash.startsWith('#strava-error=')) {
    const err = decodeURIComponent(hash.slice(14));
    showToast(`Strava: ${err}`);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

async function ensureStravaToken() {
  if (!state.stravaToken || !state.stravaExpiry) return false;
  // If token expires in <5 min, refresh first
  if (state.stravaExpiry.getTime() - Date.now() < 5 * 60 * 1000) {
    return await refreshStravaToken();
  }
  return true;
}

async function refreshStravaToken() {
  const stored = JSON.parse(localStorage.getItem('strava_tokens') || '{}');
  if (!stored.refresh_token) return false;

  try {
    const resp = await fetch(`${STRAVA_PROXY}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: stored.refresh_token })
    });
    if (!resp.ok) return false;
    const data = await resp.json();

    state.stravaToken = data.access_token;
    state.stravaExpiry = new Date(data.expires_at * 1000);

    localStorage.setItem('strava_tokens', JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete_id: state.stravaAthleteId
    }));
    return true;
  } catch(e) {
    return false;
  }
}

function connectStrava() {
  const redirectUri = encodeURIComponent('https://runai-pro-strava.workers.dev/api/strava/callback');
  const scope = encodeURIComponent('activity:read');
  window.location.href =
    `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;
}

function disconnectStrava() {
  state.stravaToken = null;
  state.stravaAthleteId = null;
  state.stravaExpiry = null;
  localStorage.removeItem('strava_tokens');
  showToast('Strava disconnected');
}

// ===== STORAGE =====
function saveToStorage() {
  localStorage.setItem('runplan_days', JSON.stringify(state.trainingDays));
  localStorage.setItem('runplan_current', JSON.stringify(state.currentDay));
  localStorage.setItem('runplan_lastSynced', state.lastSynced ? state.lastSynced.toISOString() : '');
}

function loadFromStorage() {
  try {
    const days = localStorage.getItem('runplan_days');
    const current = localStorage.getItem('runplan_current');
    const lastSync = localStorage.getItem('runplan_lastSynced');
    if (days) state.trainingDays = JSON.parse(days);
    if (current) state.currentDay = JSON.parse(current);
    if (lastSync) state.lastSynced = new Date(lastSync);
    updateCurrentDay();
  } catch(e) { console.error(e); }
}

function updateCurrentDay() {
  const today = new Date();
  today.setHours(0,0,0,0);
  state.currentDay = state.trainingDays.find(d => {
    const dDate = new Date(d.date);
    dDate.setHours(0,0,0,0);
    return dDate.getTime() === today.getTime();
  }) || null;
}

// ===== ONLINE STATUS =====
function updateOnlineStatus() {
  let banner = document.querySelector('.offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'offline-banner hidden';
    document.body.prepend(banner);
  }
  banner.textContent = navigator.onLine ? '✅ Back online' : '⚠️ Offline — showing cached data';
  banner.classList.toggle('hidden', navigator.onLine);
  if (navigator.onLine) setTimeout(() => banner.remove(), 2000);
}

// ===== TOKEN =====
function checkToken() {
  const token = localStorage.getItem('gcp_token');
  if (!token) {
    document.getElementById('sync-modal').style.display = 'flex';
  } else {
    syncFromSheet();
  }
}

function saveToken() {
  const input = document.getElementById('token-input').value.trim();
  if (!input) return;
  localStorage.setItem('gcp_token', input);
  closeModal();
  syncFromSheet();
}

function closeModal() {
  document.getElementById('sync-modal').style.display = 'none';
}

// ===== SHEET SYNC =====
async function syncFromSheet() {
  const token = localStorage.getItem('gcp_token');
  if (!token) { checkToken(); return; }

  setLoading(true);
  try {
    const range = encodeURIComponent(`${SHEET_NAME}!A1:K200`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (resp.status === 401) {
      localStorage.removeItem('gcp_token');
      checkToken();
      return;
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rows = data.values;
    if (!rows || rows.length < 2) throw new Error('No data found');

    const [header, ...rest] = rows;
    state.trainingDays = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}/;

    for (const row of rest) {
      if (row.length < 10) continue;
      const [dateStr, week, day, dateStr2, phase, mpw, workout, type, plannedDist, components, description] = row;
      if (!dateRe.test(dateStr)) continue;

      const parsedComponents = (components || '')
        .split(' ')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      state.trainingDays.push({
        date: dateStr,
        week: parseInt(week) || 0,
        day,
        dateString: dateStr2,
        phase: phase || '',
        mpw: parseInt(mpw) || 0,
        workout: workout || '',
        type: type || 'Rest',
        plannedDist: plannedDist || '-',
        components: parsedComponents,
        description: description || ''
      });
    }

    state.lastSynced = new Date();
    updateCurrentDay();
    saveToStorage();
    renderToday();
    renderWeek();
    renderProgress();
  } catch(e) {
    console.error('Sync error:', e);
    showToast('Sync failed. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
}

function setLoading(val) {
  state.isLoading = val;
  const loading = document.getElementById('today-loading');
  const content = document.getElementById('today-content');
  const empty = document.getElementById('today-empty');

  if (loading) {
    if (val) {
      // Show skeleton loading state
      loading.style.display = 'flex';
      loading.innerHTML = `
        <div class="skeleton-card">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text"></div>
        </div>
        <div class="skeleton-card">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text"></div>
        </div>
      `;
      if (content) content.style.display = 'none';
      if (empty) empty.style.display = 'none';
    } else {
      loading.style.display = 'none';
    }
  }
}

// ===== TAB SWITCHING =====
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'summary') renderSummary();
  if (tab === 'feedback') renderFeedback();
  if (tab === 'plans') renderPlans();
}
// ===== TODAY TAB =====
function renderToday() {
  const day = state.currentDay;
  const todayDate = document.getElementById('today-date');
  const todayPhase = document.getElementById('today-phase');
  const todayWeek = document.getElementById('today-week');
  const todayMpw = document.getElementById('today-mpw');
  const loading = document.getElementById('today-loading');
  const empty = document.getElementById('today-empty');
  const content = document.getElementById('today-content');

  if (!day) {
    loading.style.display = 'none';
    empty.style.display = 'flex';
    content.style.display = 'none';

    const title = document.getElementById('empty-title');
    const subtitle = document.getElementById('empty-subtitle');
    if (state.trainingDays.length === 0) {
      title.textContent = 'No workout for today';
      subtitle.textContent = 'Sync from Google Sheet to load your plan';
    } else {
      const firstDay = state.trainingDays[0];
      const today = new Date();
      today.setHours(0,0,0,0);
      const firstDate = new Date(firstDay.date);
      if (firstDate > today) {
        const startDate = new Date(firstDay.date);
        const options = { month: 'short', day: 'numeric' };
        title.textContent = 'Pre-plan rest day';
        subtitle.textContent = `Your training starts ${startDate.toLocaleDateString('en-US', options)}`;
      } else {
        title.textContent = 'No workout for today';
        subtitle.textContent = 'Rest day — check the Week tab';
      }
    }
    return;
  }

  empty.style.display = 'none';
  content.style.display = 'block';

  todayDate.textContent = day.dateString;
  todayPhase.textContent = day.phase;
  todayPhase.style.display = day.phase ? 'block' : 'none';
  todayWeek.textContent = `Week ${day.week}`;
  todayMpw.innerHTML = `<span style="color:var(--orange);font-weight:700">${day.mpw} mpw</span>`;

  renderWorkoutCards(day);
  renderTodayGuide(day);
  renderGarminButton(day);
}

// ===== TODAY WORKOUT CARDS (always expanded) =====
function renderWorkoutCards(day) {
  const container = document.getElementById('workout-cards');
  container.innerHTML = '';

  const sections = buildSections(day);

  sections.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'today-card';

    const iconBg = {
      running: '#dbeafe', itbs: '#ffedd5', strength: '#f3e8ff',
      form: '#dcfce7', hills: '#fee2e2', rest: '#f3f4f6'
    };
    const iconEmoji = {
      running: '🏃', itbs: '🦵', strength: '💪',
      form: '⚡', hills: '⛰️', rest: '🛌'
    };

    const cat = sec.category || 'running';
    const bgColor = iconBg[cat] || '#dbeafe';
    const emoji = iconEmoji[cat] || '🏃';

    card.innerHTML = `
      <div class="today-card-header" style="background:${bgColor}">
        <div class="today-card-icon">${emoji}</div>
        <div class="today-card-meta">
          <div class="today-card-title">${sec.title}</div>
          ${sec.distance ? `<div class="today-card-dist">${sec.distance} mi</div>` : ''}
        </div>
      </div>
      <div class="today-card-body">
        ${sec.description ? `<div class="today-workout-text">${sec.description}</div>` : ''}
        ${sec.why ? `<div class="today-why">💡 <strong>Purpose:</strong> ${sec.why}</div>` : ''}
        ${sec.exercises.length > 0 ? `
          <div class="today-exercises">
            ${sec.exercises.map(ex => `
              <div class="today-exercise">
                <div class="today-ex-left">
                  <div class="today-ex-name">${ex.name}</div>
                  <div class="today-ex-sets">${ex.sets} × ${ex.reps}</div>
                  ${ex.notes ? `<div class="today-ex-notes">${ex.notes}</div>` : ''}
                </div>
                ${ex.videoUrl ? `<a href="${ex.videoUrl}" target="_blank" rel="noopener" class="today-ex-video">▶ Demo</a>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

function buildSections(day) {
  const sections = [];

  // Running workout
  if (day.type !== 'Rest' && day.type !== 'Bike') {
    sections.push({
      category: 'running',
      title: workoutTypeTitle(day.type),
      distance: day.plannedDist && day.plannedDist !== '-' ? day.plannedDist : null,
      description: day.workout,
      why: getWhyChipContent(day),
      components: day.components.filter(c => ['E','S','L','T','V','R','H'].includes(c)),
      exercises: []
    });
  }

  // ITBS Activation
  if (day.components.includes('ITBS')) {
    sections.push({
      category: 'itbs',
      title: 'ITB Activation',
      distance: null,
      description: 'Pre-run activation routine for IT band + lateral chain',
      why: 'Pre-run prep — activate glutes and IT band to prevent knee valgus during running',
      components: ['ITBS'],
      exercises: EXERCISES.itbsActivation.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        notes: ex.notes,
        videoUrl: ex.videoUrl
      }))
    });
  }

  // Form Drills (Cadence)
  if (day.components.includes('C')) {
    sections.push({
      category: 'form',
      title: 'Form Drills (Cadence)',
      distance: null,
      description: 'Post-run cadence work: 3×3 min @ 90+ spm with quick turnover and light landing',
      why: 'Cadence target is 90+ spm — your current avg is 81. Drill builds neuromuscular efficiency.',
      components: ['C'],
      exercises: EXERCISES.formDrills.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        notes: ex.notes,
        videoUrl: ex.videoUrl
      }))
    });
  }

  // Strength
  if (day.components.includes('ST')) {
    sections.push({
      category: 'strength',
      title: 'Strength Circuit',
      distance: null,
      description: 'Post-run strength (Mon + Wed) — master form before adding load',
      why: 'Resilience work — glutes, hams, and core prevent the ITBS pattern. Touch the exercises for demos.',
      components: ['ST'],
      exercises: EXERCISES.strengthCircuit.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        notes: ex.notes,
        videoUrl: ex.videoUrl
      }))
    });
  }

  // Hill Sprints
  if (day.components.includes('H')) {
    sections.push({
      category: 'hills',
      title: 'Hill Sprints',
      distance: null,
      description: '6–8×12 sec all-out, find moderate hill 6–10% grade. Post-long-run neuromuscular work.',
      why: 'Neuromuscular power on tired legs — simulates finishing kick strength for mile 24–26.',
      components: ['H'],
      exercises: []
    });
  }

  return sections;
}

function workoutTypeTitle(type) {
  const map = {
    'Rest': 'Rest Day', 'Easy': 'Easy Run', 'Strides': 'Easy + Strides',
    'Tempo': 'Tempo Run', 'VO2max': 'VO2max Intervals', 'Yasso': 'Yasso 800s',
    'Intervals': 'Intervals', 'Long': 'Long Run', 'Race Sim': 'Race Simulation',
    'Progressive': 'Progressive Long Run', 'Cruise': 'Cruise Intervals', 'Strength': 'Strength'
  };
  return map[type] || type;
}

// ===== TODAY WORKOUT GUIDE (Purpose + Instructions + Goal) =====
function renderTodayGuide(day) {
  // Remove existing guide if any
  const existing = document.getElementById('today-guide');
  if (existing) existing.remove();

  if (day.type === 'Rest' || day.type === 'Bike') return;

  const guide = document.createElement('div');
  guide.id = 'today-guide';

  const info = getWorkoutGuideInfo(day);

  guide.innerHTML = `
    <div class="guide-section">
      <div class="guide-header">
        <span class="guide-title">📋 Workout Guide</span>
      </div>
      <div class="guide-grid">
        <div class="guide-block">
          <div class="guide-block-label">🎯 Goal</div>
          <div class="guide-block-content">${info.goal}</div>
        </div>
        <div class="guide-block">
          <div class="guide-block-label">💡 Purpose</div>
          <div class="guide-block-content">${info.purpose}</div>
        </div>
        <div class="guide-block">
          <div class="guide-block-label">⚙️ How to Execute</div>
          <div class="guide-block-content">${info.instructions}</div>
        </div>
        <div class="guide-block">
          <div class="guide-block-label">⚠️ Key Cues</div>
          <div class="guide-block-content">${info.cues}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('workout-cards').appendChild(guide);
}

function getWorkoutGuideInfo(day) {
  const type = day.type;
  const phase = day.phase || '';
  const wk = day.week;

  const guides = {
    'Easy': {
      goal: `Build aerobic base. Accumulate time on feet at an easy, conversational pace.`,
      purpose: `Aerobic foundation work. The majority of your weekly mileage should come from easy runs like this. Builds capillary density, mitochondrial mass, and fat-oxidation capacity without adding stress.`,
      instructions: `Run at a pace where you can hold a full conversation. If you're breathing hard, slow down. HR should stay below 152 bpm (Z2 ceiling). Ignore pace — hold HR.`,
      cues: `Relaxed shoulders. Short stride, high cadence. Check in every mile: am I breathing too hard? Slow down if yes.`
    },
    'Long': {
      goal: `Build sustained aerobic endurance. Time on feet is the primary stimulus.`,
      purpose: `The cornerstone workout of marathon training. Extended easy running develops fat-oxidation, mental resilience, and simulates the sustained nature of race day. For runs 16+, also teaches fueling and hydration strategy.`,
      instructions: `Run the first half very easy — conversational pace. The second half can build slightly but should remain aerobic. HR stays below 152 bpm throughout. For 16+ miles: take water every 20 min and a gel every 45 min.`,
      cues: `Start slow. If mile 20 feels hard, you started too fast. Negative split is the goal. Practice race-day nutrition here.`
    },
    'Tempo': {
      goal: `Develop lactate threshold — the pace you can hold for ~1 hour.`,
      purpose: `LTHR training improves your body's ability to clear lactate, meaning you can run faster before accumulating fatigue. This is one of the most specific predictors of marathon performance.`,
      instructions: `Ignore pace. Hold HR at 171 bpm (LTHR) throughout the main set. The key phrase is "ignore pace, hold HR." If HR drifts above 171, back off the pace. Warmup and cooldown are easy.`,
      cues: `Feel the effort rise — that's lactate accumulating. Hold steady. If you can talk in short phrases but not full sentences, you're in Z4.`
    },
    'VO2max': {
      goal: `Sharpen VO2max — maximum oxygen uptake. Improve running economy and top-end speed.`,
      purpose: `Interval training at VO2max develops the engines that drive your fast-twitch fibers. Even for marathoners, VO2max matters because race-pace effort sits at ~85% VO2max. Sharper ceiling = faster marathon.`,
      instructions: `Run each interval at a hard but controlled effort — HR should reach 161-171 bpm. You should be breathing hard but not gasping. Focus on form: quick feet, high knees, relaxed arms. Recover with easy jogging.`,
      cues: `Focus on quick turnover during each rep. The recovery jog is part of the workout — keep it easy, don't stop moving.`
    },
    'Yasso': {
      goal: `Build marathon-specific lactate tolerance. Yasso 800s simulate race-pace buffering capacity.`,
      purpose: `Bart Yasso's protocol uses 800m reps at 5K effort to build lactate clearance — the same system you'll rely on at mile 20+ of the marathon. The equal rest structure trains your body to recover under fatigue.`,
      instructions: `Each rep: 800m at 5K effort (you should be working hard, HR 165-171). Stand or walk during the 3-minute recovery — that's part of the stimulus. Don't jog the recovery. After the last rep, do an easy cooldown.`,
      cues: `Rep times should be within 10-15 seconds of each other. If you fade, you started too fast. Mental cue: "smooth and even."`
    },
    'Intervals': {
      goal: `Develop VO2max and running economy through repeated fast efforts.`,
      purpose: `Intervals at or near VO2max improve how efficiently your body uses oxygen and develop fast-twitch muscle fiber efficiency. Even small VO2max improvements significantly impact marathon pace potential.`,
      instructions: `Each interval should be at a hard effort where HR reaches 161-171 bpm. Jog the recovery interval — don't stop. Keep form clean through each rep: quick cadence, relaxed arms. Warmup and cooldown are essential.`,
      cues: `Drive arms as well as legs. The last rep should feel almost as controlled as the first. If form breaks down, the session is done.`
    },
    'Strides': {
      goal: `Develop leg speed and neuromuscular efficiency. Increase cadence naturally.`,
      purpose: `Strides are short accelerations to near-sprint speed that ingrain efficient running mechanics without adding fatigue. They improve running economy — how much energy it takes to maintain a given pace.`,
      instructions: `After an easy run or as a standalone, run 4×20 seconds at approximately 5K effort. Walk back to recover (90 sec). Focus on fast feet and quick turnover. The effort is short enough that it shouldn't cause fatigue.`,
      cues: `Think "fast feet, fast hands." Keep the stride short and bouncy. Don't stride all-out — leave ~5% in the tank.`
    },
    'Race Sim': {
      goal: `Rehearse race-pace effort, nutrition strategy, and mental execution on fatigued legs.`,
      purpose: `The race simulation is your most important workout — it reveals exactly what marathon pace is sustainable for you and trains your body and mind to handle race-pace effort when fatigued. The tired legs simulate the last 10 miles of the marathon.`,
      instructions: `Warmup well (2+ miles easy). Run the first 8-10 miles easy (Z2). Then shift to marathon pace (8:30-8:40/mi). Hold that pace through mile 18+. The final miles should feel controlled — this is rehearsal, not a race. Practice taking a gel every 30 minutes starting at mile 10.`,
      cues: `Start conservative. The first 10 miles are reconnaissance. If you can finish strong at mile 22, your pace is right. If you blow up, you started too fast. Mental: "Patience wins marathons."`
    },
    'T-Pace': {
      goal: `Develop lactate clearance and threshold sustain — cruise intervals build specific marathon fitness.`,
      purpose: `Cruise intervals at LTHR train your body to clear lactate at a sustained effort, directly improving your threshold pace — the pace you can hold for a marathon. They are more marathon-specific than continuous tempo runs.`,
      instructions: `Warmup 1.5 miles easy. Then run 3 blocks of 6 minutes at LTHR (171 bpm), recovering 2 minutes easy between each block. The recovery is part of the stimulus — keep moving at an easy jog. Cooldown 1.5 miles easy.`,
      cues: `Each block should feel progressively harder. By block 3, you're working — that's the point. If block 1 feels impossible, you're running too fast.`
    },
    'Cruise': {
      goal: `Threshold乳酸清除训练 — cruise intervals improve sustained threshold ability.`,
      purpose: `Like T-pace work, cruise intervals develop the ability to hold threshold effort by repeatedly stressing the lactate system. The multiple blocks with short recovery are more specific to marathon pacing than a single continuous block.`,
      instructions: `Warmup 1.5 miles easy. Run 2×8 minutes at LTHR (171 bpm), taking 4 minutes easy jogging between blocks. HR should sit at 161-171 throughout the work blocks. Cooldown 1.5 miles easy.`,
      cues: `Feel the lactate "burn" — that's the stimulus. Back off if HR exceeds 171. The 4-minute recovery should feel short.`
    },
    'M-Pace': {
      goal: `Practice marathon race pace. Build familiarity and confidence at goal race effort.`,
      purpose: `Marathon-pace work builds specific endurance at the effort you'll sustain on race day. It ingrains the pace into your neuromuscular system and teaches your body to hold race-pace when fatigued.`,
      instructions: `Warmup 1.5 miles easy. Run the prescribed miles at 8:30-8:40/mi — this is marathon effort. HR will naturally rise into Z4. If HR exceeds 174, back off the pace slightly. Cooldown 1.5 miles easy.`,
      cues: `This should feel comfortably hard. If you can't hold a conversation at all, you're going too hard. The goal is familiarity, not a time trial.`
    }
  };

  const defaultGuide = {
    goal: `Complete today's workout as prescribed.`,
    purpose: `Consistency with structured training builds fitness over time. Trust the process and execute each workout as written.`,
    instructions: `Follow the workout segments as described in the card above. Warmup thoroughly. Stay within HR targets. Cooldown to flush lactate.`,
    cues: `Focus on form throughout. If anything feels wrong — pain, excessive fatigue — stop and reassess.`
  };

  const guide = guides[type] || defaultGuide;

  // Add phase-specific nuance
  if (phase.includes('Phase 1')) {
    guide.purpose += ` Phase 1 is about building the aerobic foundation — all quality should feel easy. This is not yet about pace; it's about time on feet and movement quality.`;
  } else if (phase.includes('Phase 2')) {
    guide.purpose += ` Phase 2 introduces harder quality work — this is where fitness actually improves. Allow yourself to feel uncomfortable during the hard segments.`;
  } else if (phase.includes('Phase 3') || phase.includes('Phase 4')) {
    guide.purpose += ` You're in the peak/recovery phase — protect the gains you've built. The stimulus matters, but recovery is equally important.`;
  }

  return guide;
}

function renderGarminButton(day) {
  const btn = document.getElementById('btn-garmin');
  if (!day) {
    // No plan loaded yet — show button that opens modal to connect Strava
    btn.style.display = 'flex';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.onclick = openGarminModal;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Strava Connect';
    return;
  }
  if (day.type === 'Rest' || day.type === 'Bike') {
    btn.style.display = 'flex';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.onclick = null;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Rest Day';
  } else {
    btn.style.display = 'flex';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.onclick = openGarminModal;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Garmin / Strava';
  }
}

// ===== WEEK TAB =====
function renderWeek() {
  const selector = document.getElementById('week-selector');
  const content = document.getElementById('week-content');

  if (state.trainingDays.length === 0) {
    selector.innerHTML = '';
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No plan data. Sync from Google Sheet.</p></div>';
    return;
  }

  const weeks = [...new Set(state.trainingDays.map(d => d.week))].sort((a,b) => a-b);
  const currentWeek = state.currentDay ? state.currentDay.week : weeks[0];
  const selected = state.selectedWeek || currentWeek;

  selector.innerHTML = weeks.map(w =>
    `<button class="week-pill${w === selected ? ' active' : ''}" onclick="selectWeek(${w})">Week ${w}</button>`
  ).join('');

  renderWeekDays(selected);
}

function selectWeek(week) {
  state.selectedWeek = week;
  renderWeek();
}

function renderWeekDays(week) {
  const container = document.getElementById('week-content');
  const days = state.trainingDays.filter(d => d.week === week).sort((a,b) => {
    const dayOrder = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
    return (dayOrder[a.day] ?? 7) - (dayOrder[b.day] ?? 7);
  });

  container.innerHTML = days.map(day => {
    const tags = day.components.slice(0,4).map(c => `<span class="tag tag-${c}">${c}</span>`).join('');
    const isToday = state.currentDay && state.currentDay.date === day.date;
    const typeClass = `type-${day.type.split(' ')[0]}`;
    const sections = buildSections(day);

    return `
      <div class="week-day-row">
        <div class="week-day-header" onclick="toggleWeekRow(this)">
          <div class="week-day-date">
            <div class="week-day-name" style="color:${isToday ? 'var(--orange)' : 'var(--text)'}">${day.day}</div>
            <div class="week-day-num">${day.dateString}</div>
          </div>
          <!-- 3. Garmin overlay badge -->
          ${day.hasGarmin ? '<span class="garmin-badge" title="Garmin activity synced">✓</span>' : ''}
          <span class="type-pill ${typeClass}">${day.type}</span>
          <div class="week-day-tags">${tags}</div>
          ${day.plannedDist && day.plannedDist !== '-' ? `<span class="week-day-dist">${day.plannedDist}</span>` : '<span class="week-day-dist">—</span>'}
          <span class="week-day-chevron">▼</span>
        </div>
        <div class="week-day-body" style="display:none">
          <p style="margin-bottom:8px">${day.workout}</p>
          ${sections.map(sec => `
            <div style="margin-bottom:8px">
              <strong style="font-size:12px">${sec.title}</strong>
              ${sec.exercises.length > 0 ? `<ul style="margin:4px 0 4px 16px;font-size:12px;color:var(--text-secondary)">${sec.exercises.map(ex => `<li style="display:flex;justify-content:space-between;align-items:center">${ex.name} — ${ex.sets}×${ex.reps}${ex.videoUrl ? `<a href="${ex.videoUrl}" target="_blank" rel="noopener" style="font-size:11px;color:var(--orange);text-decoration:none;margin-left:8px">▶ Demo</a>` : ''}</li>`).join('')}</ul>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function toggleWeekRow(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector('.week-day-chevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chevron.classList.toggle('open', !isOpen);
}

// ===== PROGRESS TAB =====
function renderProgress() {
  if (state.trainingDays.length === 0) {
    document.getElementById('progress-content').innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>No data yet. Sync to load your plan.</p></div>';
    return;
  }

  const currentWeek = state.currentDay ? state.currentDay.week : 1;
  const totalWeeks = Math.max(...state.trainingDays.map(d => d.week));
  const phase = state.currentDay ? state.currentDay.phase : '';

  // Mileage chart
  renderMileageChart();

  // Summary cards
  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card">
      <div class="summary-card-label">Current Week</div>
      <div class="summary-card-val">${currentWeek}</div>
      <div class="summary-card-sub">of ${totalWeeks}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">This Week</div>
      <div class="summary-card-val">${state.currentDay ? state.currentDay.mpw : '—'}</div>
      <div class="summary-card-sub">mpw target</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Phase</div>
      <div class="summary-card-val" style="font-size:16px">${phase.split('—')[0].trim() || '—'}</div>
      <div class="summary-card-sub">${phase.split('—')[1] || ''}</div>
    </div>
  `;

  // Phase list
  const phases = [
    { name: 'Phase 1 — Base Building', color: '#22c55e', contains: 'Phase 1' },
    { name: 'Phase 2 — Norwegian Singles', color: '#3b82f6', contains: 'Phase 2' },
    { name: 'Phase 3 — Peak Volume', color: '#F97316', contains: 'Phase 3' },
    { name: 'Phase 4 — Recovery', color: '#a855f7', contains: 'Phase 4' },
    { name: 'Phase 5 — Pre-Race', color: '#ef4444', contains: 'Phase 5' }
  ];

  const currentPhaseName = phase.split('—')[0].trim() + '—' || '';

  document.getElementById('phase-list').innerHTML = phases.map(p => {
    const isCurrent = phase.includes(p.contains);
    const progress = getPhaseProgress(p.contains);
    return `
      <div class="phase-item${isCurrent ? ' current' : ''}">
        <div class="phase-item-header">
          <span class="phase-item-name">${p.name}</span>
          ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
        </div>
        <div class="phase-progress-bar phase-bar-bg">
          <div class="phase-bar-fill" style="width:${progress}%;background:${p.color}"></div>
        </div>
      </div>
    `;
  }).join('');

  // Stats
  document.getElementById('stats-rows').innerHTML = `
    <div class="stats-row"><span class="stats-row-label">Current Phase</span><span class="stats-row-val">${phase || '—'}</span></div>
    <div class="stats-row"><span class="stats-row-label">Weekly Mileage</span><span class="stats-row-val">${state.currentDay ? state.currentDay.mpw + ' mpw' : '—'}</span></div>
    <div class="stats-row"><span class="stats-row-label">HR Zone 2 Ceiling</span><span class="stats-row-val">152 bpm</span></div>
    <div class="stats-row"><span class="stats-row-label">LTHR (lab-tested)</span><span class="stats-row-val">171 bpm</span></div>
    <div class="stats-row"><span class="stats-row-label">Cadence Target</span><span class="stats-row-val">90+ spm</span></div>
    ${state.lastSynced ? `<div class="stats-row"><span class="stats-row-label">Last Synced</span><span class="stats-row-val">${formatTime(state.lastSynced)}</span></div>` : ''}
  `;
}

function getPhaseProgress(phaseKey) {
  if (!state.currentDay) return 0;
  const phaseDays = state.trainingDays.filter(d => d.phase.includes(phaseKey));
  if (!phaseDays.length) return 0;
  const currentIdx = phaseDays.findIndex(d => d.date === state.currentDay.date);
  if (currentIdx < 0) {
    const phaseOrder = ['Phase 1','Phase 2','Phase 3','Phase 4','Phase 5'];
    const curPhaseIdx = phaseOrder.findIndex(p => state.currentDay.phase.includes(p));
    const thisPhaseIdx = phaseOrder.findIndex(p => phaseKey.includes(p));
    if (thisPhaseIdx < curPhaseIdx) return 100;
    return 0;
  }
  return Math.round((currentIdx + 1) / phaseDays.length * 100);
}

// ===== GARMIN .FIT FILE DOWNLOAD =====
async function sendToGarmin() {
  const day = state.currentDay;
  if (!day || day.type === 'Rest' || day.type === 'Bike') return;

  const btn = document.getElementById('btn-garmin');
  const status = document.getElementById('garmin-status');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  status.className = 'garmin-status uploading';
  status.textContent = 'Creating workout file...';

  try {
    // Generate .fit file client-side
    const fitBytes = generateFitFile(day);

    // Download it
    const blob = new Blob([fitBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RunPlan_${day.date}_${day.type.replace(/\s+/g, '_')}.fit`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    status.className = 'garmin-status success';
    status.textContent = '✅ .fit file downloaded! Import to Garmin Connect.';
    btn.textContent = 'Downloaded!';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Send to Garmin';
      status.textContent = '';
    }, 4000);
  } catch(e) {
    status.className = 'garmin-status error';
    status.textContent = '❌ Failed: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Send to Garmin';
  }
}

function generateFitFile(day) {
  // Build a minimal Garmin .fit file for a running workout
  // .fit format: binary with defined message types
  const sport = 'RUNNING';
  const typeMap = { 'Easy': 1, 'Tempo': 2, 'Long': 4, 'VO2max': 3, 'Intervals': 3, 'Yasso': 3, 'Strides': 5, 'Rest': 0 };
  const workoutType = typeMap[day.type] || 1;

  const distanceMeters = (parseFloat(day.plannedDist) || 0) * 1609.34;
  const durationSeconds = estimateDuration(day);

  // Simple FIT file structure (minimal viable format)
  const fit = [];

  // File header (14 bytes)
  const headerSize = 14;
  const protocolVersion = 16; // 2.0
  const profileVersion = 2132; // 21.32
  const dataSize = 0; // computed below

  // We'll build the file as an array and compute CRC at the end
  const msg = [];

  // File ID message (type=0, local=0)
  msg.push(0, 0, 0, 0); // reserved
  msg.push(0); // type (file_id)
  msg.push(0); // local message type
  // file_id fields:
  // serial_number (4 bytes)
  const serial = [0x12, 0x34, 0x56, 0x78]; // fake serial
  msg.push(...serial);
  // timestamp (4 bytes) - seconds since Jan 1 1990
  const nowSec = Math.floor(Date.now() / 1000) + 631065600; // FIT epoch offset
  msg.push(...u32ToBytes(nowSec));
  // manufacturer (2 bytes)
  msg.push(0xFF, 0xFF); // development
  // product (2 bytes)
  msg.push(0x00, 0x01);
  // file_number (4 bytes)
  msg.push(0x00, 0x00, 0x00, 0x01);
  // file_type (1 byte)
  msg.push(0x06); // workout

  // Workout message (type=4, local=1)
  const wktName = `RunPlan ${day.type}`;
  msg.push(0, 1); // reserved + type
  // sport (1 byte): 1=running
  msg.push(0x01);
  // sub_sport (1 byte)
  msg.push(0x00);
  // name (null-terminated string)
  for (let i = 0; i < wktName.length; i++) {
    msg.push(wktName.charCodeAt(i));
  }
  msg.push(0); // null terminator
  // cap nulls to even size
  while (msg.length % 4 !== 0) msg.push(0);

  // Workout step message (type=5, local=2)
  const stepName = day.workout.substring(0, 50);
  msg.push(0, 2); // reserved + type
  // step_name (null-terminated)
  for (let i = 0; i < stepName.length; i++) {
    msg.push(stepName.charCodeAt(i));
  }
  msg.push(0);
  while (msg.length % 4 !== 0) msg.push(0);

  // Intensity message (inline in step)
  // workout_step message:
  // message_index (2 bytes)
  msg.push(0x00, 0x00);
  // message_type (1 byte): 4=workout_step
  msg.push(0x04);
  // duration_type (1 byte): 0=distance, 1=time, 2=hr, etc.
  msg.push(0x01); // time-based
  // duration_value (4 bytes): seconds
  msg.push(...u32ToBytes(durationSeconds || 3600));
  // target_type (1 byte): 0=global, 2=power, 3=heart rate
  msg.push(0x00);
  // target_value (4 bytes)
  msg.push(0xFF, 0xFF, 0xFF, 0xFF); // none
  // repeat_count (2 bytes)
  msg.push(0x00, 0x01); // 1 step
  // end of step messages

  // Now compute everything
  const headerAndData = msg;
  const totalSize = headerSize + headerAndData.length + 2; // +2 for CRC

  // File header
  const header = new Uint8Array(headerSize);
  header[0] = headerSize;
  header[1] = protocolVersion;
  header[2] = profileVersion & 0xFF;
  header[3] = (profileVersion >> 8) & 0xFF;
  // data size (4 bytes little-endian)
  const ds = headerAndData.length + 2;
  header[4] = ds & 0xFF;
  header[5] = (ds >> 8) & 0xFF;
  header[6] = (ds >> 16) & 0xFF;
  header[7] = (ds >> 24) & 0xFF;
  // ".FIT" magic
  header[8] = 0x2E; header[9] = 0x46; header[10] = 0x49; header[11] = 0x54;
  // header CRC (2 bytes, optional, 0 for now)
  header[12] = 0x00; header[13] = 0x00;

  // Combine header + data
  const dataBytes = new Uint8Array(headerAndData);
  const crc = computeFitCrc(dataBytes);
  const crcBytes = new Uint8Array([crc & 0xFF, (crc >> 8) & 0xFF]);

  const result = new Uint8Array(header.length + dataBytes.length + crcBytes.length);
  result.set(header, 0);
  result.set(dataBytes, header.length);
  result.set(crcBytes, header.length + dataBytes.length);

  return result;
}

function u32ToBytes(val) {
  return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF];
}

function computeFitCrc(data) {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
  }
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function estimateDuration(day) {
  const miles = parseFloat(day.plannedDist) || 0;
  if (!miles) return 3600;
  let pace;
  if (['VO2max', 'Yasso', 'Intervals'].includes(day.type)) pace = 7.5 * 60;
  else if (['Tempo', 'Cruise'].includes(day.type)) pace = 8 * 60;
  else pace = 9 * 60;
  return Math.round(miles * pace);
}

// ===== GARMIN SYNC MODAL (now Strava-backed) =====
function openGarminModal() {
  document.getElementById('garmin-modal').style.display = 'block';
  syncActivities();
}

function closeGarminModal() {
  document.getElementById('garmin-modal').style.display = 'none';
}

// Main sync function — tries Strava, falls back to manual
async function syncActivities() {
  const container = document.getElementById('garmin-activities');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Syncing activities...</p></div>';

  // If no Strava token, show connect prompt
  if (!state.stravaToken) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔗</div>
        <p>Connect Strava to sync your activities automatically</p>
        <button class="btn btn-strava" onclick="connectStrava(); closeGarminModal();" style="margin-top:12px">
          🔗 Connect Strava
        </button>
        <div style="margin-top:16px">
          <button class="btn btn-secondary btn-sm" onclick="openFeedbackForm()">Log Manually</button>
        </div>
      </div>
    `;
    return;
  }

  // Ensure fresh token
  const hasToken = await ensureStravaToken();
  if (!hasToken) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Strava session expired. Please reconnect.</p>
        <button class="btn btn-strava" onclick="connectStrava(); closeGarminModal();">Reconnect Strava</button>
      </div>
    `;
    return;
  }

  try {
    const after = new Date();
    after.setDate(after.getDate() - 14); // look back 2 weeks
    const afterSec = Math.floor(after.getTime() / 1000);

    const resp = await fetch(`${STRAVA_PROXY}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: state.stravaToken, after: afterSec, per_page: 30 }),
      signal: AbortSignal.timeout(8000)
    });

    if (resp.status === 401 || resp.status === 403) {
      // Token no longer valid — refresh
      const refreshed = await refreshStravaToken();
      if (!refreshed) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <p>Strava session expired. Please reconnect.</p>
            <button class="btn btn-strava" onclick="connectStrava(); closeGarminModal();">Reconnect Strava</button>
          </div>
        `;
        return;
      }
      // Retry with new token
      return syncActivities();
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw = await resp.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏃</div><p>No recent activities found</p></div>';
      return;
    }

    // Normalize to same shape used by the app
    const activities = raw.map(a => ({
      title: a.name || a.type,
      type: a.type,
      date: a.startDateLocal || a.startDate,
      distance: a.distance,
      duration: a.duration,
      hr: a.averageHeartrate ? Math.round(a.averageHeartrate) : null,
      cadence: a.averageCadence ? Math.round(a.averageCadence * 2) : null // strava gives spm per leg
    }));

    // Stamp matching plan days with hasGarmin = true
    if (activities.length > 0) {
      const dateMap = {};
      activities.forEach(a => {
        const d = new Date(a.date);
        d.setHours(0, 0, 0, 0);
        dateMap[d.getTime()] = a;
      });
      state.trainingDays.forEach(d => {
        const dd = new Date(d.date);
        dd.setHours(0, 0, 0, 0);
        if (dateMap[dd.getTime()]) {
          d.hasGarmin = true;
          d.garminHR = dateMap[dd.getTime()].hr;
          d.garminCadence = dateMap[dd.getTime()].cadence;
        }
      });
      saveToStorage();
      renderWeek(); // refresh garmin badges
    }

    container.innerHTML = `
      <div class="activities-synced-label">${activities.length} recent activities</div>
      ${activities.map(a => `
        <div class="activity-row">
          <div>
            <div class="activity-title">${a.title}</div>
            <div class="activity-meta">
              ${formatMiles(a.distance)} mi · ${formatDuration(a.duration)}
              ${a.hr ? ` · ${a.hr} bpm` : ''}
            </div>
          </div>
          <div class="activity-date">${new Date(a.date).toLocaleDateString()}</div>
        </div>
      `).join('')}
    `;

    // Show RPE section now that activities are loaded
    const rpeSection = document.getElementById('rpe-section');
    if (rpeSection) rpeSection.style.display = 'block';

  } catch(e) {
    const isAbort = e.name === 'TimeoutError' || e.type === 'TimeoutError';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>${isAbort ? 'Connection timed out' : 'Could not reach Strava'}</p>
        <div style="margin-top:10px">
          <button class="btn btn-secondary btn-sm" onclick="openFeedbackForm()">Log Manually</button>
        </div>
      </div>
    `;
  }
}

function openFeedbackForm() {
  // Fallback: open the Feedback tab for manual RPE entry
  closeGarminModal();
  switchTab('feedback');
}

// ===== EXERCISES =====
const EXERCISES = {
  itbsActivation: [
    { name: 'Clamshells', sets: '3', reps: '15 each side', notes: 'Keep feet together, don\'t rotate pelvis', videoUrl: 'https://www.youtube.com/watch?v=2xyW7EDXALQ' },
    { name: 'Side-Lying Hip Abduction', sets: '3', reps: '15 each side', notes: 'Keep legs straight, control descent', videoUrl: 'https://www.youtube.com/watch?v=9dJVwNzbH7s' },
    { name: 'Single-Leg RDL', sets: '3', reps: '10 each side', notes: 'Hinge at hip, keep back flat', videoUrl: 'https://www.youtube.com/watch?v=LfprnrrOuzY' },
    { name: 'Step-Downs', sets: '3', reps: '10 each side', notes: 'Control knee valgus, glute engagement', videoUrl: 'https://www.youtube.com/watch?v=LRdfjaG3L8I' },
    { name: 'Glute Bridge', sets: '3', reps: '15', notes: 'Squeeze glutes at top, don\'t arch back', videoUrl: 'https://www.youtube.com/watch?v=JqSgGoHFyKI' },
    { name: 'Monster Walks', sets: '2', reps: '20 steps', notes: 'Keep band taut, small steps, hip abd not flexion', videoUrl: 'https://www.youtube.com/watch?v=xEuq4GdGYWc' }
  ],
  formDrills: [
    { name: 'High Knees', sets: '3', reps: '20 yards', notes: 'Drive knees to waist height, quick arm turnover', videoUrl: 'https://www.youtube.com/watch?v=VKc58tjEVfs' },
    { name: 'Butt Kicks', sets: '3', reps: '20 yards', notes: 'Heels to glutes, stay tall, quick feet', videoUrl: 'https://www.youtube.com/watch?v=kRR1i9btd_w' },
    { name: 'Carioca (Grapevine)', sets: '3', reps: '20 yards', notes: 'Cross foot over then behind, rotate hips', videoUrl: 'https://www.youtube.com/watch?v=hp2G5Au0lrY' },
    { name: 'A-Skips', sets: '3', reps: '20 yards', notes: 'Drive knee up and forward, land on ball of foot', videoUrl: 'https://www.youtube.com/watch?v=692E8jdhSA8' },
    { name: 'Fast Feet', sets: '3', reps: '30 seconds', notes: 'Quick footstrike, stay on balls of feet', videoUrl: 'https://www.youtube.com/watch?v=BNKNkYDosrs' }
  ],
  strengthCircuit: [
    { name: 'Split Squat', sets: '3', reps: '12 each side', notes: 'Front heel down, control depth, upright torso', videoUrl: 'https://www.youtube.com/watch?v=epqOF4FcOLU' },
    { name: 'Lateral Band Walk', sets: '3', reps: '20 steps', notes: 'Band above knees, small lateral steps, torso tall', videoUrl: 'https://www.youtube.com/watch?v=I3gLnQ0vfpc' },
    { name: 'Plank', sets: '3', reps: '45 seconds', notes: 'Neutral spine, don\'t let hips sag or pike', videoUrl: 'https://www.youtube.com/watch?v=qB7wFQSf_dY' },
    { name: 'Pallof Press', sets: '3', reps: '10 each side', notes: 'Anti-rotation, hold at full extension 2 sec', videoUrl: 'https://www.youtube.com/watch?v=xeFp4MXad98' },
    { name: 'Back Extension', sets: '3', reps: '12', notes: 'Squeeze at top, control descent, hands on chest', videoUrl: 'https://www.youtube.com/watch?v=xKIuvqXeqsE' },
    { name: 'Walking Lunge', sets: '3', reps: '12 steps', notes: 'Long stride, front knee over ankle, back knee to floor', videoUrl: 'https://www.youtube.com/watch?v=vYfp2t4XgqQ' }
  ]
};

// ===== HELPERS =====
function formatTime(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMiles(meters) {
  return ((meters || 0) / 1609.34).toFixed(1);
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}:${s.toString().padStart(2,'0')}`;
  return `${s}s`;
}
// ===== COUNTDOWN =====
function renderCountdown() {
  const hero = document.getElementById('countdown-hero');
  const heroDays = document.getElementById('countdown-hero-days');
  if (!hero) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((RACE_DATE.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff <= 0) {
    hero.style.display = 'block';
    heroDays.textContent = '🎉';
    triggerConfetti();
    return;
  }

  hero.style.display = 'block';
  heroDays.textContent = diff;
}

// ===== CONFETTI =====
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = window.innerHeight;

  const colors = ['#F97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#fbbf24'];
  const particles = [];
  const count = 120;

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -200,
      w: Math.random() * 8 + 4,
      h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      vy: Math.random() * 3 + 2,
      vx: (Math.random() - 0.5) * 2,
      angle: Math.random() * 360,
      spin: (Math.random() - 0.5) * 8,
      drift: (Math.random() - 0.5) * 0.5
    });
  }

  let frame = 0;
  const maxFrames = 180;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.y += p.vy;
      p.x += p.vx + p.drift;
      p.angle += p.spin;
      p.vy += 0.05;
    });
    frame++;
    if (frame < maxFrames) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  draw();
}

// ===== SWIPE NAVIGATION =====
function initSwipeNav() {
  const tab = document.getElementById('tab-today');
  if (!tab) return;
  let startX = 0;
  let startY = 0;

  tab.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  tab.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx > 0) navigatePrevDay();
      else navigateNextDay();
      if (navigator.vibrate) navigator.vibrate(5);
    }
  }, { passive: true });
}

function navigatePrevDay() {
  if (!state.currentDay || !state.trainingDays.length) return;
  const idx = state.trainingDays.findIndex(d => d.date === state.currentDay.date);
  if (idx > 0) {
    state.currentDay = state.trainingDays[idx - 1];
    saveToStorage();
    renderToday();
  }
}

function navigateNextDay() {
  if (!state.currentDay || !state.trainingDays.length) return;
  const idx = state.trainingDays.findIndex(d => d.date === state.currentDay.date);
  if (idx < state.trainingDays.length - 1) {
    state.currentDay = state.trainingDays[idx + 1];
    saveToStorage();
    renderToday();
  }
}

// ===== HAPTIC FEEDBACK =====
function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(8);
}

// ===== INLINE VALIDATION =====
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('error');
  let errEl = field.parentElement.querySelector('.field-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'field-error';
    field.parentElement.appendChild(errEl);
  }
  errEl.textContent = message;
  field.closest('.plan-field')?.classList.add('shake');
  field.closest('.plan-field')?.classList.add('shake');
  setTimeout(() => field.closest('.plan-field')?.classList.remove('shake'), 500);
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(e => e.remove());
  document.querySelectorAll('.plan-field.error').forEach(e => e.classList.remove('error'));
}

// ===== WORKOUT DETAIL PANEL =====
function showWorkoutDetail(day) {
  state.selectedDetailDay = day;
  const panel = document.getElementById('workout-detail-panel');
  const title = document.getElementById('detail-title');
  const paceVal = document.getElementById('detail-pace-val');
  const hrVal = document.getElementById('detail-hr-val');
  const desc = document.getElementById('detail-desc');

  title.textContent = workoutTypeTitle(day.type);

  // Pace target based on workout type
  const targetPace = getPaceTarget(day);
  paceVal.textContent = targetPace;

  // HR context
  const hrContext = getHRContext(day);
  hrVal.textContent = hrContext;

  // Why this workout
  desc.innerHTML = getWhyThisWorkout(day);

  panel.style.display = 'block';
  panel.classList.add('slide-up');
}

function closeWorkoutDetail() {
  document.getElementById('workout-detail-panel').style.display = 'none';
  state.selectedDetailDay = null;
}

function getPaceTarget(day) {
  const marathonPace = 6.958; // min/mile for 3:05:00
  const maps = {
    'Easy': `Z2: ${(marathonPace + 0.3).toFixed(2)}–${(marathonPace + 0.5).toFixed(2)} /mi`,
    'Tempo': `Z3: ${marathonPace.toFixed(2)}–${(marathonPace - 0.1).toFixed(2)} /mi (6:50–7:00)`,
    'VO2max': `Z4+: ~6:30–6:45 /mi`,
    'Intervals': `Z4+: ~6:30–6:45 /mi`,
    'Yasso': `Z4+: ~6:30–6:45 /mi`,
    'Long': `Z2: ${(marathonPace + 0.2).toFixed(2)}–${(marathonPace + 0.4).toFixed(2)} /mi`,
    'Strides': 'Fast but relaxed',
    'Rest': '—',
    'Strength': '—'
  };
  return maps[day.type] || '—';
}

function getHRContext(day) {
  const isQuality = ['Tempo', 'VO2max', 'Yasso', 'Intervals', 'Long', 'Race Sim', 'Progressive'].includes(day.type);
  if (isQuality) {
    return 'Z2 ceiling: 152 bpm | LTHR: 171 bpm';
  }
  return day.components.includes('T') ? 'Keep HR < 152 bpm (Z2)' : 'Stay comfortable';
}

function getWhyThisWorkout(day) {
  if (day.description) {
    return `<strong>Why this workout:</strong> ${day.description}`;
  }
  const reasons = {
    'Easy': 'Build aerobic base — the foundation of marathon fitness. Keep conversation pace.',
    'Tempo': 'Sharpens lactate threshold. Sustainable hard effort for 20–40 min.',
    'VO2max': 'Peak aerobic power. Races at threshold tend to produce max HR.',
    'Long': 'Builds endurance, capillary density, and fat oxidation. Keep slow.',
    'Strides': ' neuromuscular priming. Leg speed and form refinement.',
    'Intervals': 'Boost VO2max and running economy. Quality over quantity.',
    'Yasso': 'Predictor workout. 800s @ 3K effort, same rest. Know your fitness.',
    'Rest': 'Recovery. Sleep, nutrition, mobility. Absorb the training.',
    'Strength': 'Structural resilience. Injury prevention and running economy.',
  };
  return `<strong>Why this workout:</strong> ${reasons[day.type] || 'Follow the plan.'}`;
}

// ===== PACE CALCULATOR =====
function openPaceCalc() {
  document.getElementById('pace-calc-modal').style.display = 'flex';
}

function closePaceCalc() {
  document.getElementById('pace-calc-modal').style.display = 'none';
}

function calculatePace() {
  const dist = parseFloat(document.getElementById('pace-distance').value);
  const h = parseInt(document.getElementById('pace-hours').value) || 0;
  const m = parseInt(document.getElementById('pace-minutes').value) || 0;
  const s = parseInt(document.getElementById('pace-seconds').value) || 0;

  if (!dist || dist <= 0) return;

  const totalSec = h * 3600 + m * 60 + s;
  if (totalSec <= 0) return;

  const secPerMile = totalSec / dist;
  const secPerKm = secPerMile / 1.60934;

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const ss = Math.round(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  document.getElementById('pace-per-mile').textContent = `${fmt(secPerMile)} /mi`;
  document.getElementById('pace-per-km').textContent = `${fmt(secPerKm)} /km`;

  // Build split table
  const table = document.getElementById('pace-split-table');
  let html = '<div class="split-table-header"><span>Mile</span><span>Split</span><span>Cumulative</span></div>';
  let cumulative = 0;
  for (let i = 1; i <= Math.ceil(dist); i++) {
    cumulative += secPerMile;
    const cm = Math.floor(cumulative / 60);
    const cs = Math.round(cumulative % 60);
    html += `<div class="split-row"><span>${i}</span><span>${fmt(secPerMile)}</span><span>${cm}:${cs.toString().padStart(2,'0')}</span></div>`;
  }
  table.innerHTML = html;
  document.getElementById('pace-results').style.display = 'block';
}

// ===== SHARE WORKOUT =====
function shareWorkout(dayOrId) {
  const day = typeof dayOrId === 'string' ? state.currentDay : dayOrId;
  if (!day) return;
  const text = `${workoutTypeTitle(day.type)} — ${day.dateString}\n${day.workout}\n${day.plannedDist !== '-' ? day.plannedDist + ' mi' : ''}\n#RunPlan #VictoriaMarathon`;
  if (navigator.share) {
    navigator.share({ title: 'RunPlan Workout', text });
  } else {
    navigator.clipboard.writeText(text).then(() => {
      alert('Workout copied to clipboard!');
    });
  }
}

// ===== RPE LOGGING =====
function loadRPEFromStorage() {
  try {
    const log = localStorage.getItem('runplan_rpe');
    if (log) state.rpeLog = JSON.parse(log);
  } catch(e) {}
}

function submitRPE() {
  const selected = document.querySelector('.rpe-btn.selected');
  if (!selected) return;
  const rpe = parseInt(selected.dataset.rpe);
  const day = state.currentDay;
  if (!day) return;
  state.rpeLog = state.rpeLog.filter(r => r.date !== day.date);
  state.rpeLog.push({ date: day.date, rpe, type: day.type, week: day.week });
  localStorage.setItem('runplan_rpe', JSON.stringify(state.rpeLog));
  const section = document.getElementById('rpe-section');
  section.innerHTML = `<div class="rpe-saved">✅ RPE ${rpe}/10 logged for ${day.dateString}</div>`;
}

function selectRPE(rpe) {
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.rpe-btn[data-rpe="${rpe}"]`).classList.add('selected');
}

function getRPEForDate(date) {
  const entry = state.rpeLog.find(r => r.date === date);
  return entry ? entry.rpe : null;
}

// ===== WEATHER (mock — replace with real API) =====
function fetchWeatherForDay(day) {
  // Placeholder — returns mock 3-day forecast
  // Replace with real weather API call for Seattle area
  return [
    { label: 'Today', icon: '☀️', high: 72, low: 55, condition: 'Sunny' },
    { label: 'Tomorrow', icon: '⛅', high: 68, low: 53, condition: 'Partly Cloudy' },
    { label: day.day, icon: '🌧️', high: 65, low: 51, condition: 'Chance of Rain' }
  ];
}

function renderWeatherWidget(dayId) {
  const widget = document.getElementById(`weather-${dayId}`);
  if (!widget) return;
  const fc = fetchWeatherForDay({ day: 'Wed' });
  widget.innerHTML = fc.map(f => `<span class="wf-day">${f.icon}${f.label.substring(0,3)}<b>${f.high}°</b></span>`).join('');
}

// ===== WEEKLY MILEAGE CHART =====
function renderMileageChart() {
  const container = document.getElementById('mileage-bars');
  if (!container || state.trainingDays.length === 0) return;

  const weeks = {};
  state.trainingDays.forEach(d => {
    if (!weeks[d.week]) weeks[d.week] = 0;
    const dist = parseFloat(d.plannedDist) || 0;
    if (d.type !== 'Rest' && d.type !== 'Bike') weeks[d.week] += dist;
  });

  const sortedWeeks = Object.keys(weeks).sort((a, b) => a - b);
  const maxMPW = Math.max(...Object.values(weeks), 1);
  const currentWeek = state.currentDay ? state.currentDay.week : sortedWeeks[0];

  container.innerHTML = sortedWeeks.map(w => {
    const pct = (weeks[w] / maxMPW * 100).toFixed(0);
    const isCurrent = parseInt(w) === parseInt(currentWeek);
    return `<div class="mileage-bar-wrap">
      <div class="mileage-bar${isCurrent ? ' current' : ''}" style="width:${pct}%"></div>
      <span class="mileage-week-label">W${w}</span>
      <span class="mileage-val">${weeks[w].toFixed(0)}</span>
    </div>`;
  }).join('');

  document.getElementById('mileage-chart').style.display = 'block';
}

// ===== SUMMARY TAB =====
function renderSummary() {
  if (state.trainingDays.length === 0) {
    document.getElementById('summary-content').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📋</div><p>No data yet. Sync to load your plan.</p></div>';
    return;
  }

  // Race card
  const raceDate = 'Sunday, October 11, 2026';
  const daysToRace = Math.ceil((new Date('2026-10-11') - new Date()) / (1000 * 60 * 60 * 24));
  document.getElementById('summary-race-card').innerHTML = `
    <div class="summary-race-header">
      <div class="summary-race-name">Victoria Marathon 2026</div>
      <div class="summary-race-date">${raceDate}</div>
    </div>
    <div class="summary-race-goal">
      <div class="summary-goal-chip">
        <span class="summary-goal-label">Goal</span>
        <span class="summary-goal-val">Sub-3:05</span>
      </div>
      <div class="summary-goal-chip">
        <span class="summary-goal-label">Realistic</span>
        <span class="summary-goal-val">3:30–3:45</span>
      </div>
      <div class="summary-goal-chip">
        <span class="summary-goal-label">Days Out</span>
        <span class="summary-goal-val">${daysToRace > 0 ? daysToRace : 0}</span>
      </div>
    </div>
  `;

  // Phase accordion — groups trainingDays by phase for the expanded view
  const phaseGroups = {};
  state.trainingDays.forEach(d => {
    if (!d.phase) return;
    if (!phaseGroups[d.phase]) phaseGroups[d.phase] = [];
    phaseGroups[d.phase].push(d);
  });

  // Helper to get week summary for a phase
  function getWeekSummary(weekNum, days) {
    const weekDays = days.filter(d => d.week === weekNum);
    if (!weekDays.length) return null;
    const mpw = weekDays[0].mpw;
    const dates = weekDays.map(d => d.date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    // Find the key workout (highest priority quality session)
    const qualityOrder = ['Race Sim', 'Yasso', 'VO2max', 'Intervals', 'Tempo', 'T-Pace', 'Cruise', 'Long', 'Progressive', 'Strides', 'Easy'];
    const keyDay = [...weekDays].sort((a, b) => {
      const ai = qualityOrder.indexOf(a.type);
      const bi = qualityOrder.indexOf(b.type);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })[0];
    return {
      mpw,
      startDate,
      endDate,
      keyWorkout: keyDay ? `${keyDay.type} — ${keyDay.workout || keyDay.type}` : 'Rest',
      keyType: keyDay ? keyDay.type : 'Rest'
    };
  }

  const phaseAcc = [
    { name: 'Phase 1 — Base Building', weekRange: [1, 6], mpw: '33–42', focus: 'Easy miles, ITBS activation, strides, cadence drills' },
    { name: 'Phase 2 — Norwegian Singles', weekRange: [7, 12], mpw: '42–50', focus: 'Intervals (800m-1000m), Tempo @ LTHR 171, hill sprints' },
    { name: 'Phase 3 — Peak Volume', weekRange: [13, 15], mpw: '46–50', focus: '5x1000m intervals, 10-mi tempo, Yasso 800s (10x800m @ 3:22)' },
    { name: 'Phase 4 — Recovery', weekRange: [16, 18], mpw: '35–45', focus: 'Cutback weeks, reduced intensity, race sim @ wk 17' },
    { name: 'Phase 5 — Pre-Race', weekRange: [19, 21], mpw: '30–18', focus: 'VO2max sharpening, final race-pace tune-up, taper' },
    { name: 'Race Week', weekRange: [22, 22], mpw: '15', focus: 'Race day — Oct 11, 2026' }
  ];

  const currentPhase = state.currentDay ? state.currentDay.phase : '';

  document.getElementById('summary-phases').innerHTML = `
    <div class="summary-section-title">Phases</div>
    <div class="phase-table" id="phase-accordion">
      ${phaseAcc.map((p, i) => {
        const isCurrent = currentPhase.includes(p.name.split('—')[0].trim());
        const phaseKey = p.name.split('—')[0].trim();
        const phaseDays = Object.values(phaseGroups).find(g => g[0] && g[0].phase.includes(phaseKey)) || [];
        const weeksInPhase = [...new Set(phaseDays.map(d => d.week))].sort((a, b) => a - b);
        return `
          <div class="phase-acc-item${isCurrent ? ' current' : ''}">
            <div class="phase-acc-header" onclick="togglePhaseAcc(${i})">
              <div class="phase-acc-left">
                <div class="phase-row-name">${p.name}</div>
                <div class="phase-row-focus">${p.focus}</div>
              </div>
              <div class="phase-acc-right">
                <div class="phase-row-mpw">${p.mpw} mpw</div>
                <div class="phase-row-weeks">${p.weekRange[0]}–${p.weekRange[1]}</div>
                <span class="phase-acc-chevron" id="phase-chev-${i}">▼</span>
              </div>
            </div>
            <div class="phase-acc-body" id="phase-body-${i}" style="display:none">
              ${weeksInPhase.map(wk => {
                const summary = getWeekSummary(wk, phaseDays);
                if (!summary) return '';
                const typeColor = {
                  'Race Sim': '#ef4444', 'Yasso': '#f97316', 'VO2max': '#3b82f6',
                  'Intervals': '#3b82f6', 'Tempo': '#22c55e', 'T-Pace': '#22c55e',
                  'Cruise': '#22c55e', 'Long': '#8b5cf6', 'Progressive': '#8b5cf6',
                  'Strides': '#10b981', 'Easy': '#94a3b8', 'Rest': '#e2e8f0'
                }[summary.keyType] || '#94a3b8';
                return `
                  <div class="week-acc-row">
                    <div class="week-acc-num">W${wk}</div>
                    <div class="week-acc-dates">${formatDateShort(summary.startDate)} – ${formatDateShort(summary.endDate)}</div>
                    <div class="week-acc-mpw">${summary.mpw} mi</div>
                    <div class="week-acc-workout">
                      <span class="week-acc-type" style="background:${typeColor}20;color:${typeColor}">${summary.keyType}</span>
                      <span class="week-acc-name">${summary.keyWorkout.split('—')[1] || summary.keyWorkout}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // HR Zones
  document.getElementById('summary-hr-zones').innerHTML = `
    <div class="hr-row"><span class="hr-badge z1">Z1</span><span class="hr-range">92–123 bpm</span><span class="hr-desc">Recovery / Very Easy</span></div>
    <div class="hr-row"><span class="hr-badge z2">Z2</span><span class="hr-range">123–139 bpm</span><span class="hr-desc">Aerobic Base / Easy</span></div>
    <div class="hr-row"><span class="hr-badge z3">Z3</span><span class="hr-range">139–152 bpm</span><span class="hr-desc">Tempo / Threshold</span></div>
    <div class="hr-row"><span class="hr-badge z4">Z4</span><span class="hr-range">152–161 bpm</span><span class="hr-desc">LTHR / Lactate Clearance</span></div>
    <div class="hr-row"><span class="hr-badge z5">Z5</span><span class="hr-range">161–171 bpm</span><span class="hr-desc">VO2max / Hard Intervals</span></div>
    <div class="lthr-row"><span>Your LTHR</span><span class="lthr-val">171 bpm</span></div>
  `;

  // Key Checkpoints
  document.getElementById('summary-checkpoints').innerHTML = `
    <div class="summary-section-title">Key Checkpoints</div>
    <div class="checkpoint-list">
      <div class="checkpoint-item">
        <div class="checkpoint-icon">🧪</div>
        <div class="checkpoint-info">
          <div class="checkpoint-name">Yasso 800s — Week 6</div>
          <div class="checkpoint-detail">10x800m @ 5K effort</div>
          <div class="checkpoint-criteria">Avg >3:45 → recalibrate to 3:30+ | Avg &lt;3:05 → sub-3:05 territory</div>
        </div>
      </div>
      <div class="checkpoint-item">
        <div class="checkpoint-icon">⚡</div>
        <div class="checkpoint-info">
          <div class="checkpoint-name">Bellwether 10K — Week 13</div>
          <div class="checkpoint-detail">5K thresh → 5min jog → 5K @ M-pace</div>
          <div class="checkpoint-criteria">Both 5Ks clean = goal on track | 2nd blows up = recalibrate M-pace</div>
        </div>
      </div>
      <div class="checkpoint-item">
        <div class="checkpoint-icon">🏃</div>
        <div class="checkpoint-info">
          <div class="checkpoint-name">Race Simulation — Week 14</div>
          <div class="checkpoint-detail">22-mi sim @ M-pace (8:30-8:40/mi)</div>
          <div class="checkpoint-criteria">HR &lt;174 + holds 7:10-7:15/mi = 3:05 confirmed</div>
        </div>
      </div>
    </div>
  `;

  // Strength summary
  document.getElementById('summary-strength').innerHTML = `
    <div class="summary-section-title">Strength & Plyometrics</div>
    <div class="strength-table">
      <div class="strength-row header">
        <span>Phase</span><span>Frequency</span><span>Program</span>
      </div>
      <div class="strength-row">
        <span>Phase 1 (Wks 1-6)</span><span>2x/week</span><span>Circuit A (2 rounds) | Circuit B (2 rounds, bodyweight)</span>
      </div>
      <div class="strength-row">
        <span>Phase 2 (Wks 7-14)</span><span>2x/wk + plyo</span><span>Circuit A + weight | Circuit B + weight | Plyometrics Circuit A (post-long)</span>
      </div>
      <div class="strength-row">
        <span>Phase 3 (Wks 13-15)</span><span>1x/week</span><span>Circuit A (2 rounds, form focus)</span>
      </div>
      <div class="strength-row">
        <span>Phase 4 (Wks 16-18)</span><span>1-2x/week</span><span>Circuit A (2 rounds, maintenance)</span>
      </div>
      <div class="strength-row">
        <span>Phase 5 (Wks 19-21)</span><span>Wk19 only</span><span>Wk19: Circuit A (1 round, light) | Wks 20-21: Zero</span>
      </div>
    </div>
  `;
}

// ===== GARMIN BADGE =====
function markGarminDone(dateStr) {
  if (!state.garminActivityDates.includes(dateStr)) {
    state.garminActivityDates.push(dateStr);
    localStorage.setItem('runplan_garmin_dates', JSON.stringify(state.garminActivityDates));
  }
}

// ===== WORKOUT DETAIL PANEL =====
function showWorkoutDetail(day) {
  state.selectedDetailDay = day;
  const panel = document.getElementById('workout-detail-panel');
  const title = document.getElementById('detail-title');
  const paceVal = document.getElementById('detail-pace-val');
  const hrVal = document.getElementById('detail-hr-val');
  const desc = document.getElementById('detail-desc');
  title.textContent = workoutTypeTitle(day.type);
  paceVal.textContent = getPaceTarget(day);
  hrVal.textContent = getHRContext(day);
  desc.innerHTML = getWhyThisWorkout(day);
  panel.style.display = 'block';
  panel.classList.add('slide-up');
}

function closeWorkoutDetail() {
  document.getElementById('workout-detail-panel').style.display = 'none';
  state.selectedDetailDay = null;
}

function getPaceTarget(day) {
  const mp = 6.958;
  const m = { Easy: `Z2: ${(mp+0.3).toFixed(2)}–${(mp+0.5).toFixed(2)} /mi`, Tempo: `Z3: ${mp.toFixed(2)}–${(mp-0.1).toFixed(2)} /mi`, Long: `Z2: ${(mp+0.2).toFixed(2)}–${(mp+0.4).toFixed(2)} /mi`, VO2max: 'Z4+: ~6:30–6:45 /mi', Intervals: 'Z4+: ~6:30–6:45 /mi', Yasso: 'Z4+: ~6:30–6:45 /mi', Strides: 'Fast but relaxed', Rest: '—', Strength: '—' };
  return m[day.type] || '—';
}

function getHRContext(day) {
  const q = ['Tempo','VO2max','Yasso','Intervals','Long','Race Sim','Progressive'];
  return q.includes(day.type) ? 'Z2 ceiling: 152 bpm | LTHR: 171 bpm' : day.components.includes('T') ? 'Keep HR < 152 bpm (Z2)' : 'Stay comfortable';
}

function getWhyThisWorkout(day) {
  const r = { Easy: 'Build aerobic base — the foundation of marathon fitness. Keep conversation pace.', Tempo: 'Sharpens lactate threshold. Sustainable hard effort for 20–40 min.', VO2max: 'Peak aerobic power. Races at threshold tend to produce max HR.', Long: 'Builds endurance, capillary density, and fat oxidation. Keep slow.', Strides: 'Neuromuscular priming. Leg speed and form refinement.', Intervals: 'Boost VO2max and running economy. Quality over quantity.', Yasso: 'Predictor workout. 800s @ 3K effort, same rest. Know your fitness.', Rest: 'Recovery. Sleep, nutrition, mobility. Absorb the training.', Strength: 'Structural resilience. Injury prevention and running economy.' };
  return `<strong>Why this workout:</strong> ${r[day.type] || 'Follow the plan.'}`;
}

function getWhyChipContent(day) {
  const c = { Easy: '💨 Build base mileage — stay conversational', Tempo: '⚡ Raise lactate threshold — push the edge', Long: '🏔️ Endurance builder — keep it slow and steady', Rest: '😴 Recovery — absorb the training', Strides: '⚡ Leg speed & form — stay relaxed', VO2max: '🔥 Peak aerobic power — give what you have', Intervals: '🔁 Boost VO2max — quality reps', Strength: '💪 Structural strength — master the basics' };
  return c[day.type] || '🎯 Follow the plan';
}

function markGarminDone(dateStr) {
  if (!state.garminActivityDates.includes(dateStr)) {
    state.garminActivityDates.push(dateStr);
    localStorage.setItem('runplan_garmin_dates', JSON.stringify(state.garminActivityDates));
  }
}

// ===== PHASE ACCORDION (Summary tab) =====
function togglePhaseAcc(index) {
  const body = document.getElementById(`phase-body-${index}`);
  const chev = document.getElementById(`phase-chev-${index}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chev.textContent = isOpen ? '▶' : '▼';
  chev.style.transform = isOpen ? '' : 'rotate(0deg)';
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  // dateStr is YYYY-MM-DD
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m)-1]} ${parseInt(d)}`;
}

// ===== FEEDBACK TAB (Workout Log + Adaptation) =====
function renderFeedback() {
  if (state.trainingDays.length === 0) {
    document.getElementById('feedback-content').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📝</div><p>No data yet. Sync to load your plan.</p></div>';
    return;
  }

  // Checkpoint status bar
  renderCheckpointStatus();

  // Today's workout feedback prompt
  const day = state.currentDay;
  if (day && day.type !== 'Rest' && day.type !== 'Bike') {
    const existing = getFeedbackForDate(day.date);
    if (!existing) {
      document.getElementById('feedback-today').innerHTML = `
        <div class="feedback-today-card">
          <div class="feedback-today-header">
            <div class="feedback-today-name">📝 Log: ${day.type} — ${day.workout || day.type}</div>
            <div class="feedback-today-date">${formatDateShort(day.date)}</div>
          </div>
          ${renderFeedbackForm(day)}
        </div>
      `;
    } else {
      document.getElementById('feedback-today').innerHTML = `
        <div class="feedback-today-card logged">
          <div class="feedback-logged-header">
            <div class="feedback-logged-name">✅ ${day.type} — ${day.workout || day.type}</div>
            <div class="feedback-logged-date">${formatDateShort(day.date)}</div>
          </div>
          <div class="feedback-logged-rpe">
            <span class="feedback-logged-label">RPE</span>
            <span class="feedback-logged-val">${existing.rpe}/10</span>
            <span class="feedback-logged-label">Difficulty</span>
            <span class="feedback-logged-val">${existing.difficulty}/5</span>
          </div>
          ${existing.notes ? `<div class="feedback-logged-notes">${existing.notes}</div>` : ''}
        </div>
      `;
    }
  } else {
    document.getElementById('feedback-today').innerHTML = `
      <div class="feedback-today-card rest">
        <div class="feedback-rest-msg">Rest day — no workout to log.</div>
      </div>
    `;
  }

  // Quick log (past 7 days without feedback)
  renderQuickLog();

  // Feedback history
  renderFeedbackHistory();

  // Run adaptation engine
  runAdaptations();
}

function renderFeedbackForm(day) {
  return `
    <div class="feedback-form">
      <div class="feedback-field">
        <label>How hard did it feel?</label>
        <div class="rpe-selector" id="rpe-selector">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `
            <button class="rpe-btn${n <= 5 ? ' default' : ''}" data-rpe="${n}" onclick="selectRPE(${n}); hapticTap()">${n}</button>
          `).join('')}
        </div>
        <div class="rpe-scale-ref">
          <span>1 = effortless</span>
          <span>5 = moderate</span>
          <span>10 = maximum effort</span>
        </div>
      </div>
      <div class="feedback-field">
        <label>Workout difficulty</label>
        <div class="diff-selector">
          ${['Too Easy','Easy','Just Right','Hard','Too Hard'].map((d, i) => `
            <button class="diff-btn" data-diff="${i+1}" onclick="selectDiff(${i+1}); hapticTap()">${d}</button>
          `).join('')}
        </div>
      </div>
      <div class="feedback-field">
        <label>Notes (optional)</label>
        <textarea id="feedback-notes" placeholder="How did it go? Any observations..."></textarea>
      </div>
      <button class="btn btn-primary" onclick="saveFeedback('${day.date}'); hapticTap()">Save Log</button>
    </div>
  `;
}

function selectRPE(n) {
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.rpe-btn[data-rpe="${n}"]`).classList.add('selected');
}

function selectDiff(d) {
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.diff-btn[data-diff="${d}"]`).classList.add('selected');
}

function saveFeedback(date) {
  const rpe = parseInt(document.querySelector('.rpe-btn.selected')?.dataset.rpe || '5');
  const diffBtns = document.querySelectorAll('.diff-btn.selected');
  const difficulty = diffBtns.length ? parseInt(diffBtns[0].dataset.diff) : 3;
  const notes = document.getElementById('feedback-notes')?.value || '';

  const fb = {
    date,
    rpe,
    difficulty,
    notes,
    savedAt: new Date().toISOString()
  };

  // Save to localStorage
  const logs = JSON.parse(localStorage.getItem('runplan_feedback_logs') || '{}');
  logs[date] = fb;
  localStorage.setItem('runplan_feedback_logs', JSON.stringify(logs));

  // Update trainingDays with RPE
  const day = state.trainingDays.find(d => d.date === date);
  if (day) day.rpe = rpe;

  renderFeedback();
}

function getFeedbackForDate(date) {
  const logs = JSON.parse(localStorage.getItem('runplan_feedback_logs') || '{}');
  return logs[date] || null;
}

function renderQuickLog() {
  // Past 7 days that don't have feedback yet
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const pastDays = state.trainingDays.filter(d => d.date >= weekAgo && d.date < today);
  const logs = JSON.parse(localStorage.getItem('runplan_feedback_logs') || '{}');
  const unlogged = pastDays.filter(d => d.type !== 'Rest' && d.type !== 'Bike' && !logs[d.date]);

  if (unlogged.length === 0) {
    document.getElementById('feedback-quick-log').innerHTML = '';
    return;
  }

  document.getElementById('feedback-quick-log').innerHTML = `
    <div class="feedback-section-title">📋 Pending Logs (past 7 days)</div>
    ${unlogged.map(d => `
      <div class="quick-log-item" onclick="openQuickLog('${d.date}')">
        <div class="quick-log-info">
          <div class="quick-log-type">${d.type}</div>
          <div class="quick-log-date">${formatDateShort(d.date)}</div>
        </div>
        <div class="quick-log-arrow">›</div>
      </div>
    `).join('')}
  `;
}

function openQuickLog(date) {
  const day = state.trainingDays.find(d => d.date === date);
  if (!day) return;
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'quick-log-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Log: ${day.type} — ${formatDateShort(date)}</h3>
        <button class="modal-close" onclick="closeQuickLog()">✕</button>
      </div>
      <div class="modal-body">
        ${renderFeedbackForm(day)}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeQuickLog() {
  document.getElementById('quick-log-modal')?.remove();
}

function renderFeedbackHistory() {
  const logs = JSON.parse(localStorage.getItem('runplan_feedback_logs') || '{}');
  const entries = Object.entries(logs).sort((a, b) => new Date(b[0]) - new Date(a[0])).slice(0, 20);

  if (entries.length === 0) {
    document.getElementById('feedback-history').innerHTML = `
      <div class="feedback-section-title">📖 Recent Logs</div>
      <div class="feedback-empty">No logs yet. After each workout, tap "Log" to record RPE.</div>
    `;
    return;
  }

  document.getElementById('feedback-history').innerHTML = `
    <div class="feedback-section-title">📖 Recent Logs</div>
    <div class="feedback-history-list">
      ${entries.map(([date, fb]) => {
        const day = state.trainingDays.find(d => d.date === date);
        return `
          <div class="feedback-history-item">
            <div class="feedback-hi-left">
              <div class="feedback-hi-type">${day ? day.type : 'Unknown'}</div>
              <div class="feedback-hi-date">${formatDateShort(date)}</div>
            </div>
            <div class="feedback-hi-right">
              <div class="feedback-hi-rpe">
                <span class="feedback-hi-rpe-val">${fb.rpe}</span><span class="feedback-hi-rpe-label">/10</span>
              </div>
              <div class="feedback-hi-diff diff-${fb.difficulty}">${['','Too Easy','Easy','Just Right','Hard','Too Hard'][fb.difficulty]}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderCheckpointStatus() {
  const cp = window.ATHLETE_PROFILE?.checkpoints || {};
  const currentWeek = state.currentDay?.week || 1;

  const items = [
    {
      id: 'yasso',
      name: 'Yasso 800s',
      week: 6,
      icon: '🧪',
      result: cp.yasso?.verdict
    },
    {
      id: 'bellwether',
      name: 'Bellwether 10K',
      week: 13,
      icon: '⚡',
      result: cp.bellwether?.verdict
    },
    {
      id: 'race_sim',
      name: 'Race Sim',
      week: 14,
      icon: '🏃',
      result: cp.race_sim?.verdict
    }
  ];

  document.getElementById('checkpoint-status').innerHTML = `
    <div class="feedback-section-title">🎯 Checkpoints</div>
    <div class="checkpoint-cards">
      ${items.map(item => {
        const isPast = currentWeek > item.week;
        const isCurrent = currentWeek === item.week;
        const isFuture = currentWeek < item.week;
        const status = isFuture ? 'future' : isPast ? (item.result ? 'done' : 'missed') : 'current';

        return `
          <div class="checkpoint-card status-${status}">
            <div class="checkpoint-card-icon">${item.icon}</div>
            <div class="checkpoint-card-info">
              <div class="checkpoint-card-name">${item.name}</div>
              <div class="checkpoint-card-week">Week ${item.week}</div>
              ${item.result ? `<div class="checkpoint-card-result">${item.result.replace('_', ' ')}</div>` : ''}
            </div>
            <div class="checkpoint-card-status">
              ${isFuture ? `<span class="cp-future">Wk ${item.week}</span>` :
                item.result ? `<span class="cp-done">✅</span>` :
                isPast ? `<span class="cp-missed">—</span>` :
                `<span class="cp-now">NOW</span>`}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <button class="btn btn-secondary" onclick="openCheckpointInput()" style="margin-top:8px">Log Checkpoint Result</button>
  `;
}

function openCheckpointInput() {
  const currentWeek = state.currentDay?.week || 1;
  const checkpoints = [
    { id: 'yasso', name: 'Yasso 800s (Week 6)', week: 6 },
    { id: 'bellwether', name: 'Bellwether 10K (Week 13)', week: 13 },
    { id: 'race_sim', name: 'Race Simulation (Week 14)', week: 14 }
  ];

  const available = checkpoints.filter(c => c.week <= currentWeek);
  if (available.length === 0) {
    alert('No checkpoints available yet.');
    return;
  }

  const c = available[available.length - 1];
  const verdict = prompt(`${c.name}\n\nEnter verdict:\n- sub_3_05 (< 3:05 avg)\n- on_track (3:05-3:22 avg)\n- recalibrate (3:22-3:45)\n- extend (3:45+)\n- confirmed_3_05 (race sim HR <174, pace 7:10-7:15)\n- 3_30_realistic (HR >174 or slower pace)\n\nVerdict:`);

  if (!verdict) return;
  const clean = verdict.trim().toLowerCase().replace(/ /g, '_');

  if (window.athleteProfile?.updateCheckpoint) {
    window.athleteProfile.updateCheckpoint(c.id, { verdict: clean });
  }

  renderCheckpointStatus();
  runAdaptations();
  renderSummary();
}

// ===== ADAPTATION ENGINE RUNNER =====
function runAdaptations() {
  if (!window.AdaptationEngine || state.trainingDays.length === 0) {
    document.getElementById('adaptation-panel').style.display = 'none';
    return;
  }

  const profile = window.ATHLETE_PROFILE || {};
  const recommendations = AdaptationEngine.evaluate(profile, state.trainingDays);

  if (recommendations.length === 0) {
    document.getElementById('adaptation-panel').style.display = 'none';
    return;
  }

  document.getElementById('adaptation-panel').style.display = 'block';
  document.getElementById('adaptation-content').innerHTML = `
    <div class="adaptation-list">
      ${recommendations.map(rec => `
        <div class="adaptation-item priority-${rec.priority || 'medium'}">
          <div class="adaptation-icon">${getAdaptationIcon(rec.type)}</div>
          <div class="adaptation-body">
            <div class="adaptation-type">${formatAdaptationType(rec.type)}</div>
            <div class="adaptation-summary">${AdaptationEngine.summarize(rec)}</div>
          </div>
          <div class="adaptation-priority ${rec.priority || 'medium'}">${rec.priority || 'medium'}</div>
        </div>
      `).join('')}
    </div>
    <div class="adaptation-cta">
      <button class="btn btn-primary" onclick="applyAllAdaptations()">Apply All Recommendations</button>
      <button class="btn btn-secondary" onclick="dismissAdaptations()">Dismiss</button>
    </div>
  `;
}

function getAdaptationIcon(type) {
  const map = {
    'extend_phase': '⏳', 'reduce_intensity': '📉', 'recalibrate_pace': '🎯',
    'deload': '🔄', 'advance_phase': '➡️', 'delay_phase': '⏸️',
    'confirm_target': '✅', 'increase_intensity': '📈', 'warning': '⚠️'
  };
  return map[type] || '🔧';
}

function formatAdaptationType(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function applyAllAdaptations() {
  // Persist adaptations to localStorage so app.js respects them
  const recs = window._pendingRecommendations || [];
  localStorage.setItem('runplan_adaptations', JSON.stringify(recs));
  document.getElementById('adaptation-panel').style.display = 'none';
  renderSummary();
}

function dismissAdaptations() {
  localStorage.setItem('runplan_adaptations_dismissed', new Date().toISOString());
  document.getElementById('adaptation-panel').style.display = 'none';
}

// ===== PLANS TAB =====
function renderPlans() {
  const plans = JSON.parse(localStorage.getItem('runplan_plans') || '[]');
  const activePlanId = localStorage.getItem('runplan_active_plan') || 'default';
  const container = document.getElementById('plans-content');

  if (plans.length === 0) {
    container.innerHTML = `
      <div class="plans-empty">
        <div class="plans-empty-icon">📋</div>
        <p>No custom plans yet.<br>Tap "+ New Plan" to create one.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = plans.map(plan => {
    const isActive = plan.id === activePlanId;
    const today = new Date().toISOString().split('T')[0];
    const daysUntil = Math.ceil((new Date(plan.raceDate) - new Date(today)) / 86400000);

    return `
      <div class="plan-card" onclick="activatePlan('${plan.id}')">
        <div class="plan-card-header">
          <div>
            <div class="plan-card-name">${plan.raceName}</div>
            ${isActive ? '<div style="font-size:10px;color:var(--orange);font-weight:700;margin-top:2px">✓ ACTIVE</div>' : ''}
          </div>
          <div class="plan-card-date">${daysUntil > 0 ? daysUntil + 'd away' : 'Race week'}</div>
        </div>
        <div class="plan-card-meta">
          <div class="plan-card-stat">
            <div class="plan-card-stat-label">Goal</div>
            <div class="plan-card-stat-value">${plan.goalTime}</div>
          </div>
          <div class="plan-card-stat">
            <div class="plan-card-stat-label">Fitness</div>
            <div class="plan-card-stat-value">${capitalize(plan.fitness)}</div>
          </div>
          <div class="plan-card-stat">
            <div class="plan-card-stat-label">Race</div>
            <div class="plan-card-stat-value">${plan.raceDate}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function openCreatePlanModal() {
  document.getElementById('create-plan-modal').style.display = 'flex';
  // Reset form
  document.getElementById('plan-race-name').value = '';
  document.getElementById('plan-race-date').value = '';
  document.getElementById('plan-hours').value = '';
  document.getElementById('plan-minutes').value = '';
  document.querySelectorAll('.fitness-option').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.bool-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('optional-fields').style.display = 'none';
  document.getElementById('optional-chevron').textContent = '▶';
}

function closeCreatePlanModal() {
  document.getElementById('create-plan-modal').style.display = 'none';
}

function toggleOptionalFields() {
  const el = document.getElementById('optional-fields');
  const chev = document.getElementById('optional-chevron');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  chev.textContent = el.style.display === 'none' ? '▶' : '▼';
}

function selectFitness(level) {
  document.querySelectorAll('.fitness-option').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.fitness-option[data-fitness="${level}"]`).classList.add('selected');
  window._planFitness = level;
}

function selectBool(field, val) {
  const group = document.querySelectorAll(`.bool-btn[data-val]`);
  // actually selectBool for itbs specifically
  document.querySelectorAll('.bool-btn').forEach(b => b.classList.remove('selected'));
  event.target.classList.add('selected');
}

function generatePlan() {
  // Gather inputs
  const raceName = document.getElementById('plan-race-name').value.trim();
  const raceDate = document.getElementById('plan-race-date').value;
  const hours = parseInt(document.getElementById('plan-hours').value) || 3;
  const minutes = parseInt(document.getElementById('plan-minutes').value) || 30;
  const fitness = window._planFitness || 'intermediate';
  const lastHours = parseInt(document.getElementById('plan-last-hours').value) || null;
  const lastMinutes = parseInt(document.getElementById('plan-last-minutes').value) || null;
  const lthr = parseInt(document.getElementById('plan-lthr').value) || null;
  const itbsHistory = document.querySelector('.bool-btn.selected')?.dataset.val === 'yes';

  // Validate
  clearFieldErrors();
  let valid = true;
  if (!raceName) { showFieldError('plan-race-name', 'Please enter a race name'); valid = false; }
  if (!raceDate) { showFieldError('plan-race-date', 'Please enter a race date'); valid = false; }

  if (!valid) return;

  const goalTime = `${hours}:${String(minutes).padStart(2, '0')}`;
  const goalPaceMin = (hours * 60 + minutes) / 26.2; // minutes per mile

  // Determine starting MPW from fitness
  const baseMPW = { beginner: 25, intermediate: 32, advanced: 40 }[fitness];
  const peakMPW = { beginner: 42, intermediate: 50, advanced: 60 }[fitness];

  // Calculate total weeks from race date
  const today = new Date();
  const race = new Date(raceDate);
  const weeksUntil = Math.ceil((race - today) / 604800000);

  if (weeksUntil < 8) {
    showFieldError('plan-race-date', 'Need at least 8 weeks before race date');
    return;
  }

  // Estimate LTHR
  const estimatedLTHR = lthr || Math.round((220 - 32) * 0.92); // age 32

  // Generate plan
  const planId = 'plan_' + Date.now();
  const planDef = buildPlanDefinition({
    planId,
    raceName,
    raceDate,
    goalTime,
    goalPaceMin,
    fitness,
    baseMPW,
    peakMPW,
    totalWeeks: weeksUntil,
    lthr: estimatedLTHR,
    itbsHistory
  });

  // Save plan
  const plans = JSON.parse(localStorage.getItem('runplan_plans') || '[]');
  const planSummary = {
    id: planId,
    raceName,
    raceDate,
    goalTime,
    goalPace: formatPace(goalPaceMin),
    fitness,
    baseMPW,
    peakMPW,
    totalWeeks: weeksUntil,
    lthr: estimatedLTHR,
    itbsHistory,
    createdAt: new Date().toISOString()
  };
  plans.push(planSummary);
  localStorage.setItem('runplan_plans', JSON.stringify(plans));

  closeCreatePlanModal();
  activatePlan(planId);
  showToast(`Plan created: ${raceName} — ${weeksUntil} weeks, ${baseMPW}-${peakMPW} mpw`);
}

// ===== TOAST =====
function showToast(message) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function buildPlanDefinition(params) {
  // Generates a full 22-week training structure as trainingDays array
  // Uses the same PLAN_DEFINITION structure but generates from params
  const { planId, raceName, raceDate, goalTime, goalPaceMin, fitness, baseMPW, peakMPW, totalWeeks, lthr, itbsHistory } = params;
  const z2Ceiling = Math.round(lthr * 0.89);
  const mPace = formatPace(goalPaceMin);
  const tPace = formatPace(goalPaceMin * 0.95); // ~5% faster than goal
  const iPace = formatPace(goalPaceMin * 0.88); // ~12% faster

  // Build weeks array
  const days = [];
  const startDate = new Date();
  // Actually build from race date backwards, then reverse
  const race = new Date(raceDate);

  // Build from scratch — generate all days
  const phaseLengths = [6, 6, 3, 3, 3, 1]; // P1-P5 + race week
  let weekNum = 1;

  for (let w = 0; w < Math.min(totalWeeks, 22); w++) {
    weekNum = w + 1;
    const isDeload = (weekNum === 4 || weekNum === 10 || weekNum === 16 || weekNum === 20);
    const mpw = Math.min(baseMPW + Math.floor(weekNum / 2) * 2, peakMPW);
    const adjustedMPW = isDeload ? Math.round(mpw * 0.75) : mpw;

    const phase = weekNum <= 6 ? 1 : weekNum <= 12 ? 2 : weekNum <= 15 ? 3 : weekNum <= 18 ? 4 : weekNum <= 21 ? 5 : 6;

    const weekDays = generateWeekDays(weekNum, phase, adjustedMPW, lthr, z2Ceiling, mPace, tPace, iPace, itbsHistory, fitness);
    days.push(...weekDays);
  }

  return days;
}

function generateWeekDays(weekNum, phase, mpw, lthr, z2Ceiling, mPace, tPace, iPace, itbsHistory, fitness) {
  // Generates 7 days for a given week
  // Phase determines the quality days and structure
  const templates = {
    1: { mon: 'Rest', tue: 'Easy', wed: 'Rest', thu: 'Easy', fri: 'Rest', sat: 'Long', sun: 'Easy' },
    2: { mon: 'Rest', tue: 'Intervals', wed: 'Easy', thu: 'Tempo', fri: 'Rest', sat: 'Long', sun: 'Easy' },
    3: { mon: 'Rest', tue: 'VO2max', wed: 'Easy', thu: 'Tempo', fri: 'Rest', sat: 'Long', sun: 'Easy' },
    4: { mon: 'Rest', tue: 'Easy', wed: 'Easy', thu: 'Easy', fri: 'Rest', sat: 'Long', sun: 'Easy' },
    5: { mon: 'Rest', tue: 'Easy', wed: 'Strides', thu: 'Easy', fri: 'Rest', sat: 'RACE', sun: 'Easy' },
    6: { mon: 'Rest', tue: 'Easy', wed: 'Easy', thu: 'Easy', fri: 'Rest', sat: 'Long', sun: 'Easy' }
  };

  const dayTypes = templates[phase] || templates[1];
  const results = [];

  const dayMap = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Calculate what day of the week the race starts on, work backwards
  const raceDate = new Date(window.PLAN_DEFINITION?.meta?.raceDate || new Date());
  // Use actual week starting date based on current date
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  monday.setDate(monday.getDate() + (weekNum - 1) * 7);

  Object.entries(dayTypes).forEach(([dow, type]) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + dayMap[dow]);

    let dist = '-';
    let description = '';

    if (type === 'Easy') {
      dist = phase <= 2 ? '5-6' : phase >= 5 ? '3-4' : '5-7';
      description = `Easy run | HR Z2 (<${z2Ceiling})`;
    } else if (type === 'Long') {
      dist = phase <= 2 ? '10-12' : phase >= 5 ? '8-10' : '12-18';
      description = `Long run | HR Z2 | Fuel water every 20 min`;
    } else if (type === 'Intervals') {
      dist = '6-8';
      description = `${fitness === 'advanced' ? '6x1000m' : fitness === 'intermediate' ? '5x800m' : '4x800m'} @ I-pace ${iPace}`;
    } else if (type === 'Tempo') {
      dist = '6-8';
      description = `${phase <= 3 ? '25-30 min' : '20 min'} @ LTHR ${lthr} bpm`;
    } else if (type === 'VO2max') {
      dist = '6-7';
      description = `4x400m @ 3K pace (76-78 sec) | Recovery 400m jog`;
    } else if (type === 'Strides') {
      dist = '4-5';
      description = `Easy + 4x20sec strides`;
    } else if (type === 'RACE') {
      dist = '26.2';
      description = `RACE DAY — ${mPace}/mi goal`;
    }

    results.push({
      date: d.toISOString().split('T')[0],
      week: weekNum,
      day: dayNames[dayMap[dow]],
      phase: `Phase ${phase}`,
      mpw: Math.round(parseInt(dist) || 6),
      type,
      workout: description,
      description,
      dist,
      components: itbsHistory ? ['ITBS'] : []
    });
  });

  return results;
}

function formatPace(minPerMile) {
  const m = Math.floor(minPerMile);
  const s = Math.round((minPerMile - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function activatePlan(planId) {
  localStorage.setItem('runplan_active_plan', planId);
  const plans = JSON.parse(localStorage.getItem('runplan_plans') || '[]');
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;

  // Build trainingDays for this plan and load into state
  const days = buildPlanDefinition({
    planId: plan.id,
    raceName: plan.raceName,
    raceDate: plan.raceDate,
    goalTime: plan.goalTime,
    goalPaceMin: timeToMin(plan.goalTime) / 26.2,
    fitness: plan.fitness,
    baseMPW: plan.baseMPW,
    peakMPW: plan.peakMPW,
    totalWeeks: plan.totalWeeks,
    lthr: plan.lthr || Math.round((220 - 32) * 0.92),
    itbsHistory: plan.itbsHistory
  });

  state.trainingDays = days;
  state.lastSynced = new Date();
  updateCurrentDay();
  saveToStorage();
  renderToday();
  switchTab('today');

  // Update document title
  document.title = `RunPlan — ${plan.raceName}`;
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.log('SW registration failed:', e));
}
