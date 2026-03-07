"use strict";

const ACTIONABLE_STAGES = new Set(["trigger", "in_trade", "tp_zone"]);
const BLOCKING_MISMATCH_FLAGS = new Set(["confidence_vs_pattern_conflict", "bias_conflict"]);
const REQUIRED_MISSING_FIELDS = new Set(["setup_id", "pattern_type", "setup_stage", "pattern_bias", "score", "confluence", "bias"]);

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value, fallback = "") {
  const v = String(value || "").trim();
  return v ? v.toUpperCase() : fallback;
}

function toLower(value, fallback = "") {
  const v = String(value || "").trim();
  return v ? v.toLowerCase() : fallback;
}

function hasNumericLevels(levels) {
  return numberOrNull(levels?.entry) !== null && numberOrNull(levels?.stop) !== null;
}

function hasBlockingMissingFields(missingFields) {
  const fields = Array.isArray(missingFields) ? missingFields : [];
  return fields.some((field) => REQUIRED_MISSING_FIELDS.has(field));
}

function hasBlockingMismatchFlags(mismatchFlags) {
  const flags = Array.isArray(mismatchFlags) ? mismatchFlags : [];
  return flags.some((flag) => BLOCKING_MISMATCH_FLAGS.has(flag));
}

function computeDirectionScore(packet) {
  const reasons = [];
  let score = 0;

  const bias = toUpper(packet?.bias, "NEUTRAL");
  const manualBias = toLower(packet?.pattern?.manual_bias, "neutral");
  const manualConfirmed = !!packet?.pattern?.manual_confirmed;
  const autoAligned = !!packet?.pattern?.auto_aligned;
  const autoBias = toLower(packet?.pattern?.auto_bias, "neutral");
  const rsi = numberOrNull(packet?.momentum?.rsi);
  const macdHist = numberOrNull(packet?.momentum?.macd_hist);
  const squeezeRelease = !!packet?.momentum?.squeeze_release;

  if (bias === "BULLISH") score += 2;
  if (bias === "BEARISH") score -= 2;

  if (manualBias === "bullish") score += 2;
  if (manualBias === "bearish") score -= 2;

  if (manualConfirmed && manualBias === "bullish") score += 1;
  if (manualConfirmed && manualBias === "bearish") score -= 1;

  if (autoAligned && autoBias === "bullish") score += 1;
  if (autoAligned && autoBias === "bearish") score -= 1;

  if (rsi !== null && rsi >= 52) score += 1;
  if (rsi !== null && rsi <= 48) score -= 1;

  if (macdHist !== null && macdHist > 0) score += 1;
  if (macdHist !== null && macdHist < 0) score -= 1;

  if (squeezeRelease && macdHist !== null && macdHist > 0) score += 1;
  if (squeezeRelease && macdHist !== null && macdHist < 0) score -= 1;

  if (macdHist !== null && rsi !== null) {
    const momentumAlignedBull = macdHist > 0 && rsi >= 52;
    const momentumAlignedBear = macdHist < 0 && rsi <= 48;
    if (momentumAlignedBull || momentumAlignedBear) {
      reasons.push("momentum_confirms");
    } else {
      reasons.push("momentum_conflicts");
    }
  }

  return { score, reasons };
}

function computeConfidence(packet, directionScore) {
  const confluence = toUpper(packet?.confluence, "LOW");
  const manualConfirmed = !!packet?.pattern?.manual_confirmed;
  const absScore = Math.abs(directionScore);

  if (absScore >= 5 && confluence === "HIGH" && manualConfirmed) return "HIGH";
  if (absScore >= 4 && (confluence === "HIGH" || confluence === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

function computeRiskTier(confidence, confluence, isBlocked) {
  if (isBlocked) return "BLOCKED";
  if (confidence === "HIGH" && confluence === "HIGH") return "A";
  if (confidence === "MEDIUM") return "B";
  return "C";
}

function evaluateDecision(agentPacket) {
  const packet = agentPacket || {};
  const reasons = [];

  const missingFields = Array.isArray(packet.missing_fields) ? packet.missing_fields : [];
  const mismatchFlags = Array.isArray(packet.mismatch_flags) ? packet.mismatch_flags : [];

  const blockedByAccepted = packet.accepted !== true;
  const blockedByLevels = !hasNumericLevels(packet.levels);
  const blockedByMissing = hasBlockingMissingFields(missingFields);
  const blockedByFlags = hasBlockingMismatchFlags(mismatchFlags);
  const blockedByStop = !!packet?.levels?.hit_stop;

  if (blockedByLevels) reasons.push("gate_missing_levels");
  if (blockedByMissing || blockedByAccepted) reasons.push("gate_missing_required_fields");
  if (blockedByFlags) reasons.push("gate_conflict_flags");
  if (blockedByStop) reasons.push("gate_stop_already_hit");

  const isBlocked = blockedByAccepted || blockedByLevels || blockedByMissing || blockedByFlags || blockedByStop;
  if (isBlocked) {
    return {
      action: "WAIT",
      confidence: "LOW",
      risk_tier: "BLOCKED",
      direction_score: 0,
      reason_codes: [...new Set(reasons)],
      timestamp: packet.received_at || new Date().toISOString()
    };
  }

  const stage = toLower(packet.stage, "watch");
  if (!ACTIONABLE_STAGES.has(stage)) {
    reasons.push("stage_not_actionable");
    return {
      action: "WAIT",
      confidence: "LOW",
      risk_tier: "C",
      direction_score: 0,
      reason_codes: [...new Set(reasons)],
      timestamp: packet.received_at || new Date().toISOString()
    };
  }

  const { score: directionScore, reasons: momentumReasons } = computeDirectionScore(packet);
  reasons.push(...momentumReasons);

  const confluence = toUpper(packet.confluence, "LOW");
  const score = numberOrNull(packet.score) ?? 0;

  let action = "WAIT";
  if (directionScore >= 4 && (confluence === "HIGH" || (confluence === "MEDIUM" && score >= 70))) {
    action = "LONG";
    reasons.push("long_alignment_strong");
  } else if (directionScore <= -4 && (confluence === "HIGH" || (confluence === "MEDIUM" && score >= 70))) {
    action = "SHORT";
    reasons.push("short_alignment_strong");
  } else if (confluence === "MEDIUM" && score < 70) {
    reasons.push("score_below_threshold");
  }

  const confidence = computeConfidence(packet, directionScore);
  const riskTier = computeRiskTier(confidence, confluence, false);

  return {
    action,
    confidence,
    risk_tier: riskTier,
    direction_score: directionScore,
    reason_codes: [...new Set(reasons)],
    timestamp: packet.received_at || new Date().toISOString()
  };
}

module.exports = {
  evaluateDecision
};
