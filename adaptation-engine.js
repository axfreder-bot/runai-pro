// adaptation-engine.js
// Rules engine that processes athlete feedback and checkpoint results
// Produces adaptation recommendations for the training plan

window.AdaptationEngine = {
  // Evaluate all adaptation rules against current state
  evaluate: (athlete, trainingDays) => {
    const recommendations = [];
    const currentWeek = athlete.phase?.totalWeeksTrained || getCurrentWeekFromDays(trainingDays);
    const phase = athlete.phase?.current || 'phase1';

    // 1. Check fatigue accumulation (RPE pattern)
    const fatigueRec = checkFatigue(athlete, trainingDays);
    if (fatigueRec) recommendations.push(fatigueRec);

    // 2. Check missed workouts pattern
    const missedRec = checkMissedWorkouts(athlete, trainingDays);
    if (missedRec) recommendations.push(missedRec);

    // 3. Check adaptation rate (RPE too easy consistently)
    const rpeRec = checkRPEAdaptation(athlete, trainingDays);
    if (rpeRec) recommendations.push(rpeRec);

    // 4. Check checkpoint results (if applicable)
    const cpRec = checkCheckpoints(athlete);
    if (cpRec) recommendations.push(cpRec);

    // 5. Check goal changes
    const goalRec = checkGoalChange(athlete);
    if (goalRec) recommendations.push(goalRec);

    // 6. Check phase progression gates
    const gateRec = checkPhaseGates(athlete, trainingDays);
    if (gateRec) recommendations.push(gateRec);

    return recommendations;
  },

  // Generate a specific adaptation recommendation
  generateRecommendation: (type, params, athlete) => {
    switch (type) {
      case 'extend_phase':
        return {
          type: 'extend_phase',
          phase: params.phase,
          extendBy: params.weeks || 1,
          reason: params.reason,
          mpwChange: params.mpwChange || 0,
          priority: params.priority || 'medium'
        };

      case 'reduce_intensity':
        return {
          type: 'reduce_intensity',
          reduceBy: params.pct || 15,
          reason: params.reason,
          affectedWeeks: params.weeks || [params.week],
          priority: params.priority || 'medium'
        };

      case 'increase_intensity':
        return {
          type: 'increase_intensity',
          increaseBy: params.pct || 10,
          reason: params.reason,
          affectedWeeks: params.weeks,
          priority: params.priority || 'low'
        };

      case 'recalibrate_pace':
        return {
          type: 'recalibrate_pace',
          newPace: params.newPace,
          reason: params.reason,
          source: params.source,
          priority: params.priority || 'high'
        };

      case 'deload':
        return {
          type: 'deload',
          reduceMPWBy: params.mpwPct || 20,
          reduceIntensityBy: params.intPct || 30,
          weeks: params.weeks || 1,
          reason: params.reason,
          priority: params.priority || 'high'
        };

      case 'advance_phase':
        return {
          type: 'advance_phase',
          from: params.from,
          to: params.to,
          reason: params.reason,
          priority: params.priority || 'medium'
        };

      case 'delay_phase':
        return {
          type: 'delay_phase',
          phase: params.phase,
          delayBy: params.weeks || 1,
          reason: params.reason,
          priority: params.priority || 'high'
        };

      case 'confirm_target':
        return {
          type: 'confirm_target',
          targetPace: params.pace,
          reason: params.reason,
          confidence: params.confidence || 'high',
          priority: 'low'
        };

      default:
        return null;
    }
  },

  // Apply a recommendation to the plan (returns modified plan sections)
  applyRecommendation: (rec, phaseDefinitions, currentPhaseWeek) => {
    switch (rec.type) {
      case 'extend_phase':
        return applyExtendPhase(rec, phaseDefinitions);
      case 'reduce_intensity':
        return applyReduceIntensity(rec, currentPhaseWeek);
      case 'recalibrate_pace':
        return applyRecalibratePace(rec);
      case 'deload':
        return applyDeload(rec, currentPhaseWeek);
      case 'advance_phase':
        return applyAdvancePhase(rec, phaseDefinitions);
      case 'delay_phase':
        return applyDelayPhase(rec, phaseDefinitions);
      default:
        return null;
    }
  },

  // Summarize recommendation in plain language
  summarize: (rec) => {
    switch (rec.type) {
      case 'extend_phase':
        return `Extend ${rec.phase} by ${rec.extendBy} week(s). ${rec.reason}. MPW ${rec.mpwChange > 0 ? '+' + rec.mpwChange : rec.mpwChange}%.`;
      case 'reduce_intensity':
        return `Reduce intensity by ${rec.reduceBy}%. ${rec.reason}.`;
      case 'recalibrate_pace':
        return `Adjust target marathon pace to ${rec.newPace}. ${rec.reason}.`;
      case 'deload':
        return `Deload week(s): reduce volume ${rec.reduceMPWBy}% and intensity ${rec.reduceIntensityBy}%. ${rec.reason}.`;
      case 'advance_phase':
        return `Advance to next phase. ${rec.reason}.`;
      case 'delay_phase':
        return `Delay ${rec.phase} start by ${rec.delayBy} week(s). ${rec.reason}.`;
      case 'confirm_target':
        return `Confirm target pace of ${rec.targetPace}. ${rec.reason}.`;
      default:
        return `Recommendation: ${rec.type}`;
    }
  }
};

