export const SETTINGS_KEY = "xianzhiSettings";

export const PROVIDER_TEMPLATES = Object.freeze({
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiKey: "",
    temperature: 0.2,
    timeoutMs: 60000,
    docsUrl: "https://api-docs.deepseek.com/zh-cn/"
  },
  qwen: {
    id: "qwen",
    name: "通义千问 Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    apiKey: "",
    temperature: 0.2,
    timeoutMs: 60000,
    docsUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions"
  },
  glm: {
    id: "glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5-flash",
    apiKey: "",
    temperature: 0.2,
    timeoutMs: 60000,
    docsUrl: "https://docs.bigmodel.cn/"
  },
  volcengine: {
    id: "volcengine",
    name: "火山引擎方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    apiKey: "",
    temperature: 0.2,
    timeoutMs: 60000,
    docsUrl: "https://www.volcengine.com/docs/82379/1494384"
  },
  custom: {
    id: "custom",
    name: "OpenAI 兼容服务",
    baseUrl: "",
    model: "",
    apiKey: "",
    temperature: 0.2,
    timeoutMs: 60000,
    docsUrl: ""
  }
});

export function createDefaultSettings() {
  return {
    schemaVersion: 1,
    enabled: true,
    activeProvider: "deepseek",
    disabledSites: [],
    providers: Object.fromEntries(
      Object.entries(PROVIDER_TEMPLATES).map(([id, provider]) => [id, { ...provider }])
    )
  };
}

export function mergeSettings(value = {}) {
  const defaults = createDefaultSettings();
  const providers = {};

  for (const [id, template] of Object.entries(PROVIDER_TEMPLATES)) {
    providers[id] = {
      ...template,
      ...(value.providers?.[id] || {}),
      id
    };
  }

  const activeProvider = providers[value.activeProvider] ? value.activeProvider : defaults.activeProvider;
  return {
    ...defaults,
    ...value,
    activeProvider,
    disabledSites: Array.isArray(value.disabledSites)
      ? [...new Set(value.disabledSites.filter((item) => typeof item === "string"))]
      : [],
    providers
  };
}

export function getPublicSettings(settingsInput) {
  const settings = mergeSettings(settingsInput);
  return {
    enabled: settings.enabled,
    activeProvider: settings.activeProvider,
    disabledSites: [...settings.disabledSites],
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, provider]) => [
        id,
        {
          id,
          name: provider.name,
          model: provider.model,
          baseUrl: provider.baseUrl,
          configured: Boolean(provider.apiKey?.trim() && provider.model?.trim())
        }
      ])
    )
  };
}

function cleanText(value, limit = 6000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[已隐藏邮箱]")
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[已隐藏手机号]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value ?? "").replace(/[,，￥¥\s]/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

export function sanitizeProduct(input = {}) {
  const price = toFiniteNumber(input.price);
  return {
    id: cleanText(input.id, 120),
    url: cleanText(input.url, 500),
    title: cleanText(input.title, 300),
    description: cleanText(input.description, 5000),
    price,
    currency: cleanText(input.currency || "CNY", 12),
    category: cleanText(input.category, 120),
    attributes: cleanText(input.attributes, 2500),
    visibleSummary: cleanText(input.visibleSummary, 5000),
    imageCount: Math.max(0, Math.min(30, Number(input.imageCount) || 0))
  };
}

export function buildAnalysisMessages(productInput, supplemental = "") {
  const product = sanitizeProduct(productInput);
  const safeSupplemental = cleanText(supplemental, 2000);
  const system = [
    "你是二手商品估价助手。",
    "只根据用户提供的当前商品信息分析，不得声称访问了实时行情、历史成交库或未提供的数据。",
    "信息不足时降低置信度，并明确指出待确认信息。",
    "只输出一个 JSON 对象，不要输出 Markdown 代码块或额外解释。"
  ].join("\n");
  const schema = {
    suggestedPrice: 980,
    priceRange: { min: 880, max: 1080 },
    confidence: "中",
    verdict: "合理",
    summary: "一句话价格判断",
    factors: ["最多三条关键估价因素"],
    risks: ["风险或缺失信息"],
    questions: ["成交前建议确认的问题"],
    negotiationText: "可直接复制、礼貌且不冒犯的议价话术",
    disclaimer: "AI 建议，仅供参考，不代表实时成交价或鉴定结论"
  };
  const user = [
    "请分析以下闲鱼商品并返回符合给定结构的 JSON。",
    `商品数据：${JSON.stringify(product)}`,
    safeSupplemental ? `用户补充：${safeSupplemental}` : "",
    `返回结构示例：${JSON.stringify(schema)}`,
    "suggestedPrice、priceRange.min、priceRange.max 必须是数字；无法可靠估价时可为 null，verdict 应为“信息不足”。"
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function extractJsonText(value) {
  const text = String(value || "").trim();
  const withoutFence = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型没有返回可识别的 JSON 对象");
  }
  return withoutFence.slice(start, end + 1);
}

function normalizeStringList(value, limit = 6) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => {
    if (typeof item === "string") return cleanText(item, 400);
    if (item && typeof item === "object") {
      return cleanText(item.reason || item.label || item.text || item.description || JSON.stringify(item), 400);
    }
    return cleanText(item, 400);
  }).filter(Boolean);
}

