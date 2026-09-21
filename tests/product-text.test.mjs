import test from "node:test";
import assert from "node:assert/strict";

await import("../src/page-utils.js");
const {
  normalizePageTitle,
  trimRecommendationText,
  extractLabeledAttributes
} = globalThis.XianzhiPageUtils;

test("页面标题会移除闲鱼站点后缀", () => {
  assert.equal(
    normalizePageTitle("个人闲置出苹果-Mac mini（2012 年末机型），银色_闲鱼"),
    "个人闲置出苹果-Mac mini（2012 年末机型），银色"
  );
});

test("商品摘要会在推荐区域之前截断", () => {
  const text = "商品标题\n¥450.00\n品牌：Apple/苹果\n为你推荐\n推荐商品 ¥11492";
  assert.equal(trimRecommendationText(text), "商品标题\n¥450.00\n品牌：Apple/苹果");
  assert.equal(trimRecommendationText(text).includes("11492"), false);
});

test("纵向拆分的商品属性会重新组合", () => {
  const text = [
    "品",
    "牌",
    "：",
    "Apple/苹果",
    "功",
    "能",
    "状",
    "态",
    "：",
    "无拆修，可正常使用"
  ].join("\n");
  assert.equal(
    extractLabeledAttributes(text),
    "品牌：Apple/苹果 · 功能状态：无拆修，可正常使用"
  );
});
