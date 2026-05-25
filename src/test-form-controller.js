import { escapeHtml, toast } from "./client-utils.js";
import { runRemoteTask } from "./api-client.js";

export function createTaskFormController({
  form,
  submitButton,
  resultElement,
  progressElement,
  state,
  slot,
  taskType,
  confirmRun,
  preparePayload,
  beforeStart,
  onSuccess,
  failurePrefix,
  idleButtonText,
}) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = preparePayload(Object.fromEntries(new FormData(form).entries()));
    if (!payload) {
      return;
    }
    if (confirmRun) {
      const confirmed = await confirmRun(payload);
      if (!confirmed) return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "任务运行中...";
    beforeStart?.(payload);

    try {
      const result = await runRemoteTask(state, slot, taskType, payload, progressElement);
      await onSuccess(result, payload);
    } catch (error) {
      resultElement.innerHTML = `<p class="fail">${escapeHtml(failurePrefix)}：${escapeHtml(error.message)}</p>`;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = idleButtonText;
    }
  });
}

export function requireSelectedValues(select, emptyMessage) {
  const values = Array.from(select.selectedOptions).map((option) => option.value);
  if (values.length === 0) {
    toast(emptyMessage, true);
    return null;
  }
  return values;
}