export function parseModelResult(value) {
  const parsed = typeof value === "object" && value !== null
    ? value
    : JSON.parse(extractJsonText(value));

  const suggestedPrice = toFiniteNumber(parsed.suggestedPrice);
  let min = toFiniteNumber(parsed.priceRange?.min);
  let max = toFiniteNumber(parsed.priceRange?.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  const confidenceMap = { high: "高", medium: "中", low: "低", 高: "高", 中高: "中高", 中: "中", 低: "低" };
  const confidence = confidenceMap[String(parsed.confidence || "").toLowerCase()] || "低";
  const verdict = cleanText(parsed.verdict || (suggestedPrice === null ? "信息不足" : "合理"), 40);
  const summary = cleanText(parsed.summary || parsed.reason || "请结合商品实况与卖家信息判断。", 500);

  if (suggestedPrice === null && min === null && max === null && verdict !== "信息不足") {
    throw new Error("模型结果缺少有效价格与“信息不足”说明");
  }

  return {
    suggestedPrice,
    priceRange: { min, max },
    confidence,
    verdict,
    summary,
    factors: normalizeStringList(parsed.factors, 3),
    risks: normalizeStringList(parsed.risks, 5),
    questions: normalizeStringList(parsed.questions, 5),
    negotiationText: cleanText(parsed.negotiationText, 1200),
    disclaimer: cleanText(
      parsed.disclaimer || "AI 建议，仅供参考，不代表实时成交价或鉴定结论。",
      300
    )
  };
}

export function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Base URL 必须以 http:// 或 https:// 开头");
  }
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function getChatCompletionText(payload = {}) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || "").join("");
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  throw new Error("模型响应中没有可读取的文本内容");
}

export function normalizeApiError(status, payload) {
  const raw = payload?.error?.message || payload?.message || payload?.msg || "";
  const detail = cleanText(raw, 300);
  if (status === 401 || status === 403) return "API Key 无效、已过期或没有访问该模型的权限。";
  if (status === 402) return "模型账户余额不足或套餐不可用。";
  if (status === 404) return "接口地址、模型名称或推理接入点不存在。";
  if (status === 408) return "模型请求超时，请稍后重试。";
  if (status === 429) return "请求过于频繁或额度已用尽，请稍后重试或切换提供商。";
  if (status >= 500) return "模型服务暂时不可用，请稍后重试。";
  return detail ? `请求失败：${detail}` : `请求失败（HTTP ${status}）`;
}

export function formatResultText(result, productTitle = "") {
  const price = result.suggestedPrice === null ? "信息不足" : `¥${result.suggestedPrice}`;
  const range = result.priceRange.min === null || result.priceRange.max === null
    ? "信息不足"
    : `¥${result.priceRange.min}–¥${result.priceRange.max}`;
  return [
    productTitle ? `商品：${cleanText(productTitle, 300)}` : "",
    `AI 建议价：${price}`,
    `合理区间：${range}`,
    `判断：${result.verdict}（${result.confidence}置信度）`,
    result.summary,
    result.factors.length ? `关键因素：\n- ${result.factors.join("\n- ")}` : "",
    result.risks.length ? `风险与缺失：\n- ${result.risks.join("\n- ")}` : "",
    result.disclaimer
  ].filter(Boolean).join("\n");
}
