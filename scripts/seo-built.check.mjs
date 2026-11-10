import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public search pages ship complete content and one scoped tracker", async () => {
  for (const [path, language, heading] of [
    ["index.html", "en", "CS Guess"],
    ["guide/index.html", "en", "Guess the Counter-Strike"],
    ["guide/zh/index.html", "zh-CN", "根据线索"],
  ]) {
    const html = await readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");
    assert.ok(html.includes(`<html lang="${language}">`));
    assert.match(html, new RegExp(`<h1>[^<]*${heading}`));
    assert.match(html, /<link rel="canonical" href="https:\/\/cs-guess\.zxilly\.com\//);
    assert.equal((html.match(/src="https:\/\/trail\.learningman\.top\/script\.js"/g) ?? []).length, 1);
    assert.match(html, /data-domains="cs-guess\.zxilly\.com"/);
    assert.match(html, /data-exclude-search="true"/);
    assert.match(html, /data-exclude-hash="true"/);
    assert.doesNotMatch(html, /name="robots" content="noindex/);
    if (path.startsWith("guide/")) {
      assert.match(html, /<a class="play" href="\/"/);
      assert.match(html, /hreflang="zh-CN"/);
      assert.match(html, /hreflang="en"/);
      assert.doesNotMatch(html, /type="module"|socket\.io|players\.generated/);
    }
  }
  const sitemap = await readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 3);
  assert.doesNotMatch(sitemap, /\/identity|\/play\/|\/room/);
});
