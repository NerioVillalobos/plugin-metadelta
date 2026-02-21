import {EVENT_SEVERITY, RISK_LEVELS} from './constants.js';

function severityToScore(type) {
  return EVENT_SEVERITY[type] ?? 1;
}

export function scoreEvents(events) {
  const totals = {
    score: 0,
    byType: {}
  };
  for (const event of events) {
    const eventScore = severityToScore(event.type);
    totals.score += eventScore;
    totals.byType[event.type] = (totals.byType[event.type] ?? 0) + eventScore;
  }
  const level = determineRiskLevel(totals.score);
  return {
    score: totals.score,
    level,
    byType: totals.byType
  };
}

export function determineRiskLevel(score) {
  if (score >= 35) {
    return RISK_LEVELS[3];
  }
  if (score >= 20) {
    return RISK_LEVELS[2];
  }
  if (score >= 8) {
    return RISK_LEVELS[1];
  }
  return RISK_LEVELS[0];
}
