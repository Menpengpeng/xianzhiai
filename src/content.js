(() => {
  const ROOT_ID = "xianzhi-ai-extension-root";
  const PRODUCT_URL_PATTERN = /(?:\/item(?:\/|\.|\?|$)|item\.htm|[?&]id=)/i;
  const pageUtils = globalThis.XianzhiPageUtils;
  let app = null;
  let lastUrl = location.href;

  function send(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "扩展操作失败");
      return response;
    });
  }

  function clean(value, limit = 5000) {
    return String(value || "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[已隐藏邮箱]")
      .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[已隐藏手机号]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function meta(name) {
    return document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || "";
  }

  function findProductJsonLd() {
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    const products = [];
    for (const node of nodes) {
      try {
        const parsed = JSON.parse(node.textContent || "{}");
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const current = queue.shift();
          if (!current || typeof current !== "object") continue;
          const type = Array.isArray(current["@type"]) ? current["@type"] : [current["@type"]];
          if (type.some((item) => /product/i.test(String(item)))) products.push(current);
          if (Array.isArray(current["@graph"])) queue.push(...current["@graph"]);
        }
      } catch {
        // 忽略页面中无效的结构化数据。
      }
    }
    const itemId = new URL(location.href).searchParams.get("id") || "";
    const pageTitle = pageUtils?.normalizePageTitle(document.title) || "";

    return products
      .map((product) => {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
        const name = clean(product.name, 300);
        const references = [product.url, product["@id"], offer.url].filter(Boolean).join(" ");
        let score = 0;
        if (/^(?:为你推荐|猜你喜欢|相关推荐|相似推荐)$/.test(name)) score -= 200;
        if (itemId && references.includes(itemId)) score += 120;
        if (name && pageTitle && (pageTitle.includes(name) || name.includes(pageTitle))) score += 80;
        score += Math.min(clean(product.description, 1000).length, 400) / 20;
        score += Math.min(structuredImageCount(product), 20) * 3;
        return { product, score };
      })
      .sort((left, right) => right.score - left.score)[0]?.product || {};
  }

  function firstVisibleText(selectors, limit = 500) {
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const element of candidates) {
        const text = clean(element.textContent, limit);
        const rect = element.getBoundingClientRect();
        if (text && rect.width > 0 && rect.height > 0) return text;
      }
    }
    return "";
  }

  function findProductPrice(offer) {
    const candidates = [
      { value: offer?.price, allowBare: true, score: 40, priceLike: true },
      { value: meta("product:price:amount"), allowBare: true, score: 35, priceLike: true }
    ];
    const visited = new Set();

    function addElement(element, extraScore = 0) {
      if (!(element instanceof HTMLElement) || visited.has(element)) return;
      visited.add(element);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return;

      const text = clean(element.textContent, 220);
      if (!text) return;
      const marker = [
        element.id,
        typeof element.className === "string" ? element.className : "",
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label")
      ].filter(Boolean).join(" ");
      const priceLike = /price|amount|售价|价格|现价/i.test(marker);
      const descendantFontSizes = Array.from(
        element.querySelectorAll("strong, b, em, span")
      )
        .slice(0, 16)
        .map((child) => Number.parseFloat(getComputedStyle(child).fontSize))
        .filter(Number.isFinite);
      candidates.push({
        text,
        allowBare: priceLike,
        priceLike,
        fontSize: Math.max(Number.parseFloat(style.fontSize) || 0, ...descendantFontSizes),
        score:
          extraScore +
          (element.closest("main, [role='main']") ? 15 : 0) +
          (element.closest("header, nav, footer") ? -40 : 0)
      });
    }

    function visibleRect(element) {
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return null;
      return { rect, style };
    }

    const priceLeaves = Array.from(
      document.querySelectorAll("span, strong, b, em, i, div")
    );
    const currencyElements = priceLeaves
      .map((element) => ({ element, view: visibleRect(element), text: clean(element.textContent, 12) }))
      .filter(({ element, view, text }) =>
        view &&
        /^[¥￥]$/.test(text) &&
        !element.closest("header, nav, footer")
      )
      .slice(0, 60);
    const numberElements = priceLeaves
      .map((element) => ({ element, view: visibleRect(element), text: clean(element.textContent, 32) }))
      .filter(({ element, view, text }) =>
        view &&
        element.children.length === 0 &&
        /^\d[\d,]*(?:\.\d{1,2})?$/.test(text) &&
        Number.parseFloat(view.style.fontSize) >= 20 &&
        !element.closest("header, nav, footer")
      )
      .slice(0, 160);

    for (const numberItem of numberElements) {
      const numberRect = numberItem.view.rect;
      const numberCenterY = numberRect.top + numberRect.height / 2;
      let nearest = null;
      for (const currencyItem of currencyElements) {
        const currencyRect = currencyItem.view.rect;
        const currencyCenterY = currencyRect.top + currencyRect.height / 2;
        const verticalDistance = Math.abs(numberCenterY - currencyCenterY);
        const horizontalGap = numberRect.left - currencyRect.right;
        if (
          verticalDistance > Math.max(18, numberRect.height * 0.75) ||
          horizontalGap < -12 ||
          horizontalGap > 90
        ) continue;
        const distance = verticalDistance + Math.abs(horizontalGap);
        if (!nearest || distance < nearest.distance) {
          nearest = { currencyItem, distance };
        }
      }
      if (!nearest) continue;
      candidates.push({
        text: `${nearest.currencyItem.text}${numberItem.text}`,
        priceLike: true,
        fontSize: Number.parseFloat(numberItem.view.style.fontSize),
        score: 150
      });
    }

    document
      .querySelectorAll(
        '[class*="price" i], [id*="price" i], [data-testid*="price" i], [aria-label*="价格"], [aria-label*="售价"]'
      )
      .forEach((element) => addElement(element, 35));

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let currencyNodes = 0;
    while ((node = walker.nextNode()) && currencyNodes < 80) {
      if (!/[¥￥]|(?:\d[\d,.]*)\s*元/.test(node.nodeValue || "")) continue;
      currencyNodes += 1;
      let element = node.parentElement;
      for (let level = 0; element && level < 8; level += 1) {
        if (/^(?:BODY|HTML)$/.test(element.tagName)) break;
        addElement(element, 30 - level * 5);
        element = element.parentElement;
      }
    }

    return pageUtils?.chooseBestPrice(candidates) ?? null;
  }

  function imageSource(image) {
    return (
      image.currentSrc ||
      image.src ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-lazy-src") ||
      ""
    );
  }

  function imageCountIn(root) {
    if (!root) return 0;
    return pageUtils?.countUniqueImageUrls(
      Array.from(root.querySelectorAll("img")).map(imageSource)
    ) ?? 0;
  }

  function markerFor(element) {
    return [
      element?.id,
      typeof element?.className === "string" ? element.className : "",
      element?.getAttribute?.("data-testid"),
      element?.getAttribute?.("aria-label")
    ].filter(Boolean).join(" ");
  }

  function isNonProductImageArea(element) {
    if (!element) return true;
    if (element.closest("header, nav, footer")) return true;
    return /recommend|guess|similar|related|avatar|logo|icon|comment|seller|user|search|推荐|猜你喜欢|相似/i.test(
      markerFor(element.closest("[class], [id], [data-testid]") || element)
    );
  }

  function structuredImageCount(jsonLd) {
    const values = [];
    const queue = Array.isArray(jsonLd?.image) ? [...jsonLd.image] : [jsonLd?.image];
    for (const item of queue) {
      if (typeof item === "string") values.push(item);
      else if (item && typeof item === "object") {
        values.push(item.url, item.contentUrl, item.thumbnailUrl);
      }
    }
    return pageUtils?.countUniqueImageUrls(values) ?? 0;
  }

  function findProductImageCount(jsonLd) {
    const structuredCount = structuredImageCount(jsonLd);
    const images = Array.from(document.images).filter((image) => {
      if (!imageSource(image) || isNonProductImageArea(image)) return false;
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width >= 60 &&
        rect.height >= 60
      );
    });
    const hero = images
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return { image, area: rect.width * rect.height };
      })
      .sort((left, right) => right.area - left.area)[0]?.image;
    if (!hero) return structuredCount;

    const roots = new Set();
    document
      .querySelectorAll(
        '[class*="gallery" i], [class*="carousel" i], [class*="swiper" i], [class*="slider" i], [class*="thumb" i], [class*="image-list" i], [class*="imagelist" i], [class*="picture-list" i], [data-testid*="gallery" i]'
      )
      .forEach((element) => roots.add(element));
    let ancestor = hero.parentElement;
    for (let level = 0; ancestor && level < 8; level += 1) {
      if (/^(?:MAIN|BODY|HTML)$/.test(ancestor.tagName)) break;
      roots.add(ancestor);
      ancestor = ancestor.parentElement;
    }

    let best = { count: structuredCount, score: structuredCount ? 20 : 0 };
    for (const root of roots) {
      if (!(root instanceof HTMLElement) || isNonProductImageArea(root)) continue;
      const count = imageCountIn(root);
      if (!count || count > 30) continue;
      const marker = markerFor(root);
      const containsHero = root.contains(hero);
      let score = Math.min(count, 20) * 5;
      if (containsHero) score += 35;
      if (/gallery|carousel|swiper|slider|thumb|image-list|imagelist|picture-list/i.test(marker)) {
        score += 45;
      }
      const textLength = clean(root.textContent, 1600).length;
      if (textLength <= 400) score += 12;
      else if (textLength > 1200) score -= 30;
      if (count > 20) score -= 45;
      if (score > best.score) best = { count, score };
    }
    return best.count || structuredCount;
  }

  function extractProduct() {
    const jsonLd = findProductJsonLd();
    const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers || {};
    const productRoot = document.querySelector("main") || document.body;
    const productText = pageUtils?.trimRecommendationText(productRoot?.innerText || "") || "";
    const pageTitle = pageUtils?.normalizePageTitle(document.title) || "";
    const socialTitle = pageUtils?.normalizePageTitle(meta("og:title")) || "";
    const structuredTitle = clean(jsonLd.name, 300);
    const visibleTitle = firstVisibleText(["h1", "[class*='title']", "[class*='Title']"], 300);
    const title = clean(
      [pageTitle, socialTitle, structuredTitle, visibleTitle].find(
        (candidate) => candidate && !/^(?:为你推荐|猜你喜欢|相关推荐|相似推荐)$/.test(candidate)
      ),
      300
    );
    const description = clean(
      jsonLd.description ||
      meta("og:description") ||
      firstVisibleText(
        ["[class*='description']", "[class*='desc']", "[class*='detail']"],
        5000
      ) ||
      productText,
      5000
    );
    const price = findProductPrice(offer);
    const labeledAttributes = pageUtils?.extractLabeledAttributes(productText) || "";
    const selectedAttributes = Array.from(
      document.querySelectorAll(
        "[class*='attribute'], [class*='parameter'], [class*='spec'], [class*='sku']"
      )
    )
      .slice(0, 20)
      .map((element) => element.textContent)
      .join(" · ");
    const attributes = clean(
      [labeledAttributes, selectedAttributes].filter(Boolean).join(" · "),
      2500
    );
    const mainText = clean(productText, 5000);
    const imageCount = findProductImageCount(jsonLd);

    return {
      id: new URL(location.href).searchParams.get("id") || location.pathname.split("/").filter(Boolean).pop() || "",
      url: location.href,
      title,
      description,
      price,
      currency: offer.priceCurrency || "CNY",
      category: clean(jsonLd.category, 120),
      attributes,
      visibleSummary: mainText,
      imageCount: Math.min(imageCount, 30)
    };
  }

  function looksLikeProductPage() {
    return PRODUCT_URL_PATTERN.test(location.href) || Boolean(meta("product:price:amount"));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "信息不足";
    return `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function mountApp(publicSettings) {
    if (document.getElementById(ROOT_ID)) return app;

    const host = document.createElement("div");
    host.id = ROOT_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("src/content-ui.css");
    shadow.appendChild(stylesheet);

    const shell = document.createElement("div");
    shell.className = "xz-shell";
    shell.innerHTML = `
      <button type="button" class="xz-entry" id="xz-entry" aria-label="打开闲值 AI 估价">
        <span class="xz-entry-logo" aria-hidden="true">闲</span>
        <span id="xz-entry-label">AI 估价</span>
      </button>
      <aside class="xz-drawer" id="xz-drawer" aria-label="闲值 AI 估价侧栏" aria-hidden="true">
        <header class="xz-header">
          <span class="xz-logo" aria-hidden="true">闲</span>
          <span class="xz-brand"><strong>闲值 AI</strong><small>第三方 AI 助手 · 非闲鱼官方</small></span>
          <span class="xz-header-actions">
            <button type="button" class="xz-icon-button" id="xz-settings" aria-label="打开插件设置">⚙</button>
            <button type="button" class="xz-icon-button" id="xz-close" aria-label="关闭侧栏">×</button>
          </span>
        </header>
        <main class="xz-body">
          <section class="xz-card xz-product" aria-label="当前商品">
            <span class="xz-product-thumb" aria-hidden="true">闲</span>
            <span class="xz-product-copy">
              <strong id="xz-product-title">正在识别商品…</strong>
              <small id="xz-product-meta"></small>
            </span>
            <span class="xz-success" id="xz-product-status">读取中</span>
          </section>

          <section class="xz-card xz-provider">
            <label for="xz-provider">本次使用</label>
            <select id="xz-provider" aria-label="模型提供商"></select>
          </section>

          <section class="xz-callout xz-hidden" id="xz-setup-callout">
            <strong>先完成模型配置</strong>
            <span>API Key 仅保存在当前浏览器，模型请求不经过插件后端。</span>
            <button type="button" class="xz-secondary" id="xz-open-options">打开设置</button>
          </section>

          <details class="xz-details">
            <summary>补充商品信息</summary>
            <label for="xz-supplemental">可填写配件、维修史、电池健康等页面未展示的信息</label>
            <textarea id="xz-supplemental" rows="3" maxlength="2000" placeholder="例如：带原装电源，无维修，硬盘健康度 92%"></textarea>
          </details>

          <button type="button" class="xz-primary" id="xz-analyze">开始估价</button>
          <button type="button" class="xz-secondary xz-hidden" id="xz-cancel-analysis">取消分析</button>
          <div class="xz-status" id="xz-status" role="status" aria-live="polite"></div>

          <section class="xz-card xz-empty-result" id="xz-result" aria-live="polite">
            <strong>准备就绪</strong>
            <span>点击“开始估价”后，将由你选择的模型生成价格建议和风险提示。</span>
          </section>

          <p class="xz-disclaimer" id="xz-disclaimer">AI 建议仅供参考，不代表实时成交价或鉴定结论。</p>
        </main>

        <div class="xz-close-layer xz-hidden" id="xz-close-layer" role="dialog" aria-modal="true" aria-labelledby="xz-close-title">
          <section class="xz-close-dialog">
            <span class="xz-close-title"><strong id="xz-close-title">关闭闲值 AI</strong><small>选择关闭范围，禁用后可从扩展设置重新开启。</small></span>
            <fieldset>
              <legend class="xz-sr-only">关闭范围</legend>
              <label class="xz-radio"><input type="radio" name="xz-close-scope" value="session" checked><span>本次关闭<small>再次访问商品页时恢复</small></span></label>
              <label class="xz-radio"><input type="radio" name="xz-close-scope" value="site"><span>当前网站禁用<small>可从扩展菜单或设置页开启</small></span></label>
              <label class="xz-radio"><input type="radio" name="xz-close-scope" value="always"><span>永久禁用<small>可从扩展菜单或设置页开启</small></span></label>
            </fieldset>
            <span class="xz-close-actions">
              <button type="button" class="xz-secondary" id="xz-close-cancel">取消</button>
              <button type="button" class="xz-primary" id="xz-close-save">保存</button>
            </span>
          </section>
        </div>

        <div class="xz-reward-layer xz-hidden" id="xz-reward-layer" role="dialog" aria-modal="true" aria-labelledby="xz-reward-title" aria-describedby="xz-reward-description">
          <section class="xz-reward-dialog">
            <span class="xz-reward-title">
              <span><strong id="xz-reward-title">赞赏作者</strong><small id="xz-reward-description">如果闲值 AI 对你有帮助，欢迎请作者吃颗糖。</small></span>
              <button type="button" class="xz-reward-close" id="xz-reward-close" aria-label="关闭赞赏码">×</button>
            </span>
            <img class="xz-reward-code" src="${chrome.runtime.getURL("assets/reward-code.png")}" alt="作者微信赞赏码">
            <small class="xz-reward-thanks">感谢你的支持，每一份赞赏都会帮助插件继续完善。</small>
          </section>
        </div>
      </aside>
      <div class="xz-toast" id="xz-toast" role="status" aria-live="polite"></div>
    `;
    shadow.appendChild(shell);
    document.documentElement.appendChild(host);

    const state = {
      host,
      shadow,
      shell,
      publicSettings,
      product: extractProduct(),
      result: null,
      providerName: "",
      requestId: null,
      analyzing: false
    };

    const query = (selector) => shadow.querySelector(selector);
    const drawer = query("#xz-drawer");
    const entry = query("#xz-entry");
    const resultRoot = query("#xz-result");
    const providerSelect = query("#xz-provider");
    const closeLayer = query("#xz-close-layer");
    const rewardLayer = query("#xz-reward-layer");
    let rewardReturnFocus = null;

    function toast(message) {
      const node = query("#xz-toast");
      node.textContent = message;
      node.classList.add("is-show");
      window.setTimeout(() => node.classList.remove("is-show"), 1800);
    }

    async function openOptions() {
      try {
        await send({ type: "OPEN_OPTIONS" });
      } catch {
        toast("无法打开设置，请点击浏览器工具栏中的闲值 AI 图标");
      }
    }

    function openDrawer() {
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      query("#xz-close").focus();
    }

    function closeDrawer() {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      entry.focus();
    }

    function openReward(trigger) {
      rewardReturnFocus = trigger;
      rewardLayer.classList.remove("xz-hidden");
      query("#xz-reward-close").focus();
    }

    function closeReward() {
      rewardLayer.classList.add("xz-hidden");
      if (rewardReturnFocus?.isConnected) rewardReturnFocus.focus();
    }

    function renderProduct() {
      state.product = extractProduct();
      query("#xz-product-title").textContent = state.product.title || "未识别到商品标题";
      query("#xz-product-meta").textContent = [
        state.product.price === null ? "价格未识别" : `页面价 ${formatMoney(state.product.price)}`,
        state.product.imageCount ? `${state.product.imageCount} 张图片` : ""
      ].filter(Boolean).join(" · ");
      query("#xz-product-status").textContent = state.product.title ? "✓ 已识别" : "需补充";
    }

    function renderProviders() {
      const previous = providerSelect.value || state.publicSettings.activeProvider;
      providerSelect.replaceChildren();
      for (const provider of Object.values(state.publicSettings.providers)) {
        const option = document.createElement("option");
        option.value = provider.id;
        option.textContent = `${provider.name}${provider.configured ? ` · ${provider.model}` : " · 待配置"}`;
        providerSelect.appendChild(option);
      }
      providerSelect.value = state.publicSettings.providers[previous]
        ? previous
        : state.publicSettings.activeProvider;
      const configured = state.publicSettings.providers[providerSelect.value]?.configured;
      query("#xz-setup-callout").classList.toggle("xz-hidden", configured);
      query("#xz-analyze").disabled = !configured || state.analyzing;
    }

    function clearResult() {
      state.result = null;
      resultRoot.className = "xz-card xz-empty-result";
      resultRoot.replaceChildren(
        element("strong", "", "准备就绪"),
        element("span", "", "点击“开始估价”后，将由你选择的模型生成价格建议和风险提示。")
      );
      query("#xz-entry-label").textContent = "AI 估价";
    }

    function appendList(parent, title, values) {
      if (!values?.length) return;
      const section = element("section", "xz-result-section");
      section.appendChild(element("strong", "", title));
      const list = element("ul");
      for (const value of values) list.appendChild(element("li", "", value));
      section.appendChild(list);
      parent.appendChild(section);
    }

    function resultCopyText(result) {
      const range = result.priceRange.min === null || result.priceRange.max === null
        ? "信息不足"
        : `${formatMoney(result.priceRange.min)}–${formatMoney(result.priceRange.max)}`;
      return [
        `商品：${state.product.title || "未命名商品"}`,
        `AI 建议价：${formatMoney(result.suggestedPrice)}`,
        `合理区间：${range}`,
        `判断：${result.verdict}（${result.confidence}置信度）`,
        result.summary,
        result.factors.length ? `关键因素：\n- ${result.factors.join("\n- ")}` : "",
        result.risks.length ? `风险与缺失：\n- ${result.risks.join("\n- ")}` : "",
        result.disclaimer
      ].filter(Boolean).join("\n");
    }

    function renderResult(result) {
      state.result = result;
      resultRoot.className = "xz-card xz-result";
      resultRoot.replaceChildren();

      const head = element("div", "xz-result-head");
      const priceBlock = element("span", "xz-price-block");
      priceBlock.append(
        element("small", "", "AI 建议成交价"),
        element("strong", "", formatMoney(result.suggestedPrice))
      );
      head.append(
        priceBlock,
        element("span", "xz-confidence", `${result.confidence}置信度`)
      );
      resultRoot.appendChild(head);

      const range = element("div", "xz-range");
      range.append(
        element("span", "", "合理区间"),
        element(
          "strong",
          "",
          result.priceRange.min === null || result.priceRange.max === null
            ? "信息不足"
            : `${formatMoney(result.priceRange.min)} – ${formatMoney(result.priceRange.max)}`
        )
      );
      resultRoot.appendChild(range);

      const verdict = element("div", "xz-verdict");
      verdict.append(
        element("strong", "", `价格判断：${result.verdict}`),
        element("span", "", result.summary)
      );
      resultRoot.appendChild(verdict);
      appendList(resultRoot, "关键依据", result.factors);
      appendList(resultRoot, "风险与缺失", result.risks);
      appendList(resultRoot, "建议向卖家确认", result.questions);

      const actions = element("div", "xz-result-actions");
      const negotiationButton = element("button", "xz-secondary", "复制议价话术");
      negotiationButton.type = "button";
      negotiationButton.disabled = !result.negotiationText;
      negotiationButton.addEventListener("click", async () => {
        await copyText(result.negotiationText);
        toast("议价话术已复制");
      });
      const copyButton = element("button", "xz-secondary", "复制估价结果");
      copyButton.type = "button";
      copyButton.addEventListener("click", async () => {
        await copyText(resultCopyText(result));
        toast("估价结果已复制");
      });
      actions.append(negotiationButton, copyButton);
      resultRoot.appendChild(actions);

      const rewardButton = element("button", "xz-reward-button", "♡ 赞赏作者");
      rewardButton.type = "button";
      rewardButton.setAttribute("aria-haspopup", "dialog");
      rewardButton.addEventListener("click", () => openReward(rewardButton));
      resultRoot.appendChild(rewardButton);

      query("#xz-disclaimer").textContent = `结果由 ${state.providerName} 生成。 ${result.disclaimer}`;
      query("#xz-entry-label").textContent = result.suggestedPrice === null
        ? "查看估价"
        : `${formatMoney(result.suggestedPrice)} 建议价`;
    }

    async function startAnalysis() {
      if (state.analyzing) return;
      const providerId = providerSelect.value;
      if (!state.publicSettings.providers[providerId]?.configured) {
        query("#xz-setup-callout").classList.remove("xz-hidden");
        return;
      }
      state.analyzing = true;
      state.requestId = crypto.randomUUID();
      query("#xz-analyze").disabled = true;
      query("#xz-analyze").textContent = "正在请求模型…";
      query("#xz-cancel-analysis").classList.remove("xz-hidden");
      query("#xz-status").textContent = "正在读取商品并生成估价，模型服务可能产生少量费用。";
      query("#xz-entry-label").textContent = "正在估价…";

      try {
        renderProduct();
        const response = await send({
          type: "ANALYZE",
          requestId: state.requestId,
          providerId,
          product: state.product,
          supplemental: query("#xz-supplemental").value
        });
        state.providerName = response.providerName;
        renderResult(response.result);
        query("#xz-status").textContent = "估价已完成。";
      } catch (error) {
        query("#xz-status").textContent = error.message;
        query("#xz-entry-label").textContent = "AI 估价";
        toast(error.message);
      } finally {
        state.analyzing = false;
        state.requestId = null;
        query("#xz-analyze").disabled = false;
        query("#xz-analyze").textContent = state.result ? "重新估价" : "开始估价";
        query("#xz-cancel-analysis").classList.add("xz-hidden");
        renderProviders();
      }
    }

    entry.addEventListener("click", openDrawer);
    query("#xz-close").addEventListener("click", () => {
      closeLayer.classList.remove("xz-hidden");
      closeLayer.querySelector("input:checked")?.focus();
    });
    query("#xz-close-cancel").addEventListener("click", () => {
      closeLayer.classList.add("xz-hidden");
      query("#xz-close").focus();
    });
    closeLayer.addEventListener("click", (event) => {
      if (event.target === closeLayer) {
        closeLayer.classList.add("xz-hidden");
        query("#xz-close").focus();
      }
    });
    query("#xz-reward-close").addEventListener("click", closeReward);
    rewardLayer.addEventListener("click", (event) => {
      if (event.target === rewardLayer) closeReward();
    });
    query("#xz-close-save").addEventListener("click", async () => {
      const scope = closeLayer.querySelector('input[name="xz-close-scope"]:checked')?.value || "session";
      if (scope !== "session") {
        await send({ type: "SET_CLOSE_SCOPE", scope, origin: location.origin });
      }
      state.host.remove();
      app = null;
    });
    query("#xz-settings").addEventListener("click", () => void openOptions());
    query("#xz-open-options").addEventListener("click", () => void openOptions());
    query("#xz-analyze").addEventListener("click", startAnalysis);
    query("#xz-cancel-analysis").addEventListener("click", async () => {
      if (!state.requestId) return;
      await send({ type: "CANCEL_ANALYSIS", requestId: state.requestId });
    });
    providerSelect.addEventListener("change", async () => {
      await send({ type: "SET_ACTIVE_PROVIDER", providerId: providerSelect.value });
      state.publicSettings.activeProvider = providerSelect.value;
      renderProviders();
    });
    shadow.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!rewardLayer.classList.contains("xz-hidden")) {
        closeReward();
      } else if (!closeLayer.classList.contains("xz-hidden")) {
        closeLayer.classList.add("xz-hidden");
        query("#xz-close").focus();
      } else {
        closeDrawer();
      }
    });

    renderProduct();
    renderProviders();
    clearResult();
    app = state;
    return state;
  }

  async function initialize({ forceOpen = false } = {}) {
    if (!looksLikeProductPage()) return;
    if (app?.host?.isConnected) {
      if (forceOpen) app.shadow.querySelector("#xz-entry")?.click();
      return;
    }
    try {
      const visibility = await send({ type: "GET_VISIBILITY", origin: location.origin });
      if (!visibility.visible && !forceOpen) return;
      if (!visibility.visible && forceOpen) {
        await send({ type: "REENABLE", scope: "all", origin: location.origin });
      }
      const response = await send({ type: "GET_PUBLIC_SETTINGS" });
      const mounted = mountApp(response.settings);
      if (forceOpen) mounted?.shadow.querySelector("#xz-entry")?.click();
    } catch {
      // 页面功能不应因扩展初始化失败而受影响。
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_PANEL") {
      void initialize({ forceOpen: true }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "REFRESH_PRODUCT") {
      app?.shadow.querySelector("#xz-entry")?.click();
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.xianzhiSettings || !app) return;
    void send({ type: "GET_PUBLIC_SETTINGS" }).then((response) => {
      if (!response.settings.enabled || response.settings.disabledSites.includes(location.origin)) {
        app.host.remove();
        app = null;
        return;
      }
      app.publicSettings = response.settings;
      const select = app.shadow.querySelector("#xz-provider");
      if (select) {
        select.replaceChildren();
        for (const provider of Object.values(response.settings.providers)) {
          const option = document.createElement("option");
          option.value = provider.id;
          option.textContent = `${provider.name}${provider.configured ? ` · ${provider.model}` : " · 待配置"}`;
          select.appendChild(option);
        }
        select.value = response.settings.activeProvider;
        const configured = response.settings.providers[select.value]?.configured;
        app.shadow.querySelector("#xz-setup-callout")?.classList.toggle("xz-hidden", configured);
        const analyzeButton = app.shadow.querySelector("#xz-analyze");
        if (analyzeButton) analyzeButton.disabled = !configured || app.analyzing;
      }
    }).catch(() => {});
  });

  window.setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (app?.host?.isConnected) {
      app.product = extractProduct();
      app.result = null;
      app.shadow.querySelector("#xz-product-title").textContent = app.product.title || "未识别到商品标题";
      app.shadow.querySelector("#xz-entry-label").textContent = "AI 估价";
    } else {
      void initialize();
    }
  }, 1500);

  void initialize();
})();
