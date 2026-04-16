import { marked } from "marked";
import hljs from "highlight.js";

// Create a custom renderer with syntax highlighting
const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
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
    // Auto-detect language if not specified
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch (err) {
      console.error("Auto-highlight error:", err);
      highlighted = text;
    }
  }

  return `<pre><code class="hljs ${validLanguage || ""}">${highlighted}</code></pre>`;
};

// Configure marked for streaming (GFM and line breaks)
marked.setOptions({
  breaks: true,
  gfm: true,
  renderer: renderer,
});

export { marked };
