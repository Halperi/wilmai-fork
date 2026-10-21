import * as cheerio from "cheerio";

const BLOCKS = "p, div, tr, h1, h2, h3, h4, h5, h6, blockquote, table, ul, ol";
/** Stands in for a nested list item's indent until spaces are tidied (then two spaces per level). */
const INDENT = "\u0002";

/**
 * Readable text from a fragment of Wilma HTML (message, reply and bulletin
 * bodies): paragraphs and line breaks kept, list items bulleted ("- ", or
 * "1. " in a numbered list) and indented two spaces per nested level, and
 * links written as "label (address)" so the address isn't lost.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  // Wilma's editor writes "<br>" and then a newline in the source: one line break, not two.
  const $ = cheerio.load(`<div id="wilmai-root">${html.replace(/<br\s*\/?>[ \t]*\r?\n/gi, "<br>")}</div>`);
  const root = $("#wilmai-root");
  root.find("script, style").remove();
  root.find("a[href]").each((_, anchor) => {
    const link = $(anchor);
    const href = (link.attr("href") ?? "").trim();
    const label = link.text().replace(/\s+/g, " ").trim();
    if (!/^(https?:|mailto:)/i.test(href)) return;
    const address = href.replace(/^mailto:/i, "");
    if (!label) link.text(address);
    else if (!label.includes(address) && !address.includes(label)) link.text(`${label} (${address})`);
  });
  root.find("br").replaceWith("\n");
  // The source's line breaks and tabs around list items aren't text (they made blank lines).
  root.find("ul, ol, li").each((_, el) => {
    $(el)
      .contents()
      .filter((_, node) => node.type === "text" && !$(node).text().trim())
      .remove();
  });
  root.find("li > ul, li > ol").each((_, list) => {
    const before = list.prev;
    if (before?.type === "text") before.data = before.data.replace(/\s+$/, "");
  });
  root.find(BLOCKS).each((_, block) => {
    const el = $(block);
    // A list inside an item starts on the next line; the item ends where the list does.
    if (el.is("ul, ol") && el.parents("li").length) {
      el.prepend("\n");
      return;
    }
    // A paragraph that opens or closes an item stays on the bullet's line.
    const inItem = el.parent().is("li") && el.is("p, div");
    if (!(inItem && el.prev().length === 0)) el.prepend("\n");
    if (!(inItem && el.next().length === 0)) el.append("\n");
  });
  root.find("li").each((_, item) => {
    const li = $(item);
    const list = li.parent();
    const marker = list.is("ol") ? `${list.children("li").index(li) + (Number(list.attr("start")) || 1)}. ` : "- ";
    li.prepend(INDENT.repeat(li.parents("li").length) + marker);
    if (!li.contents().last().is("ul, ol")) li.append("\n");
  });
  return root
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(new RegExp(INDENT, "g"), "  ")
    .trim();
}
