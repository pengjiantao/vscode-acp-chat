/**
 * Marked configuration with syntax highlighting via highlight.js.
 *
 * Provides a custom code-block renderer that highlights fenced code blocks
 * using highlight.js and wraps them in a container with a copy button.
 */

import { marked } from "marked";
import hljs from "highlight.js";
import { escapeHtml } from "./html-utils";

/**
 * Custom renderer override for fenced code blocks and links.
 * Attempts to highlight with the specified language; falls back to auto-detection.
 * On failure, returns the raw text to avoid breaking the render pipeline.
 */
const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const validLanguage = lang && hljs.getLanguage(lang) ? lang : undefined;
    let highlighted: string;

    if (validLanguage) {
      try {
        highlighted = hljs.highlight(text, { language: validLanguage }).value;
      } catch (err) {
        console.error("Highlight error:", err);
        highlighted = text;
      }
    } else {
      try {
        highlighted = hljs.highlightAuto(text).value;
      } catch (err) {
        console.error("Auto-highlight error:", err);
        highlighted = text;
      }
    }

    return `<div class="code-block-wrapper"><pre><code class="hljs ${validLanguage || ""}">${highlighted}</code></pre><button class="code-copy-btn" acp-title="Copy code"><span class="codicon codicon-copy"></span></button></div>`;
  },
  link({
    href,
    title,
    text,
  }: {
    href: string;
    title?: string | null;
    text: string;
  }) {
    const trimmed = href.trim();
    if (/^(javascript|data|vbscript):/i.test(trimmed)) {
      return text;
    }
    const escapedHref = escapeHtml(href);
    const escapedTitle = title ? escapeHtml(title) : "";
    const tooltipText = escapeHtml(title ? title : href);
    const titleAttr = escapedTitle ? ` title="${escapedTitle}"` : "";
    return `<a href="${escapedHref}"${titleAttr} acp-title="${tooltipText}">${text}</a>`;
  },
};

// Merge renderer and options into the global marked instance.
// `breaks: true` converts single newlines to <br> (GitHub-flavored behavior).
// `gfm: true` enables GitHub Flavored Markdown extensions (tables, strikethrough, etc.).
marked.use({
  breaks: true,
  gfm: true,
  renderer,
});

export { marked };
