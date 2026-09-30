/**
 * CLI runner for TypeScript Decay Engine.
 * Reads JSON test cases from stdin and outputs computed results as JSON.
 */

import { computeConfidence, calculateTransactionVariance } from '../src/lib/decay.ts';

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const rawInput = Buffer.concat(chunks).toString('utf-8');
  if (!rawInput.trim()) {
    console.error('No input JSON provided');
    process.exit(1);
  }

  const testCases = JSON.parse(rawInput);
  const results = testCases.map((tc: any) => {
    const asOf = tc.as_of_date ? new Date(tc.as_of_date) : null;
    const conf = computeConfidence(
      tc.last_verification_date,
      tc.instrument_type,
      tc.confidence_basis,
      tc.usage_counter,
      tc.usage_baseline,
      asOf
    );

    const variance1000 = calculateTransactionVariance(1000, conf.economic_impact.max_drift_pct);

    return {
      test_id: tc.test_id || tc.instrument_id,
      score: conf.score,
      raw_score: conf.raw_score,
      band: conf.band,
      basis: conf.basis,
      days_since_verification: conf.days_since_verification,
      half_life_days: conf.half_life_days,
      lambda_val: conf.lambda_val,
      mu_val: conf.mu_val,
      usage_ratio: conf.usage_ratio,
      mpe_status_text: conf.economic_impact.mpe_status_text,
      max_drift_pct: conf.economic_impact.max_drift_pct,
      rupee_risk_per_1000: conf.economic_impact.rupee_risk_per_1000,
      economic_impact_text: conf.economic_impact.economic_impact_text,
      statutory_rule: conf.economic_impact.statutory_rule,
      action_recommendation: conf.economic_impact.action_recommendation,
      clarification_text: conf.clarification_text,
      variance_at_1000: variance1000
    };
  });

  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
