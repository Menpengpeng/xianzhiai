import {
  SETTINGS_KEY,
  buildAnalysisMessages,
  buildChatCompletionsUrl,
  createDefaultSettings,
  getChatCompletionText,
  getPublicSettings,
  mergeSettings,
  normalizeApiError,
  parseModelResult,
  sanitizeProduct
} from "./core.js";

const controllers = new Map();

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(settings) {
  const normalized = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    const settings = await loadSettings();
    await saveSettings(settings);
    if (details.reason === "install") await chrome.runtime.openOptionsPage();
  })();
});

function assertProvider(provider) {
  if (!provider) throw new Error("没有找到模型提供商配置");
  if (!provider.apiKey?.trim()) throw new Error("请先配置 API Key");
  if (!provider.model?.trim()) throw new Error("请填写模型名称或推理接入点 ID");
  if (!provider.baseUrl?.trim()) throw new Error("请填写 Base URL");
}

function supportsJsonMode(provider) {
  try {
    return provider.id === "deepseek" || new URL(provider.baseUrl).hostname === "api.deepseek.com";
  } catch {
    return provider.id === "deepseek";
  }
}

function buildFormatRetryMessages(messages, previousText) {
  const retryInstruction = [
    "上一条回复为空或不是有效的 JSON 对象。",
    "请重新完成同一个估价任务，只输出一个完整 JSON 对象。",
    "不要输出 Markdown、代码围栏、思考过程、前言或结尾。"
  ].join("\n");
  const previous = String(previousText || "").trim().slice(0, 4000);
  return [
    ...messages,
    ...(previous ? [{ role: "assistant", content: previous }] : []),
    { role: "user", content: retryInstruction }
  ];
}

async function callProvider(
  provider,
  messages,
  requestId,
  { testOnly = false, jsonMode = false } = {}
) {
  assertProvider(provider);
  const controller = new AbortController();
  if (requestId) controllers.set(requestId, controller);
  const timeout = setTimeout(
    () => controller.abort(new DOMException("请求超时", "TimeoutError")),
    Math.max(5000, Math.min(180000, Number(provider.timeoutMs) || 60000))
  );

  try {
    const body = {
      model: provider.model.trim(),
      messages,
      temperature: testOnly ? 0 : Math.max(0, Math.min(2, Number(provider.temperature) || 0)),
      max_tokens: testOnly ? 12 : 2200,
      stream: false
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    const response = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${provider.apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text.slice(0, 300) };
    }

    if (!response.ok) throw new Error(normalizeApiError(response.status, payload));
    return getChatCompletionText(payload);
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("请求已取消或超时。");
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接模型服务。请检查网络、Base URL 与站点权限。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (requestId) controllers.delete(requestId);
  }
}

async function analyzeWithRetry(provider, product, supplemental, requestId) {
  const baseMessages = buildAnalysisMessages(product, supplemental);
  const jsonMode = supportsJsonMode(provider);
  let messages = baseMessages;
  let previousText = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    previousText = await callProvider(
      provider,
      messages,
      requestId,
      { jsonMode }
    );
    try {
      return parseModelResult(previousText);
    } catch (error) {
      if (attempt === 1) {
        throw new Error("模型返回格式异常，已自动重试一次。请稍后重试或切换模型。");
      }
      messages = buildFormatRetryMessages(baseMessages, previousText);
    }
  }
  throw new Error("模型返回格式异常。");
}

async function handleMessage(message) {
  const type = message?.type;

  if (type === "GET_PUBLIC_SETTINGS") {
    return { ok: true, settings: getPublicSettings(await loadSettings()) };
  }

  if (type === "OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (type === "GET_VISIBILITY") {
    const settings = await loadSettings();
    const origin = String(message.origin || "");
    const siteDisabled = settings.disabledSites.includes(origin);
    return {
      ok: true,
      visible: settings.enabled && !siteDisabled,
      reason: !settings.enabled ? "global" : siteDisabled ? "site" : null
    };
  }

  if (type === "SET_CLOSE_SCOPE") {
    const settings = await loadSettings();
    if (message.scope === "site" && message.origin) {
      settings.disabledSites = [...new Set([...settings.disabledSites, String(message.origin)])];
    }
    if (message.scope === "always") settings.enabled = false;
    await saveSettings(settings);
    return { ok: true };
  }

  if (type === "REENABLE") {
    const settings = await loadSettings();
    if (message.scope === "global" || message.scope === "all") settings.enabled = true;
    if ((message.scope === "site" || message.scope === "all") && message.origin) {
      settings.disabledSites = settings.disabledSites.filter((origin) => origin !== message.origin);
    }
    await saveSettings(settings);
    return { ok: true, settings: getPublicSettings(settings) };
  }

  if (type === "SET_GLOBAL_ENABLED") {
    const settings = await loadSettings();
    settings.enabled = Boolean(message.enabled);
    await saveSettings(settings);
    return { ok: true, settings: getPublicSettings(settings) };
  }

  if (type === "SET_ACTIVE_PROVIDER") {
    const settings = await loadSettings();
    if (!settings.providers[message.providerId]) throw new Error("未知的模型提供商");
    settings.activeProvider = message.providerId;
    await saveSettings(settings);
    return { ok: true, settings: getPublicSettings(settings) };
  }

  if (type === "ANALYZE") {
    const settings = await loadSettings();
    const providerId = message.providerId || settings.activeProvider;
    const provider = settings.providers[providerId];
    const product = sanitizeProduct(message.product);
    const result = await analyzeWithRetry(
      provider,
      product,
      message.supplemental,
      message.requestId
    );
    return {
      ok: true,
      providerId,
      providerName: provider.name,
      result
    };
  }

  if (type === "CANCEL_ANALYSIS") {
    controllers.get(message.requestId)?.abort();
    return { ok: true };
  }

  if (type === "TEST_PROVIDER") {
    const provider = {
      ...message.provider,
      apiKey: String(message.provider?.apiKey || "")
    };
    await callProvider(
      provider,
      [
        { role: "system", content: "只回答 OK。" },
        { role: "user", content: "连接测试" }
      ],
      `test-${crypto.randomUUID()}`,
      { testOnly: true }
    );
    return { ok: true };
  }

  throw new Error("不支持的扩展消息");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "操作失败" }));
  return true;
});
