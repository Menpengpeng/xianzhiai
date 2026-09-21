import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultSettings } from "../src/core.js";

const settings = createDefaultSettings();
settings.providers.deepseek.apiKey = "test-key";
let messageListener;
let fetchResponses = [];
let requestBodies = [];

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({ xianzhiSettings: settings }),
      set: async () => {}
    }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: {
      addListener: (listener) => {
        messageListener = listener;
      }
    },
    openOptionsPage: async () => {}
  }
};

globalThis.fetch = async (_url, options) => {
  requestBodies.push(JSON.parse(options.body));
  const content = fetchResponses.shift();
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

await import("../src/service-worker.js");

function dispatch(message) {
  return new Promise((resolve) => {
    messageListener(message, {}, resolve);
  });
}

test("DeepSeek 使用 JSON 模式并在空内容后自动重试", async () => {
  fetchResponses = [
    "",
    JSON.stringify({
      suggestedPrice: 930,
      priceRange: { min: 880, max: 980 },
      confidence: "中",
      verdict: "合理",
      summary: "价格合理",
      factors: ["型号"],
      risks: [],
      questions: [],
      negotiationText: "可以优惠一些吗"
    })
  ];
  requestBodies = [];

  const response = await dispatch({
    type: "ANALYZE",
    providerId: "deepseek",
    requestId: "retry-success",
    product: { title: "Mac mini", price: 930 }
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.suggestedPrice, 930);
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
  assert.deepEqual(requestBodies[1].response_format, { type: "json_object" });
  assert.match(requestBodies[1].messages.at(-1).content, /重新完成同一个估价任务/);
});

test("连续两次非 JSON 时返回可操作的错误", async () => {
  fetchResponses = ["暂时无法判断", "仍然无法判断"];
  requestBodies = [];

  const response = await dispatch({
    type: "ANALYZE",
    providerId: "deepseek",
    requestId: "retry-failed",
    product: { title: "测试商品", price: 100 }
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /已自动重试一次/);
  assert.equal(requestBodies.length, 2);
});
