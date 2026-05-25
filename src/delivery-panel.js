import {
  buildHandoffTemplate,
  buildRankingRows,
  getLatestRuns,
  renderInsightCards,
  renderPlainConclusion,
  renderRankingList,
} from "./delivery-view.js";
import { renderProjectInfoSummary } from "./project-info.js";

export function renderDeliveryPanels({
  state,
  plainConclusion,
  projectInfoSummary,
  reportInsights,
  rankingList,
  handoffSummary,
  handoffTemplate,
}) {
  const latestRuns = getLatestRuns(state);
  plainConclusion.innerHTML = renderPlainConclusion(latestRuns);
  projectInfoSummary.innerHTML = renderProjectInfoSummary(state.projectInfo);
  reportInsights.innerHTML = renderInsightCards(latestRuns, { compact: true });
  rankingList.innerHTML = renderRankingList(buildRankingRows(state.testRuns));
  handoffSummary.innerHTML = renderInsightCards(latestRuns, { compact: false });
  handoffTemplate.textContent = buildHandoffTemplate(latestRuns, state.projectInfo);
}
