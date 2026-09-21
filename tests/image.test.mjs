import test from "node:test";
import assert from "node:assert/strict";

await import("../src/page-utils.js");
const { normalizeImageUrl, countUniqueImageUrls } = globalThis.XianzhiPageUtils;

test("同一商品图的原图和缩略图会去重", () => {
  const original = "https://gw.alicdn.com/imgextra/i1/demo/O1CN01abc.jpg";
  const thumbnail = "https://gw.alicdn.com/imgextra/i1/demo/O1CN01abc.jpg_400x400q90.jpg_.webp";
  assert.equal(normalizeImageUrl(original), normalizeImageUrl(thumbnail));
  assert.equal(countUniqueImageUrls([original, thumbnail]), 1);
});

test("查询参数不同的同一图片会去重", () => {
  assert.equal(
    countUniqueImageUrls([
      "https://example.com/product/a.png?width=100",
      "https://example.com/product/a.png?width=800#preview"
    ]),
    1
  );
});

test("不同商品图片保持独立计数并忽略内嵌资源", () => {
  assert.equal(
    countUniqueImageUrls([
      "https://example.com/product/a.jpg",
      "https://example.com/product/b.jpg",
      "data:image/png;base64,AAAA",
      ""
    ]),
    2
  );
});
