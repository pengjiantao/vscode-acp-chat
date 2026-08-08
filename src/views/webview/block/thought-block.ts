import { BlockWidget } from "./block-widget";
import { ScrollFadeController } from "../widget/scroll-fade";
import type { WebviewContext } from "../context";
import { marked } from "../marked-config";

/**
 * Streaming thought block. Renders as a collapsible <details> element
 * showing the assistant's reasoning. Auto-collapses on finalize().
 */
export class ThoughtBlock extends BlockWidget {
  private rawContent = "";
  private scrollFade: ScrollFadeController;

  constructor(
    ctx: WebviewContext,
    element: HTMLElement,
    contentEl: HTMLElement,
    scrollFade: ScrollFadeController
  ) {
    super(ctx, element, contentEl, "thought:main", "thought");
    this.scrollFade = scrollFade;
  }

  static create(ctx: WebviewContext): ThoughtBlock {
    const blockEl = ctx.doc.createElement("div");
    blockEl.className = "block block-thought";

    const details = ctx.doc.createElement("details");
    details.className = "agent-thought";
    details.setAttribute("open", "");
    details.setAttribute("role", "status");
    details.setAttribute("aria-live", "polite");
    details.setAttribute("aria-label", "Assistant is thinking");
    details.innerHTML = `
      <summary class="thought-header">
        <span class="thought-icon"><span class="codicon codicon-lightbulb"></span></span>
        <span class="thought-title">Thinking...</span>
      </summary>
      <div class="thought-content"></div>
    `;
    blockEl.appendChild(details);

    const contentEl = details.querySelector(".thought-content")! as HTMLElement;
    const scrollFade = new ScrollFadeController(ctx.doc, contentEl);
    return new ThoughtBlock(ctx, blockEl, contentEl, scrollFade);
  }

  appendContent(text: string): void {
    this.rawContent += text;
    this.contentEl.innerHTML = marked.parse(this.rawContent) as string;
    this.scrollFade.scrollToBottom();
  }

  finalize(): void {
    this.scrollFade.dispose();
    const details = this.element.querySelector("details");
    if (details) {
      details.removeAttribute("open");
      const title = details.querySelector(".thought-title");
      if (title) title.textContent = "Thought Process";
    }
  }
}
