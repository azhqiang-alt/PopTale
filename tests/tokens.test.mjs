// The text format is a contract between src/tokens.js and tools/build_voice.py: timings.json
// holds one entry per token, so both must split every text the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tokenize } from "../src/tokens.js";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf-8"));

function pythonTokens(texts) {
  const script = "import json,sys; sys.path.insert(0,'tools'); import build_voice as bv; " +
    "print(json.dumps([bv.tokens(t) for t in json.load(sys.stdin)], ensure_ascii=False))";
  return JSON.parse(execFileSync("python3", ["-c", script], { cwd: root, input: JSON.stringify(texts) }).toString());
}

const books = read("public/books/index.json").books.map((b) => b.id);
const pagesOf = (id) => {
  const story = read(`public/books/${id}/story.json`);
  return [...story.pages, story.end].map((p) => p.text);
};

const edgeCases = [
  "夜深了， {小兔乐乐:lele/look} 还 没有 {睡着:lele/yawn}。",
  "  前后 有空格  ",
  "全角　空格 和\t制表符",
  "{只有词} {词:物件} {词:物件/动作}",
  "“{星星:star/fall}！” 她 说。",
  "English words {star:star/twinkle}, too.",
];

test("JS and Python tokenize the edge cases alike", () => {
  const py = pythonTokens(edgeCases);
  edgeCases.forEach((text, i) => assert.deepEqual(tokenize(text).map((t) => t.text), py[i], text));
});

for (const id of books) {
  test(`${id}: JS and Python tokenize every page alike`, () => {
    const texts = pagesOf(id);
    const py = pythonTokens(texts);
    texts.forEach((text, i) => assert.deepEqual(tokenize(text).map((t) => t.text), py[i], `page ${i + 1}`));
  });

  test(`${id}: timings.json has one entry per token`, () => {
    const timings = read(`public/books/${id}/voice/timings.json`);
    pagesOf(id).forEach((text, i) => {
      const t = timings[`page-${i + 1}`];
      assert.equal(t.length, tokenize(text).length, `page ${i + 1}`);
      t.forEach((w, k) => assert.ok(w.start <= w.end && (k === 0 || t[k - 1].start <= w.start), `page ${i + 1} word ${k}`));
    });
  });
}

test("a link reads its object and action", () => {
  const [t] = tokenize("{小星星:star/fall}！");
  assert.deepEqual({ text: t.text, word: t.word, link: t.link, action: t.action },
    { text: "小星星！", word: "小星星", link: "star", action: "fall" });
});