// --- Private evaluation helpers ---

function checkFatigue(athlete, trainingDays) {
  // Get last 3 weeks of RPE data
  const recentDays = getRecentDays(trainingDays, 21); // 3 weeks
  const rpeValues = recentDays.map(d => d.rpe).filter(r => r != null);
  if (rpeValues.length < 5) return null;

  const avgRPE = rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length;
  const planAvgRPE = 5.5; // Expected average RPE for quality days

  // Fatigue: RPE consistently 2+ points below plan
  if (avgRPE <= planAvgRPE - 2) {
    return AdaptationEngine.generateRecommendation('deload', {
      mpwPct: 20,
      intPct: 30,
      weeks: 1,
      reason: `Average RPE ${avgRPE.toFixed(1)} is 2+ points below plan (${planAvgRPE}). Possible overreaching.`,
      priority: 'high'
    }, athlete);
  }

  return null;
}

function checkMissedWorkouts(athlete, trainingDays) {
  const recentDays = getRecentDays(trainingDays, 14); // 2 weeks
  const missedPerWeek = [];
  for (let w = 0; w < 2; w++) {
    const weekDays = recentDays.slice(w * 7, (w + 1) * 7);
    const missed = weekDays.filter(d => d.skipped || d.type === 'Skipped').length;
    missedPerWeek.push(missed);
  }

  if (missedPerWeek[0] >= 2 && missedPerWeek[1] >= 2) {
    return AdaptationEngine.generateRecommendation('deload', {
      mpwPct: 15,
      intPct: 20,
      weeks: 1,
      reason: `Missed ${missedPerWeek[0]} workouts week 1 and ${missedPerWeek[1]} week 2. Fatigue or life interference.`,
      priority: 'high'
    }, athlete);
  }

  return null;
}

function checkRPEAdaptation(athlete, trainingDays) {
  const recentDays = getRecentDays(trainingDays, 14);
  const qualityDays = recentDays.filter(d => ['Tempo', 'VO2max', 'Yasso', 'Intervals', 'Long', 'Race Sim'].includes(d.type));
  if (qualityDays.length < 3) return null;

  const avgRPE = qualityDays.reduce((a, d) => a + (d.rpe || 5), 0) / qualityDays.length;
  const planRPE = 6.5; // Quality days should feel ~6.5 RPE when appropriate

  // RPE consistently 2+ below plan → increasing fitness, can add intensity
  if (avgRPE <= planRPE - 2) {
    return AdaptationEngine.generateRecommendation('increase_intensity', {
      pct: 10,
      weeks: getNextWeeks(trainingDays, 2),
      reason: `Quality session RPE avg ${avgRPE.toFixed(1)} is well below expected ${planRPE}. Adapting faster than plan. Add 10% intensity.`,
      priority: 'medium'
    }, athlete);
  }

  return null;
}

