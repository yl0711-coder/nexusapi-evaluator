export function normalizePricePerMillion(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

export function estimateTokenCost({ inputTokens, outputTokens, inputPricePerMTokens, outputPricePerMTokens }) {
  const inputPrice = normalizePricePerMillion(inputPricePerMTokens);
  const outputPrice = normalizePricePerMillion(outputPricePerMTokens);
  if (inputPrice === null && outputPrice === null) {
    return null;
  }
  const input = Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : 0;
  const output = Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : 0;
  const cost = (input / 1_000_000) * (inputPrice || 0) + (output / 1_000_000) * (outputPrice || 0);
  return roundCost(cost);
}

export function estimateProfileRunCost(profile, { inputTokens, outputTokens }) {
  return estimateTokenCost({
    inputTokens,
    outputTokens,
    inputPricePerMTokens: profile?.inputPricePerMTokens,
    outputPricePerMTokens: profile?.outputPricePerMTokens,
  });
}

export function estimateTokenEconomics({
  inputTokens,
  outputTokens,
  inputCostPerMTokens,
  outputCostPerMTokens,
  inputSellPricePerMTokens,
  outputSellPricePerMTokens,
}) {
  const estimatedCost = estimateTokenCost({
    inputTokens,
    outputTokens,
    inputPricePerMTokens: inputCostPerMTokens,
    outputPricePerMTokens: outputCostPerMTokens,
  });
  const estimatedRevenue = estimateTokenCost({
    inputTokens,
    outputTokens,
    inputPricePerMTokens: inputSellPricePerMTokens,
    outputPricePerMTokens: outputSellPricePerMTokens,
  });
  const estimatedGrossProfit =
    estimatedCost !== null && estimatedRevenue !== null ? roundCost(estimatedRevenue - estimatedCost) : null;
  const estimatedGrossMargin =
    estimatedGrossProfit !== null && estimatedRevenue > 0 ? roundRatio(estimatedGrossProfit / estimatedRevenue) : null;

  return {
    estimatedCost,
    estimatedRevenue,
    estimatedGrossProfit,
    estimatedGrossMargin,
  };
}

export function estimateProfileRunEconomics(profile, { inputTokens, outputTokens }) {
  return estimateTokenEconomics({
    inputTokens,
    outputTokens,
    inputCostPerMTokens: profile?.inputPricePerMTokens,
    outputCostPerMTokens: profile?.outputPricePerMTokens,
    inputSellPricePerMTokens: profile?.inputSellPricePerMTokens,
    outputSellPricePerMTokens: profile?.outputSellPricePerMTokens,
  });
}

export function roundCost(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function roundRatio(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10_000) / 10_000;
}
