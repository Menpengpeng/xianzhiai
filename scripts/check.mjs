import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textExtensions = new Set([".json", ".js", ".mjs", ".html", ".css", ".md", ".svg"]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

const manifestText = fs.readFileSync(path.join(root, "manifest.json"), "utf8").replace(/^\uFEFF/, "");
const manifest = JSON.parse(manifestText);
const referencedFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((item) => item.js),
  ...manifest.web_accessible_resources.flatMap((item) => item.resources),
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon)
];

for (const relativePath of referencedFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`清单引用文件不存在：${relativePath}`);
}

for (const file of walk(root)) {
  if (!textExtensions.has(path.extname(file))) continue;
  const bytes = fs.readFileSync(file);
  if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    throw new Error(`文本文件不是 UTF-8 with BOM：${path.relative(root, file)}`);
  }
  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error(`发现乱码替代字符：${path.relative(root, file)}`);
}

for (const htmlFile of ["src/options.html", "src/popup.html"]) {
  const html = fs.readFileSync(path.join(root, htmlFile), "utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error(`发现内联脚本，不符合扩展 CSP：${htmlFile}`);
  }
}

console.log(`检查通过：Manifest V${manifest.manifest_version}，${referencedFiles.length} 个清单资源，全部文本为 UTF-8 with BOM。`);
