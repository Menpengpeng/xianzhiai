import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatCompletionsUrl,
  createDefaultSettings,
  mergeSettings,
  parseModelResult,
  sanitizeProduct
} from "../src/core.js";

test("补全兼容接口地址", () => {
  assert.equal(buildChatCompletionsUrl("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  assert.equal(buildChatCompletionsUrl("https://example.com/v1/chat/completions"), "https://example.com/v1/chat/completions");
  assert.throws(() => buildChatCompletionsUrl("example.com/v1"));
});

test("解析带代码围栏的模型 JSON", () => {
  const result = parseModelResult(
    "```json\n" +
    '{"suggestedPrice":930,"priceRange":{"min":1080,"max":880},"confidence":"medium","verdict":"偏高","summary":"成色一般","factors":["年份","成色"],"risks":[],"questions":[],"negotiationText":"可以少一些吗"}' +
    "\n```"
  );
  assert.equal(result.suggestedPrice, 930);
  assert.deepEqual(result.priceRange, { min: 880, max: 1080 });
  assert.equal(result.confidence, "中");
});

test("发送前隐藏手机号与邮箱", () => {
  const product = sanitizeProduct({
    title: "测试商品",
    description: "联系 13800138000 或 seller@example.com",
    price: "¥ 1,299"
  });
  assert.equal(product.price, 1299);
  assert.equal(product.description.includes("13800138000"), false);
  assert.equal(product.description.includes("seller@example.com"), false);
});

test("损坏设置会与默认值合并", () => {
  const settings = mergeSettings({ activeProvider: "missing", providers: { deepseek: { model: "demo" } } });
  assert.equal(settings.activeProvider, "deepseek");
  assert.equal(settings.providers.deepseek.model, "demo");
  assert.equal(Object.keys(settings.providers).length, Object.keys(createDefaultSettings().providers).length);
});
