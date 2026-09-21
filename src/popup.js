const $ = (selector) => document.querySelector(selector);

function isSupportedUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "2.taobao.com" || host === "goofish.com" || host.endsWith(".goofish.com");
  } catch {
    return false;
  }
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh() {
  const [response, tab] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_PUBLIC_SETTINGS" }),
    currentTab()
  ]);
  if (!response?.ok) throw new Error(response?.error || "读取设置失败");

  const settings = response.settings;
  const provider = settings.providers[settings.activeProvider];
  $("#enabled").checked = settings.enabled;
  $("#provider-name").textContent = provider.name;
  $("#provider-model").textContent = provider.configured ? provider.model : "尚未配置 API Key";

  const supported = isSupportedUrl(tab?.url);
  const origin = supported ? new URL(tab.url).origin : "";
  const siteDisabled = origin && settings.disabledSites.includes(origin);
  $("#reenable-site").hidden = !siteDisabled;
  $("#reenable-site").dataset.origin = origin;
  $("#open-panel").disabled = !supported || !settings.enabled || siteDisabled;

  const notice = $("#notice");
  notice.hidden = true;
  if (!supported) {
    notice.hidden = false;
    notice.textContent = "请先打开一个闲鱼商品详情页。";
  } else if (!settings.enabled) {
    notice.hidden = false;
    notice.textContent = "插件已全局停用，可使用右上角开关重新启用。";
  } else if (siteDisabled) {
    notice.hidden = false;
    notice.textContent = "当前网站已停用闲值 AI。";
  } else if (!provider.configured) {
    notice.hidden = false;
    notice.textContent = "请先进入设置，填写所选提供商的 API Key。";
  }
  $("#status").textContent = settings.enabled ? "已启用" : "已停用";
}

$("#enabled").addEventListener("change", async (event) => {
  await chrome.runtime.sendMessage({ type: "SET_GLOBAL_ENABLED", enabled: event.target.checked });
  await refresh();
});

$("#open-panel").addEventListener("click", async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  const response = await chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" });
  if (!response?.ok) return;
  window.close();
});

$("#reenable-site").addEventListener("click", async (event) => {
  await chrome.runtime.sendMessage({
    type: "REENABLE",
    scope: "site",
    origin: event.currentTarget.dataset.origin
  });
  await refresh();
});

$("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh().catch((error) => {
  $("#status").textContent = "状态读取失败";
  $("#notice").hidden = false;
  $("#notice").textContent = error.message || "请稍后重试";
  $("#open-panel").disabled = true;
});
