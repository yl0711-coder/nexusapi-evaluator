// server/judge-orchestration.mjs
//
// LLM-as-Judge 编排层（v2.0 wiring #3，安全半成品）。
//
// 把 Step5b 的裁判原语（同家族规避 / 聚合 / Krippendorff α 一致性）组装成可运行流程。
// **裁判调用用依赖注入的 callJudge 函数**：测试用 mock，零真实请求、零额度消耗。
// 等用户授权裁判渠道 + 额度后，把真实 callJudge（接 test-runner 请求机）传进来即可激活。
//
// 红线：裁判主 API 不评同家族被测模型；裁判数 <2 或一致性不足 → 标"需人工复核"，
// 不当可信结论；盲测（不告诉裁判回答来自哪个模型/厂商）。

import { aggregateJudgeScores, judgeConsistency, selectEligibleJudges } from "./llm-judge.mjs";

export const DEFAULT_JUDGE_SCALE = 100;

// 盲测评分 prompt：只给问题 + 回答，不透露来源模型，要求结尾"评分：<数字>"。
export function buildJudgePrompt({ question = "", answer = "", rubric = "", scale = DEFAULT_JUDGE_SCALE } = {}) {
  return [
    "你是一名严格、中立的评分员。只依据下面的【问题】和【回答】打分，",
    "不要猜测回答出自哪个模型或厂商，不要因为长度、措辞华丽与否而偏向。",
    rubric ? `评分标准：\n${rubric}` : "评分标准：综合准确性、完整性、相关性、表达清晰度。",
    `请给出 0 到 ${scale} 的整数分，解释不超过 100 字，并在最后单独一行用“评分：<数字>”给出分数。`,
    "",
    `【问题】\n${question}`,
    "",
    `【回答】\n${answer}`,
  ].join("\n");
}

// 从裁判文本里抽取分数：优先"评分：NN"，其次"NN/100"，最后裸数字；越界裁剪。
export function parseJudgeScore(text, { scale = DEFAULT_JUDGE_SCALE } = {}) {
  const t = String(text || "");
  let raw = NaN;
  const labeled = t.match(/评分[:：]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (labeled) raw = Number(labeled[1]);
  if (!Number.isFinite(raw)) {
    const frac = t.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+)/);
    if (frac && Number(frac[2]) > 0) raw = (Number(frac[1]) / Number(frac[2])) * scale;
  }
  if (!Number.isFinite(raw)) {
    const num = t.match(/([0-9]{1,3}(?:\.[0-9]+)?)/);
    if (num) raw = Number(num[1]);
  }
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(scale, raw));
}

// 单答案多裁判评分。callJudge(judge, prompt) => Promise<string>（裁判原始文本）。
export async function runMultiJudge({
  judges = [],
  targetModel = "",
  question = "",
  answer = "",
  rubric = "",
  scale = DEFAULT_JUDGE_SCALE,
  callJudge,
} = {}) {
  if (typeof callJudge !== "function") throw new Error("runMultiJudge 需要 callJudge 函数");
  const { eligible, excluded } = selectEligibleJudges(judges, targetModel);
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: "no_eligible_judge",
      excluded,
      needsHumanReview: true,
      note: "无可用裁判（全部与被测同家族），结果不可信，需人工复核。",
    };
  }
  const perJudge = [];
  for (const judge of eligible) {
    const prompt = buildJudgePrompt({ question, answer, rubric, scale });
    let raw = "";
    try {
      raw = await callJudge(judge, prompt);
    } catch {
      raw = "";
    }
    const score = parseJudgeScore(raw, { scale });
    if (score !== null) perJudge.push({ judge, score });
  }
  const aggregate = aggregateJudgeScores(perJudge);
  return {
    ok: perJudge.length > 0,
    scale,
    excluded,
    perJudge,
    ...aggregate,
    needsHumanReview: perJudge.length < 2, // 单裁判不算可信，一致性也无从谈起
  };
}

// 多答案 + 同一裁判组 → panel 级一致性（Krippendorff α 才有意义）。
// items：[{ question, answer, rubric }]
export async function assessJudgePanel({
  items = [],
  judges = [],
  targetModel = "",
  scale = DEFAULT_JUDGE_SCALE,
  callJudge,
  level = "interval",
} = {}) {
  const perItem = [];
  const units = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runMultiJudge({ judges, targetModel, scale, callJudge, ...item });
    perItem.push(r);
    units.push((r.perJudge || []).map((p) => p.score));
  }
  const consistency = judgeConsistency(units, { level });
  return {
    items: perItem,
    consistency,
    needsHumanReview: consistency.needsHumanReview || perItem.some((p) => !p.ok),
    method: "multi-judge + Krippendorff α 一致性",
  };
}