function checkCheckpoints(athlete) {
  const cp = athlete.checkpoints;
  const today = new Date().toISOString().split('T')[0];

  // Yasso 800s (Week 6)
  if (cp.yasso.completed && cp.yasso.avgTime) {
    const avg = parseTimeToMin(cp.yasso.avgTime);
    if (avg < 185) { // < 3:05
      return AdaptationEngine.generateRecommendation('recalibrate_pace', {
        newPace: '7:10/mi',
        reason: `Yasso avg ${cp.yasso.avgTime} (< 3:05) = sub-3:05 territory confirmed. Target pace raised to 7:10/mi.`,
        source: 'yasso',
        priority: 'high'
      }, athlete);
    } else if (avg > 225) { // > 3:45
      return AdaptationEngine.generateRecommendation('delay_phase', {
        phase: 'phase2',
        weeks: 1,
        reason: `Yasso avg ${cp.yasso.avgTime} (> 3:45). Current fitness below plan. Delay Phase 2 by 1 week.`,
        priority: 'high'
      }, athlete);
    }
  }

  // Race Sim (Week 14)
  if (cp.race_sim.completed && cp.race_sim.avgPace && cp.race_sim.avgHR) {
    const paceMin = parsePaceToMin(cp.race_sim.avgPace);
    const hr = cp.race_sim.avgHR;
    if (hr > 174 || paceMin > 450) { // HR over 174 or pace slower than 7:30/mi
      return AdaptationEngine.generateRecommendation('recalibrate_pace', {
        newPace: hr > 174 ? '8:00/mi' : '7:40/mi',
        reason: `Race sim HR ${hr} bpm${hr > 174 ? ' (exceeds 174)' : ''}, pace ${cp.race_sim.avgPace}. Recalibrate target.`,
        source: 'race_sim',
        priority: 'high'
      }, athlete);
    } else {
      return AdaptationEngine.generateRecommendation('confirm_target', {
        pace: '7:30/mi',
        reason: `Race sim HR ${hr} bpm, pace ${cp.race_sim.avgPace} = 3:05 on track. Confirm 7:30/mi target.`,
        confidence: 'high',
        priority: 'medium'
      }, athlete);
    }
  }

  return null;
}

function checkGoalChange(athlete) {
  // Check if goals have changed — handled via explicit goal update events
  return null;
}

function checkPhaseGates(athlete, trainingDays) {
  // Phase progression gate: must complete ITBS circuits consistently before advancing
  // This is a soft gate — just a notification
  const phase = athlete.phase?.current;
  const week = athlete.phase?.totalWeeksTrained || 1;

  if (phase === 'phase1' && week >= 6) {
    const recentDays = getRecentDays(trainingDays, 42);
    const itbsDone = recentDays.filter(d => d.components && d.components.includes('ITBS')).length;
    const pct = (itbsDone / 42 * 100).toFixed(0);
    if (itbsDone < 30) {
      return {
        type: 'warning',
        message: `ITBS activation done only ${pct}% of last 6 weeks. Phase 2 introduces harder quality — ensure ITBS circuit consistency before advancing.`,
        priority: 'medium'
      };
    }
  }

  return null;
}

// --- Helpers ---

function getRecentDays(trainingDays, count) {
  const sorted = [...trainingDays].sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted.slice(0, count);
}

function getNextWeeks(trainingDays, count) {
  const today = new Date().toISOString().split('T')[0];
  const upcoming = trainingDays
    .filter(d => d.date >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const weeks = [...new Set(upcoming.map(d => d.week))].slice(0, count);
  return weeks;
}

function getCurrentWeekFromDays(trainingDays) {
  const today = new Date().toISOString().split('T')[0];
  const todayDay = trainingDays.find(d => d.date === today);
  return todayDay ? todayDay.week : 1;
}

function parseTimeToMin(timeStr) {
  // "3:22" → 202 seconds
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [m, s] = timeStr.split(':').map(Number);
  return m * 60 + s;
}

function parsePaceToMin(paceStr) {
  // "7:30/mi" → 450 seconds
  if (!paceStr || typeof paceStr !== 'string') return null;
  const match = paceStr.match(/(\d+):(\d+)/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

// --- Apply recommendation helpers ---

function applyExtendPhase(rec, phaseDefs) {
  const phase = phaseDefs.find(p => p.id === rec.phase);
  if (phase) {
    const lastWeek = phase.weeks[phase.weeks.length - 1];
    phase.weeks.push(lastWeek + 1);
    phase.targetMPWRange = phase.targetMPWRange.map(m => m + (rec.mpwChange || 0));
  }
  return phaseDefs;
}

function applyReduceIntensity(rec, currentPhaseWeek) {
  // Mark specific weeks for reduced intensity
  return rec.affectedWeeks.map(w => ({ week: w, intensityFactor: 1 - rec.reduceBy / 100 }));
}

function applyRecalibratePace(rec) {
  return { targetPace: rec.newPace };
}

function applyDeload(rec, currentPhaseWeek) {
  return rec.affectedWeeks.map(w => ({
    week: w,
    mpwFactor: 1 - rec.reduceMPWBy / 100,
    intensityFactor: 1 - rec.reduceIntensityBy / 100
  }));
}

function applyAdvancePhase(rec, phaseDefs) {
  // Phase advancement is mostly informational — plan structure stays
  return phaseDefs;
}

function applyDelayPhase(rec, phaseDefs) {
  // Insert a buffer week at start of specified phase
  return phaseDefs;
}

// Export
window.AdaptationEngine = AdaptationEngine;