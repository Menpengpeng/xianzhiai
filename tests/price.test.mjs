import test from "node:test";
import assert from "node:assert/strict";

await import("../src/page-utils.js");
const { toPrice, chooseBestPrice } = globalThis.XianzhiPageUtils;

test("识别拆分节点父级中的人民币价格", () => {
  assert.equal(toPrice("¥ 930 包邮"), 930);
  assert.equal(toPrice("￥1,299.50"), 1299.5);
});

test("优先选择当前商品大号价格", () => {
  const price = chooseBestPrice([
    { text: "18 张图片", allowBare: true, priceLike: true, fontSize: 12 },
    { text: "原价 ¥1299", priceLike: true, fontSize: 14 },
    { text: "¥ 930 包邮", priceLike: true, fontSize: 32, score: 30 }
  ]);
  assert.equal(price, 930);
});

test("页面可见主价格优先于结构化占位价", () => {
  const price = chooseBestPrice([
    { value: 1, allowBare: true, priceLike: true, score: 40 },
    { text: "¥302 包邮", priceLike: true, fontSize: 32, score: 45 }
  ]);
  assert.equal(price, 302);
});

test("视觉相邻的大号价格优先于错误的结构化高价", () => {
  const price = chooseBestPrice([
    { value: 11492, allowBare: true, priceLike: true, score: 40 },
    { text: "¥450.00", priceLike: true, fontSize: 34, score: 150 }
  ]);
  assert.equal(price, 450);
});

test("没有货币语义时不误取页面普通数字", () => {
  assert.equal(toPrice("18 张图片"), null);
  assert.equal(chooseBestPrice([{ text: "2014 款 Mac mini", fontSize: 24 }]), null);
});
