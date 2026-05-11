// athlete-profile.js
// Alex's calibrated athlete profile — evolves with checkpoint results and feedback
// This is the "truth" that drives plan decisions

const ATHLETE_PROFILE = {
  // Identity
  name: 'Alex Frederick',
  raceDate: '2026-10-11',
  currentDate: () => new Date().toISOString().split('T')[0],

  // Biomechanical measurements (lab-tested or observed — fixed or slowly changing)
  biometrics: {
    lthr: 171,           // Lab-tested — never changes
    restingHR: 52,       // Observed — slow drift over months
    z2Ceiling: 152,      // Corrected from 139 — locked
    maxHR: 192,          // Estimated (220-age)
    marathon_pace_estimate: '8:30/mi', // Adjusts based on checkpoints
    vo2maxEstimate: 48   // Estimated from LTHR and recent performance
  },

  // Performance history — updated at checkpoints
  performance: {
    currentMarathonFitness: '4:10-4:20',   // From easy runs — recalibrates
    targetPace: '7:30/mi',                 // Current target — adjusts after checkpoints
    goalPace: '7:10/mi',                   // Dream goal (sub-3:05)
    realisticPace: '8:00/mi',              // 3:30-3:45 realistic
    cadence: { current: 81, target: 90 }, // Observed → goal
    itbsStatus: 'managed',                 // Currently managed/dormant
    recentRaces: []                        // [ { race, date, time, pace } ]
  },

  // Adaptation parameters — inferred from RPE and workout completion
  adaptation: {
    recoveryRate: 'moderate',   // slow | moderate | fast
    injuryRisk: 'moderate',     // low | moderate | high
    qualityAbsorption: 'good',  // poor | good | excellent
    fatigueFloor: 3,            // RPE below this for 3+ weeks triggers deload
    weeklyMissThreshold: 2,     // 2+ missed workouts/week for 2 weeks → deload
    rpeDriftThreshold: 2       // RPE consistently 2+ below plan → increase intensity
  },

  // Phase state — tracks where athlete is relative to plan
  phase: {
    current: 'phase1',
    weekInPhase: 1,
    totalWeeksTrained: 0,
    blocked: false,
    blockReason: null
  },

  // Checkpoint results — updated when checkpoints are completed
  checkpoints: {
    yasso: {
      completed: false,
      date: null,
      avgTime: null,
      verdict: null,        // 'sub_3_05' | 'on_track' | 'recalibrate' | 'extend'
      notes: null
    },
    bellwether: {
      completed: false,
      date: null,
      first5K: null,
      second5K: null,
      verdict: null,
      notes: null
    },
    race_sim: {
      completed: false,
      date: null,
      avgPace: null,
      avgHR: null,
      verdict: null,        // 'confirmed_3_05' | '3_30_realistic' | 'extend_phase2'
      notes: null
    }
  },

  // Running history — longitudinal data
  history: {
    previousMarathon: { time: '3:20', date: '2024-10', race: 'Victoria 2024' },
    itbsHistory: true,
    strengthBackground: 'beginner',  // beginner | intermediate | advanced
    runningYears: 3
  },

  // Goals — can be updated by user
  goals: {
    target: 'sub_3_05',
    targetTime: '3:05:00',
    targetPace: '7:10/mi',
    realistic: '3:30',
    stretch: '2:58',
    priority: 'a'  // a = primary goal
  },

  // Current plan version — tracks adjustments
  planVersion: 1,
  lastAdapted: null,
  adaptationLog: [] // { date, reason, change, verdict }
};

// Helper functions
window.athleteProfile = {
  getCurrentPhase: () => this.currentPhase,
  getWeekInPhase: () => this.weekInPhase,
  isCheckpointsComplete: () => {
    const cp = ATHLETE_PROFILE.checkpoints;
    return cp.yasso.completed && cp.bellwether.completed && cp.race_sim.completed;
  },

  updateCheckpoint: (id, data) => {
    const cp = ATHLETE_PROFILE.checkpoints[id];
    if (!cp) return;
    Object.assign(cp, data);
    cp.date = new Date().toISOString().split('T')[0];
    ATHLETE_PROFILE.lastAdapted = cp.date;
    ATHLETE_PROFILE.adaptationLog.push({
      date: cp.date,
      type: 'checkpoint',
      checkpoint: id,
      ...data
    });
    localStorage.setItem('athlete_profile', JSON.stringify(ATHLETE_PROFILE));
  },

  updateGoal: (newGoal) => {
    const prev = { ...ATHLETE_PROFILE.goals };
    Object.assign(ATHLETE_PROFILE.goals, newGoal);
    ATHLETE_PROFILE.planVersion++;
    ATHLETE_PROFILE.adaptationLog.push({
      date: new Date().toISOString().split('T')[0],
      type: 'goal_change',
      from: prev,
      to: newGoal
    });
    localStorage.setItem('athlete_profile', JSON.stringify(ATHLETE_PROFILE));
  },

  load: () => {
    const stored = localStorage.getItem('athlete_profile');
    if (stored) {
      const parsed = JSON.parse(stored);
      Object.assign(ATHLETE_PROFILE, parsed);
    }
  },

  save: () => {
    localStorage.setItem('athlete_profile', JSON.stringify(ATHLETE_PROFILE));
  }
};