import { escapeHtml } from "./client-utils.js";

export function renderProfileList({ profiles, list, onFocusForm, onDeleteProfile, onUpdateKey }) {
  if (profiles.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>还没有可测试的 API</strong>
        <p>先把平台给你的地址、Key 和模型名填进来。不会填协议时，直接选“AI 中转站 / OpenAI 兼容”。</p>
        <button class="primary" type="button" data-focus-profile-form="1">去填写配置</button>
      </div>
    `;
    list.querySelector("[data-focus-profile-form]").addEventListener("click", onFocusForm);
    return;
  }

  list.innerHTML = profiles
    .map(
      (profile) => `
        <div class="row">
          <div>
            <strong>${escapeHtml(profile.name)}</strong><br />
            <small>${escapeHtml(profile.provider)}</small>
          </div>
          <span class="tag">${profile.role === "judge" ? "主 API" : "被测 API"}</span>
          <span>${escapeHtml(profile.protocol)}</span>
          <span>${escapeHtml(profile.defaultModel)}</span>
          <span>${escapeHtml(profile.apiKey)}</span>
          <div class="row-actions">
            <button class="secondary" data-update-key="${profile.id}">更新 Key</button>
            <button class="secondary" data-delete-profile="${profile.id}">删除</button>
          </div>
        </div>
      `,
    )
    .join("");

  list.querySelectorAll("[data-delete-profile]").forEach((button) => {
    button.addEventListener("click", () => onDeleteProfile(button.dataset.deleteProfile));
  });

  list.querySelectorAll("[data-update-key]").forEach((button) => {
    button.addEventListener("click", () => onUpdateKey(button.dataset.updateKey));
  });
}

export function renderMissingKeyPanel({ profiles, container, onFillKey }) {
  const missing = profiles.filter((profile) => profile.hasKey === false || !profile.apiKey);
  if (missing.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="section-header compact">
      <div>
        <p class="eyebrow">需要补 Key</p>
        <h3>导入的配置里有 ${missing.length} 条还不能测试</h3>
      </div>
    </div>
    <p class="section-desc">为了安全，导出的配置不会带真实 Key。请逐条补 Key，补完后先跑快速测试。</p>
    <div class="inline-list">
      ${missing
        .map(
          (profile) => `
            <article class="inline-item">
              <div>
                <strong>${escapeHtml(profile.name)}</strong>
                <small>${escapeHtml(profile.defaultModel || "-")}</small>
              </div>
              <button class="primary" type="button" data-fill-missing-key="${profile.id}">补 Key</button>
            </article>
          `,
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll("[data-fill-missing-key]").forEach((button) => {
    button.addEventListener("click", () => onFillKey(button.dataset.fillMissingKey));
  });
}

export function renderProfileSelectOptions({ profiles, selects }) {
  const targets = profiles.filter((profile) => profile.role === "target");
  if (targets.length === 0) {
    selects.forEach((select) => {
      select.innerHTML = `<option value="">请先新增被测 API</option>`;
    });
    return;
  }

  const options = targets
    .map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)} / ${escapeHtml(profile.defaultModel)}</option>`)
    .join("");
  selects.forEach((select) => {
    select.innerHTML = options;
  });
}
