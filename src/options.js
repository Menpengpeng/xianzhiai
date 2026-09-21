import {
  SETTINGS_KEY,
  createDefaultSettings,
  mergeSettings
} from "./core.js";

let settings = createDefaultSettings();
let selectedProviderId = "deepseek";
let toastTimer;

const $ = (selector) => document.querySelector(selector);

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  settings = mergeSettings(stored[SETTINGS_KEY]);
  selectedProviderId = settings.activeProvider;
}

async function persist() {
  settings = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function providerIsConfigured(provider) {
  return Boolean(provider.apiKey?.trim() && provider.model?.trim() && provider.baseUrl?.trim());
}

function renderProviderNav() {
  const nav = $(".provider-nav");
  nav.replaceChildren();
  for (const provider of Object.values(settings.providers)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "provider-tab";
    button.dataset.providerId = provider.id;
    button.setAttribute("aria-current", String(provider.id === selectedProviderId));
    const name = document.createElement("strong");
    name.textContent = provider.name;
    const status = document.createElement("span");
    status.textContent = providerIsConfigured(provider) ? "已配置" : "待配置";
    button.append(name, status);
    button.addEventListener("click", () => {
      selectedProviderId = provider.id;
      render();
    });
    nav.appendChild(button);
  }
}

function renderDisabledSites() {
  const container = $("#disabled-sites");
  container.replaceChildren();
  if (!settings.disabledSites.length) {
    const empty = document.createElement("span");
    empty.className = "empty";
    empty.textContent = "暂无已停用网站";
    container.appendChild(empty);
    return;
  }
  for (const origin of settings.disabledSites) {
    const row = document.createElement("div");
    row.className = "site-chip";
    const label = document.createElement("span");
    label.textContent = origin;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "重新启用";
    button.addEventListener("click", async () => {
      settings.disabledSites = settings.disabledSites.filter((item) => item !== origin);
      await persist();
      renderDisabledSites();
      showToast("该网站已重新启用");
    });
    row.append(label, button);
    container.appendChild(row);
  }
}

function renderForm() {
  const provider = settings.providers[selectedProviderId];
  $("#provider-name").textContent = provider.name;
  $("#api-key").value = provider.apiKey || "";
  $("#model").value = provider.model || "";
  $("#base-url").value = provider.baseUrl || "";
  $("#timeout").value = String(provider.timeoutMs || 60000);
  $("#temperature").value = String(provider.temperature ?? 0.2);
  $("#temperature-value").value = String(provider.temperature ?? 0.2);
  $("#active-provider").checked = settings.activeProvider === provider.id;
  const docsLink = $("#docs-link");
  docsLink.hidden = !provider.docsUrl;
  docsLink.href = provider.docsUrl || "#";
}

function render() {
  $("#global-enabled").checked = settings.enabled;
  renderProviderNav();
  renderForm();
  renderDisabledSites();
}

function readProviderForm() {
  const provider = settings.providers[selectedProviderId];
  return {
    ...provider,
    apiKey: $("#api-key").value.trim(),
    model: $("#model").value.trim(),
    baseUrl: $("#base-url").value.trim().replace(/\/+$/, ""),
    timeoutMs: Number($("#timeout").value),
    temperature: Number($("#temperature").value)
  };
}

async function ensureCustomHostPermission(provider) {
  if (provider.id !== "custom") return true;
  let origin;
  try {
    origin = new URL(provider.baseUrl).origin;
  } catch {
    throw new Error("自定义 Base URL 格式不正确");
  }
  const origins = [`${origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

$("#provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = readProviderForm();
  if (!provider.baseUrl || !provider.model) {
    showToast("请填写 Base URL 和模型名称");
    return;
  }
  try {
    if (!await ensureCustomHostPermission(provider)) {
      showToast("未获得自定义模型服务的访问权限");
      return;
    }
    settings.providers[selectedProviderId] = provider;
    if ($("#active-provider").checked) settings.activeProvider = selectedProviderId;
    await persist();
    render();
    showToast("配置已保存");
  } catch (error) {
    showToast(error.message || "保存失败");
  }
});

$("#test-provider").addEventListener("click", async () => {
  const button = $("#test-provider");
  const provider = readProviderForm();
  if (!provider.apiKey || !provider.model || !provider.baseUrl) {
    showToast("请先填写 API Key、模型和 Base URL");
    return;
  }
  button.disabled = true;
  button.textContent = "测试中…";
  try {
    if (!await ensureCustomHostPermission(provider)) throw new Error("未获得访问权限");
    const response = await chrome.runtime.sendMessage({ type: "TEST_PROVIDER", provider });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    showToast("连接成功");
  } catch (error) {
    showToast(error.message || "连接失败");
  } finally {
    button.disabled = false;
    button.textContent = "测试连接";
  }
});

$("#active-provider").addEventListener("change", async () => {
  settings.activeProvider = selectedProviderId;
  await persist();
  renderProviderNav();
  showToast("已设为默认提供商");
});

$("#global-enabled").addEventListener("change", async (event) => {
  settings.enabled = event.target.checked;
  await persist();
  showToast(settings.enabled ? "插件已启用" : "插件已全局停用");
});

$("#temperature").addEventListener("input", (event) => {
  $("#temperature-value").value = event.target.value;
});

$("#toggle-key").addEventListener("click", () => {
  const input = $("#api-key");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("#toggle-key").textContent = visible ? "显示" : "隐藏";
});

$("#clear-key").addEventListener("click", async () => {
  settings.providers[selectedProviderId].apiKey = "";
  await persist();
  render();
  showToast("该提供商的 API Key 已清除");
});

$("#reset-all").addEventListener("click", async () => {
  if (!confirm("确定清除全部本地配置和 API Key 吗？此操作无法撤销。")) return;
  settings = createDefaultSettings();
  selectedProviderId = settings.activeProvider;
  await persist();
  render();
  showToast("已恢复默认设置");
});

await loadSettings();
render();
