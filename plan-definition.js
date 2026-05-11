// plan-definition.js
// Complete 22-week Victoria Marathon 2026 training plan
// Phase structure: Base → Threshold → VO2max → Recovery → Taper → Race
// Each week has: phase, week, focus, keyWorkout, targetMPW, quality, adaptationRate

const PLAN_DEFINITION = {
  meta: {
    raceDate: '2026-10-11',
    goalPace: { target: '7:30/mi', sub3: '7:10/mi', realistic: '8:00/mi' },
    lthr: 171,
    z2Ceiling: 152,
    phaseCount: 6
  },

  phases: [
    {
      id: 'phase1',
      name: 'Phase 1 — Base Building',
      weeks: [1, 2, 3, 4, 5, 6],
      focus: 'Aerobic foundation, ITBS prevention, cadence development',
      quality: 'low',
      targetMPWRange: [26, 42],
      intensityDistribution: { Z2: 85, Z4: 10, Z5: 5 },
      description: 'Build the aerobic base. Easy miles, ITBS activation circuits, strides. All quality should feel easy.',
      adaptationRules: {
        if: { type: 'workout_completion', rate: 'below_80pct' },
        then: { extendPhaseBy: 1, reduceMPWBy: 10 },
        priority: 'high'
      }
    },
    {
      id: 'phase2',
      name: 'Phase 2 — Norwegian Singles',
      weeks: [7, 8, 9, 10, 11, 12],
      focus: 'Lactate threshold (LTHR), VO2max introduction, hill sprints',
      quality: 'medium',
      targetMPWRange: [36, 50],
      intensityDistribution: { Z2: 70, Z4: 20, Z5: 10 },
      description: 'Hard days harder. Introduce sustained threshold work at LTHR 171. Two quality days per week.',
      adaptationRules: {
        if: { type: 'checkpoint', name: 'yasso_result', betterThan: '3:05_avg' },
        then: { advancePhase3: true, increaseMPW: 5 },
        if: { type: 'checkpoint', name: 'yasso_result', worseThan: '3:45_avg' },
        then: { extendPhase1: true, delayPhase2Start: 1 }
      }
    },
    {
      id: 'phase3',
      name: 'Phase 3 — Peak Volume',
      weeks: [13, 14, 15],
      focus: 'VO2max sharpening, marathon pace work, race simulation',
      quality: 'high',
      targetMPWRange: [46, 50],
      intensityDistribution: { Z2: 60, Z4: 25, Z5: 15 },
      description: 'Sharpest training. Yasso 800s, 5x1000m intervals, marathon pace blocks. Peak fitness phase.',
      adaptationRules: {
        if: { type: 'checkpoint', name: 'bellwether_result', clean: true },
        then: { confirmMPGoal: true },
        if: { type: 'checkpoint', name: 'race_sim_result', hrExceeds: 174 },
        then: { reduceMPaceBy: 5 }
      }
    },
    {
      id: 'phase4',
      name: 'Phase 4 — Recovery',
      weeks: [16, 17, 18],
      focus: 'Recovery from Phase 3, race sim @ Week 17, maintain fitness',
      quality: 'low',
      targetMPWRange: [32, 38],
      intensityDistribution: { Z2: 75, Z4: 15, Z5: 10 },
      description: 'Cutback weeks. Protect Phase 3 gains. Race sim @ Week 17 is the final quality session before taper.',
      adaptationRules: {
        if: { type: 'fatigue', accumulatedWeeks: 3 },
        then: { extendPhase4By: 1, reduceIntensityBy: 20 }
      }
    },
    {
      id: 'phase5',
      name: 'Phase 5 — Pre-Race',
      weeks: [19, 20, 21],
      focus: 'Sharpen, final tune-up, taper volume',
      quality: 'medium',
      targetMPWRange: [30, 18],
      intensityDistribution: { Z2: 50, Z4: 30, Z5: 20 },
      description: 'Volume drops sharply. Quality over quantity. Final week is pure rest and race prep.',
      adaptationRules: {
        if: { type: 'week', is: 20 },
        then: { zeroQuality: true, maxMPW: 18 }
      }
    },
    {
      id: 'race_week',
      name: 'Race Week',
      weeks: [22],
      focus: 'Rest, race day, recovery',
      quality: 'race',
      targetMPWRange: [15, 15],
      intensityDistribution: { Z2: 30, Z4: 20, Z5: 0 },
      description: 'Final week. Easy runs Mon/Tue. Race Saturday. Very easy after.'
    }
  ],

  // Weekly template — day structure by phase type
  weeklyTemplates: {
    phase1: {
      mon: { type: 'Rest', description: 'Full rest or cross-training' },
      tue: { type: 'Strides', description: 'Easy + 4x20sec strides', quality: 'low' },
      wed: { type: 'Easy', description: 'Base run Z2', quality: 'low' },
      thu: { type: 'Easy', description: 'Base run + ITBS activation', quality: 'low' },
      fri: { type: 'Rest', description: 'Recovery day' },
      sat: { type: 'Long', description: 'Long run Z2', quality: 'medium' },
      sun: { type: 'Easy', description: 'Recovery easy run', quality: 'low' }
    },
    phase2: {
      mon: { type: 'Rest', description: 'Full rest' },
      tue: { type: 'VO2max', description: 'Intervals (800m-1000m)', quality: 'high' },
      wed: { type: 'Easy', description: 'Easy Z2 with tempo block', quality: 'low' },
      thu: { type: 'Tempo', description: 'LTHR 171 bpm (ignore pace, hold HR)', quality: 'high' },
      fri: { type: 'Rest', description: 'Recovery' },
      sat: { type: 'Long', description: 'Long run Z2', quality: 'medium' },
      sun: { type: 'Easy', description: 'Recovery run', quality: 'low' }
    },
    phase3: {
      mon: { type: 'Rest', description: 'Full rest' },
      tue: { type: 'VO2max', description: 'Intervals or Yasso 800s', quality: 'high' },
      wed: { type: 'Easy', description: 'Easy + strides', quality: 'low' },
      thu: { type: 'Tempo', description: 'LTHR or M-pace block', quality: 'high' },
      fri: { type: 'Rest', description: 'Recovery' },
      sat: { type: 'Long', description: 'Long run or Race Sim', quality: 'high' },
      sun: { type: 'Easy', description: 'Recovery easy', quality: 'low' }
    },
    phase4: {
      mon: { type: 'Rest', description: 'Full rest' },
      tue: { type: 'Easy', description: 'Easy run or strides', quality: 'low' },
      wed: { type: 'Easy', description: 'Easy Z2', quality: 'low' },
      thu: { type: 'Tempo', description: 'Reduced threshold (60-70% normal)', quality: 'medium' },
      fri: { type: 'Rest', description: 'Recovery' },
      sat: { type: 'Long', description: 'Long run (reduced distance)', quality: 'medium' },
      sun: { type: 'Easy', description: 'Easy recovery', quality: 'low' }
    },
    phase5: {
      mon: { type: 'Rest', description: 'Final rest day' },
      tue: { type: 'Easy', description: 'Very easy 3-4 mi', quality: 'low' },
      wed: { type: 'Strides', description: '4x20sec strides only', quality: 'low' },
      thu: { type: 'Easy', description: 'Easy 3 mi shakeout', quality: 'low' },
      fri: { type: 'Rest', description: 'Race prep rest', quality: 'none' },
      sat: { type: 'RACE', description: 'RACE DAY', quality: 'race' },
      sun: { type: 'Easy', description: 'Recovery if needed', quality: 'low' }
    }
  },

  // Checkpoints — calibration events
  checkpoints: [
    {
      id: 'yasso',
      week: 6,
      name: 'Yasso 800s',
      description: '10x800m @ 5K effort (3:22 target avg)',
      decisionCriteria: [
        { if: 'avg < 3:05', then: 'sub-3:05 confirmed — raise target pace to 7:10/mi' },
        { if: 'avg 3:05-3:22', then: 'on track for sub-3:05 — hold current targets' },
        { if: 'avg 3:22-3:45', then: 'recalibrate to 3:30-3:45 realistic — lower M-pace to 8:00/mi' },
        { if: 'avg > 3:45', then: 'extend Phase 1, delay Phase 2 by 1 week, lower target' }
      ],
      adaptationFlags: ['VO2max_calibrated', 'targetPace_confirmed']
    },
    {
      id: 'bellwether',
      week: 13,
      name: 'Bellwether 10K',
      description: '5K @ threshold → 5min jog → 5K @ M-pace',
      decisionCriteria: [
        { if: 'both 5Ks clean', then: 'goal on track — confirm 7:30/mi target' },
        { if: '2nd blows up', then: 'recalibrate M-pace — likely 8:00/mi realistic' },
        { if: 'HR exceeds 174', then: 'reduce M-pace by 5 sec/mi' }
      ],
      adaptationFlags: ['threshold_calibrated', 'mPace_confirmed']
    },
    {
      id: 'race_sim',
      week: 14,
      name: 'Race Simulation',
      description: '22-mi sim: 10mi Z2 → 8mi M-pace → 2mi cooldown',
      decisionCriteria: [
        { if: 'HR <174, pace 7:10-7:15/mi', then: '3:05 confirmed — hold' },
        { if: 'HR <174, pace 7:30/mi', then: '3:30 realistic — lower target' },
        { if: 'HR >174 or blows up', then: 'extend Phase 2, reduce M-pace by 10 sec/mi' }
      ],
      adaptationFlags: ['mPace_locked', 'fitness_confirmed']
    }
  ],

  // Key principles (never adapt these)
  constraints: {
    minPhase1Weeks: 4,       // Must have at least 4 weeks base before quality
    maxQualityPerWeek: 3,     // Never more than 3 hard sessions per week
    minRecoveryAfterQuality: 1, // 1 rest day after VO2max sessions
    itbsCircuitRequired: true,  // ITBS activation always before runs
    deloadEvery4Weeks: true,    // Reduce volume/intensity every 4th week
    longRunMinDistance: 12,   // Minimum long run for marathon benefit
    taperVolumeDrop: 40       // Phase 5 must drop volume by 40% vs Phase 3 peak
  },

  // Quality session types with priority ordering
  qualityPriority: [
    'Race Sim',   // Highest — most marathon-specific
    'Yasso',      // Lactate buffering
    'VO2max',     // VO2max development
    'Tempo',      // LTHR threshold
    'T-Pace',     // Threshold cruise
    'Cruise',     // Alternative threshold
    'Long',       // Aerobic endurance
    'Progressive',// Race-pace practice
    'Strides',    // Neuromuscular
    'Easy'        // Base building
  ]
};

// Export for use in app.js
window.PLAN_DEFINITION = PLAN_DEFINITION;