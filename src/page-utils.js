(() => {
  function toPrice(value, allowBare = false) {
    const text = String(value ?? "")
      .replace(/[，,]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const currencyMatch = text.match(/(?:¥|￥|RMB|CNY)\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
    const yuanMatch = text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*元/);
    const bareMatch = allowBare ? text.match(/([0-9]+(?:\.[0-9]{1,2})?)/) : null;
    const match = currencyMatch || yuanMatch || bareMatch;
    if (!match) return null;
    const price = Number(match[1]);
    return Number.isFinite(price) && price > 0 && price <= 100000000 ? price : null;
  }

  function chooseBestPrice(candidates = []) {
    let best = null;
    for (const candidate of candidates) {
      const text = String(candidate?.text ?? candidate?.value ?? "");
      const directValue = typeof candidate?.value === "number" ? candidate.value : null;
      const value = directValue && Number.isFinite(directValue)
        ? directValue
        : toPrice(candidate?.value ?? text, Boolean(candidate?.allowBare));
      if (value === null || value <= 0 || value > 100000000) continue;

      let score = Number(candidate?.score) || 0;
      if (/[¥￥]|\b(?:RMB|CNY)\b/i.test(text)) score += 60;
      if (/\d\s*元/.test(text)) score += 45;
      if (candidate?.priceLike) score += 35;
      if (Number(candidate?.fontSize) >= 24) score += 25;
      else if (Number(candidate?.fontSize) >= 18) score += 12;
      if (text.length > 0 && text.length <= 40) score += 10;
      if (/原价|划线价|市场价/.test(text)) score -= 35;
      if (text.length > 160) score -= 20;

      if (!best || score > best.score) best = { value, score };
    }
    return best?.value ?? null;
  }

  function normalizeImageUrl(value) {
    const source = String(value || "").trim();
    if (!source || /^(?:data|blob):/i.test(source)) return "";
    try {
      const url = new URL(source, "https://xianzhi.invalid");
      const imagePath = url.pathname.match(/^(.+?\.(?:jpe?g|png|webp|avif))(?:[_!.].*)?$/i);
      const pathname = imagePath?.[1] || url.pathname;
      const host = url.hostname === "xianzhi.invalid" ? "" : url.hostname.toLowerCase();
      return `${host}${pathname}`;
    } catch {
      return "";
    }
  }

  function countUniqueImageUrls(values = []) {
    return new Set(values.map(normalizeImageUrl).filter(Boolean)).size;
  }

  function normalizePageTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s*(?:[_|｜]|-\s*)\s*闲鱼(?:官网)?(?:\s*[-_|｜].*)?$/i, "")
      .trim();
  }

  function trimRecommendationText(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n");
    const marker = /(?:^|\n)\s*(?:为你推荐|猜你喜欢|相关推荐|相似推荐)\s*(?=\n|$)/m.exec(text);
    return (marker ? text.slice(0, marker.index) : text).trim();
  }

  function extractLabeledAttributes(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n");
    const labels = [
      ["品牌", "品\\s*牌"],
      ["型号", "型\\s*号"],
      ["成色", "成\\s*色"],
      ["颜色", "颜\\s*色"],
      ["功能状态", "功\\s*能\\s*状\\s*态"],
      ["存储容量", "存\\s*储\\s*容\\s*量"],
      ["内存容量", "内\\s*存\\s*容\\s*量"],
      ["容量", "容\\s*量"]
    ];
    const results = [];
    const seen = new Set();

    for (const [label, pattern] of labels) {
      const match = new RegExp(`(?:^|\\n)\\s*${pattern}\\s*[：:]?\\s*([^\\n]{1,160})`, "m").exec(text);
      const captured = match?.[1]?.replace(/\s+/g, " ").trim();
      if (!captured || /^(?:品牌|型号|成色|颜色|功能状态|存储容量|内存容量|容量)\s*[：:]?$/.test(captured)) {
        continue;
      }
      const item = `${label}：${captured}`;
      if (!seen.has(item)) {
        seen.add(item);
        results.push(item);
      }
    }
    return results.join(" · ");
  }

  globalThis.XianzhiPageUtils = Object.freeze({
    toPrice,
    chooseBestPrice,
    normalizeImageUrl,
    countUniqueImageUrls,
    normalizePageTitle,
    trimRecommendationText,
    extractLabeledAttributes
  });
})();
