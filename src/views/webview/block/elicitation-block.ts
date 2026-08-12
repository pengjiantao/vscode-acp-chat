import type { WebviewContext } from "../context";

/**
 * Minimal structural view of an ACP elicitation schema (subset of
 * `ElicitationSchema` from @agentclientprotocol/sdk). The webview keeps its
 * own copy so it does not depend on the SDK bundle at runtime.
 */
interface ElicitationFormSchema {
  title?: string | null;
  description?: string | null;
  properties?: Record<string, ElicitationPropertySchema>;
  required?: string[] | null;
}

type ElicitationPropertySchema = {
  title?: string | null;
  description?: string | null;
  type: string;
  default?: unknown;
  enum?: string[] | null;
  oneOf?: Array<{
    const: string;
    title?: string;
    description?: string | null;
  }> | null;
  format?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  minItems?: number | null;
  maxItems?: number | null;
  items?: {
    enum?: string[] | null;
    anyOf?: Array<{
      const: string;
      title?: string;
      description?: string | null;
    }> | null;
  } | null;
};

type ElicitationContentValue = string | number | boolean | Array<string>;

/** Payload describing a single elicitation request from the agent. */
export interface ElicitationBlockOptions {
  requestId: string;
  message?: string;
  mode?: "form" | "url";
  schema?: unknown;
  url?: string;
  elicitationId?: string;
}

/**
 * Elicitation block rendered inline in the message list.
 *
 * Each ACP `elicitation/create` request gets its own block, so concurrent
 * requests render independently instead of replacing each other. The block
 * is removed once the user responds, or when the host forwards an
 * `elicitation/complete` notification for its elicitation id.
 */
export class ElicitationBlock {
  readonly element: HTMLElement;
  private fields: Array<{
    key: string;
    prop: ElicitationPropertySchema;
    input: HTMLElement;
  }> = [];

  constructor(
    private ctx: WebviewContext,
    private opts: ElicitationBlockOptions
  ) {
    const { doc } = this.ctx;
    this.element = doc.createElement("div");
    this.element.className = "message elicitation";
    this.element.setAttribute("role", "article");
    this.element.setAttribute("tabindex", "0");
    this.render();
  }

  /** Remove the block from the message list. */
  remove(): void {
    this.element.remove();
  }

  /** The elicitation id this block belongs to (URL mode), if any. */
  get elicitationId(): string | undefined {
    return this.opts.elicitationId;
  }

  private render(): void {
    const { doc } = this.ctx;
    const block = doc.createElement("div");
    block.className = "elicitation-block";

    const header = doc.createElement("div");
    header.className = "elicitation-block-header";
    header.innerHTML = `
      <div class="elicitation-header-left">
        <span class="elicitation-icon codicon codicon-comment-discussion"></span>
        <span>Agent Request</span>
      </div>
      <span class="elicitation-header-status">Waiting for input</span>
    `;

    const body = doc.createElement("div");
    body.className = "elicitation-block-body";

    if (this.opts.message) {
      const prompt = doc.createElement("div");
      prompt.className = "elicitation-message";
      prompt.textContent = this.opts.message;
      body.appendChild(prompt);
    }

    block.appendChild(header);
    block.appendChild(body);
    this.element.appendChild(block);

    if (this.opts.mode === "url" && this.opts.url) {
      this.renderUrl(body);
    } else {
      this.renderForm(body);
    }
  }

  private respond(
    action: "accept" | "decline" | "cancel",
    content?: Record<string, ElicitationContentValue>
  ): void {
    this.ctx.vscode.postMessage({
      type: "elicitationResponse",
      requestId: this.opts.requestId,
      elicitationAction: action,
      ...(content !== undefined ? { elicitationContent: content } : {}),
    });
    this.remove();
  }

  // -------------------------------------------------------------------
  // Form mode
  // -------------------------------------------------------------------

  private renderForm(body: HTMLElement): void {
    const { doc } = this.ctx;
    const schema = this.normalizeSchema(this.opts.schema);

    if (schema.title || schema.description) {
      const info = doc.createElement("div");
      info.className = "elicitation-schema-info";
      if (schema.title) {
        const title = doc.createElement("div");
        title.className = "elicitation-schema-title";
        title.textContent = schema.title;
        info.appendChild(title);
      }
      if (schema.description) {
        const desc = doc.createElement("div");
        desc.className = "elicitation-schema-desc";
        desc.textContent = schema.description;
        info.appendChild(desc);
      }
      body.appendChild(info);
    }

    const form = doc.createElement("form");
    form.className = "elicitation-form";
    const required = new Set(schema.required ?? []);
    this.fields = [];

    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      const field = doc.createElement("div");
      field.className = "elicitation-field";

      const label = doc.createElement("label");
      label.className = "elicitation-field-label";
      label.id = `elic-label-${this.opts.requestId}-${key}`;
      label.htmlFor = `elic-${this.opts.requestId}-${key}`;
      label.textContent = prop.title || key;
      if (required.has(key)) {
        const star = doc.createElement("span");
        star.className = "elicitation-field-required";
        star.textContent = " *";
        label.appendChild(star);
      }
      field.appendChild(label);

      if (prop.description) {
        const desc = doc.createElement("div");
        desc.className = "elicitation-field-desc";
        desc.textContent = prop.description;
        field.appendChild(desc);
      }

      const control = this.renderControl(key, prop);
      field.appendChild(control);

      form.appendChild(field);
      this.fields.push({ key, prop, input: control });
    }

    const actions = doc.createElement("div");
    actions.className = "elicitation-actions";

    const cancelBtn = doc.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "elicitation-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.respond("decline"));

    const submitBtn = doc.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "elicitation-btn elicitation-btn-primary";
    submitBtn.textContent = "Submit";

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);
    body.appendChild(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const error = this.validate(required);
      this.clearErrors(form);
      if (error) {
        this.showError(form, error);
        return;
      }
      const content: Record<string, ElicitationContentValue> = {};
      for (const { key, prop, input } of this.fields) {
        const value = this.readValue(prop, input);
        if (value !== undefined) content[key] = value;
      }
      this.respond("accept", content);
    });

    const first = this.fields[0]?.input;
    if (first) {
      const focusable =
        first.tagName === "INPUT"
          ? first
          : (first.querySelector(
              'input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"]'
            ) as HTMLElement | null);
      if (focusable && typeof focusable.focus === "function") {
        focusable.focus();
      }
    }
  }

  private renderControl(
    key: string,
    prop: ElicitationPropertySchema
  ): HTMLElement {
    const { doc } = this.ctx;
    const id = `elic-${this.opts.requestId}-${key}`;
    const labelId = `elic-label-${this.opts.requestId}-${key}`;

    switch (prop.type) {
      case "boolean": {
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.className = "elicitation-checkbox";
        if (prop.default === true) input.checked = true;
        return input;
      }
      case "number":
      case "integer": {
        const input = doc.createElement("input");
        input.type = "number";
        input.id = id;
        input.className = "elicitation-input";
        if (prop.type === "integer") input.step = "1";
        if (typeof prop.minimum === "number") input.min = String(prop.minimum);
        if (typeof prop.maximum === "number") input.max = String(prop.maximum);
        if (typeof prop.default === "number")
          input.value = String(prop.default);
        return input;
      }
      case "array": {
        const options = this.arrayOptions(prop.items);
        if (options.length === 0) {
          const input = doc.createElement("input");
          input.type = "text";
          input.id = id;
          input.className = "elicitation-input";
          return input;
        }
        const group = doc.createElement("div");
        group.className = "elicitation-checkbox-group";
        group.id = id;
        group.setAttribute("aria-labelledby", labelId);
        const defaults = Array.isArray(prop.default)
          ? (prop.default as string[])
          : [];
        for (const option of options) {
          const wrap = doc.createElement("label");
          wrap.className = "elicitation-option-card";
          if (defaults.includes(option.const)) {
            wrap.classList.add("selected");
          }

          const box = doc.createElement("input");
          box.type = "checkbox";
          box.value = option.const;
          box.className = "elicitation-checkbox";
          if (defaults.includes(option.const)) box.checked = true;

          box.addEventListener("change", () => {
            if (box.checked) {
              wrap.classList.add("selected");
            } else {
              wrap.classList.remove("selected");
            }
          });

          const content = doc.createElement("div");
          content.className = "elicitation-option-content";

          const titleText = doc.createElement("div");
          titleText.className = "elicitation-option-title";
          titleText.textContent = option.title || option.const;
          content.appendChild(titleText);

          if (option.description) {
            const descText = doc.createElement("div");
            descText.className = "elicitation-option-desc";
            descText.textContent = option.description;
            content.appendChild(descText);
          }

          wrap.appendChild(box);
          wrap.appendChild(content);
          group.appendChild(wrap);
        }
        return group;
      }
      case "string":
      default: {
        const options = this.stringOptions(prop);
        if (options.length > 0) {
          const group = doc.createElement("div");
          group.className = "elicitation-radio-group";
          group.setAttribute("role", "radiogroup");
          group.setAttribute("aria-labelledby", labelId);
          group.id = id;
          const name = `elic-${this.opts.requestId}-${key}`;
          const defaultValue =
            typeof prop.default === "string" ? prop.default : "";

          for (const option of options) {
            const wrap = doc.createElement("label");
            wrap.className = "elicitation-option-card";
            if (defaultValue === option.const) {
              wrap.classList.add("selected");
            }

            const radio = doc.createElement("input");
            radio.type = "radio";
            radio.name = name;
            radio.value = option.const;
            radio.className = "elicitation-radio";
            if (defaultValue === option.const) radio.checked = true;

            radio.addEventListener("change", () => {
              group
                .querySelectorAll(".elicitation-option-card")
                .forEach((el) => el.classList.remove("selected"));
              if (radio.checked) {
                wrap.classList.add("selected");
              }
            });

            const content = doc.createElement("div");
            content.className = "elicitation-option-content";

            const titleText = doc.createElement("div");
            titleText.className = "elicitation-option-title";
            titleText.textContent = option.title || option.const;
            content.appendChild(titleText);

            if (option.description) {
              const descText = doc.createElement("div");
              descText.className = "elicitation-option-desc";
              descText.textContent = option.description;
              content.appendChild(descText);
            }

            wrap.appendChild(radio);
            wrap.appendChild(content);
            group.appendChild(wrap);
          }
          return group;
        }
        const input = doc.createElement("input");
        input.type = "text";
        input.id = id;
        input.className = "elicitation-input";
        if (typeof prop.default === "string") input.value = prop.default;
        return input;
      }
    }
  }

  private extractOptions(
    items:
      | Array<{ const: string; title?: string; description?: string | null }>
      | null
      | undefined,
    enumList: string[] | null | undefined
  ): Array<{ const: string; title?: string; description?: string | null }> {
    const titled = (items ?? [])
      .filter((o) => typeof o.const === "string")
      .map((o) => ({
        const: o.const,
        title: o.title,
        description: o.description ?? null,
      }));
    if (titled.length > 0) return titled;
    return (enumList ?? []).map((v) => ({
      const: v,
      title: v,
      description: null,
    }));
  }

  private stringOptions(
    prop: ElicitationPropertySchema
  ): Array<{ const: string; title?: string; description?: string | null }> {
    return this.extractOptions(prop.oneOf, prop.enum);
  }

  private arrayOptions(
    prop: ElicitationPropertySchema["items"]
  ): Array<{ const: string; title?: string; description?: string | null }> {
    if (!prop) return [];
    return this.extractOptions(prop.anyOf, prop.enum);
  }

  // -------------------------------------------------------------------
  // URL mode
  // -------------------------------------------------------------------

  private renderUrl(body: HTMLElement): void {
    const { doc } = this.ctx;
    const url = this.opts.url ?? "";

    // Only http/https URLs are safe to open; anything else is shown as plain
    // text to avoid javascript: and other dangerous schemes from the agent.
    const trimmed = url.trim();
    const safeUrl = /^https?:\/\//i.test(trimmed) ? trimmed : null;

    const urlBox = doc.createElement("div");
    urlBox.className = "elicitation-url-box";

    const link = doc.createElement("a");
    link.className = "elicitation-url-link";
    link.textContent = url;
    if (safeUrl) {
      link.href = safeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    const openBtn = doc.createElement("button");
    openBtn.type = "button";
    openBtn.className = "elicitation-btn";
    openBtn.textContent = "Open Link";
    openBtn.disabled = !safeUrl;
    openBtn.addEventListener("click", () => {
      if (safeUrl) {
        this.ctx.win.open(safeUrl, "_blank", "noopener,noreferrer");
      }
    });

    urlBox.appendChild(link);
    urlBox.appendChild(openBtn);
    body.appendChild(urlBox);

    const hint = doc.createElement("div");
    hint.className = "elicitation-url-hint";
    hint.textContent =
      "Complete the flow in the opened page, then press Done below.";
    body.appendChild(hint);

    const actions = doc.createElement("div");
    actions.className = "elicitation-actions";

    const cancelBtn = doc.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "elicitation-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.respond("cancel"));

    const doneBtn = doc.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "elicitation-btn elicitation-btn-primary";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => this.respond("accept"));

    actions.appendChild(cancelBtn);
    actions.appendChild(doneBtn);
    body.appendChild(actions);
  }

  // -------------------------------------------------------------------
  // Schema normalization, value collection and validation
  // -------------------------------------------------------------------

  private normalizeSchema(raw: unknown): ElicitationFormSchema {
    if (!raw || typeof raw !== "object") return {};
    const obj = raw as Record<string, unknown>;
    const properties: Record<string, ElicitationPropertySchema> = {};
    if (obj.properties && typeof obj.properties === "object") {
      for (const [key, value] of Object.entries(
        obj.properties as Record<string, unknown>
      )) {
        if (value && typeof value === "object") {
          properties[key] = value as ElicitationPropertySchema;
        }
      }
    }
    const required = Array.isArray(obj.required)
      ? (obj.required as string[]).filter((r) => typeof r === "string")
      : null;
    return {
      title: typeof obj.title === "string" ? obj.title : null,
      description: typeof obj.description === "string" ? obj.description : null,
      properties,
      required,
    };
  }

  /**
   * Read a field's value. Empty optional fields yield `undefined` and are
   * omitted from the submitted content instead of reporting a default (e.g.
   * `0` for a blank number input).
   */
  private readValue(
    prop: ElicitationPropertySchema,
    input: HTMLElement
  ): ElicitationContentValue | undefined {
    switch (prop.type) {
      case "boolean":
        return (input as HTMLInputElement).checked;
      case "number": {
        const value = (input as HTMLInputElement).value;
        return value === "" ? undefined : Number(value);
      }
      case "integer": {
        const value = (input as HTMLInputElement).value;
        return value === "" ? undefined : Number.parseInt(value, 10);
      }
      case "array": {
        const selected = Array.from(
          input.querySelectorAll('input[type="checkbox"]:checked')
        ).map((box) => (box as HTMLInputElement).value);
        return selected.length > 0 ? selected : undefined;
      }
      case "string":
      default: {
        const options = this.stringOptions(prop);
        if (options.length > 0) {
          const checkedRadio = input.querySelector(
            'input[type="radio"]:checked'
          ) as HTMLInputElement | null;
          return checkedRadio ? checkedRadio.value : undefined;
        }
        const value = (input as HTMLInputElement).value;
        return value === "" ? undefined : value;
      }
    }
  }

  private validate(required: Set<string>): string | null {
    for (const { key, prop, input } of this.fields) {
      if (prop.type === "array") {
        const checked = Array.from(
          input.querySelectorAll('input[type="checkbox"]:checked')
        ).length;
        if (required.has(key) && checked === 0) {
          return `"${prop.title || key}" is required.`;
        }
        if (typeof prop.minItems === "number" && checked < prop.minItems) {
          return `"${prop.title || key}" requires at least ${prop.minItems} item(s).`;
        }
        if (typeof prop.maxItems === "number" && checked > prop.maxItems) {
          return `"${prop.title || key}" allows at most ${prop.maxItems} item(s).`;
        }
        continue;
      }
      if (prop.type === "boolean") {
        if (required.has(key) && !(input as HTMLInputElement).checked) {
          return `"${prop.title || key}" must be checked.`;
        }
        continue;
      }
      const options =
        prop.type === "string" || !prop.type ? this.stringOptions(prop) : [];
      let raw: string = "";
      if (options.length > 0) {
        const checkedRadio = input.querySelector(
          'input[type="radio"]:checked'
        ) as HTMLInputElement | null;
        raw = checkedRadio ? checkedRadio.value : "";
      } else {
        raw = (input as HTMLInputElement).value ?? "";
      }
      if (required.has(key) && raw === "") {
        return `"${prop.title || key}" is required.`;
      }
      if (raw === "") continue;
      if (prop.type === "number" || prop.type === "integer") {
        const num = Number(raw);
        if (Number.isNaN(num)) {
          return `"${prop.title || key}" must be a number.`;
        }
        if (typeof prop.minimum === "number" && num < prop.minimum) {
          return `"${prop.title || key}" must be at least ${prop.minimum}.`;
        }
        if (typeof prop.maximum === "number" && num > prop.maximum) {
          return `"${prop.title || key}" must be at most ${prop.maximum}.`;
        }
      } else if (
        typeof prop.minLength === "number" &&
        raw.length < prop.minLength
      ) {
        return `"${prop.title || key}" must be at least ${prop.minLength} characters.`;
      } else if (
        typeof prop.maxLength === "number" &&
        raw.length > prop.maxLength
      ) {
        return `"${prop.title || key}" must be at most ${prop.maxLength} characters.`;
      } else if (prop.pattern) {
        try {
          if (!new RegExp(prop.pattern).test(raw)) {
            return `"${prop.title || key}" does not match the required pattern.`;
          }
        } catch {
          // Invalid pattern from the agent: skip validation rather than block.
        }
      }
    }
    return null;
  }

  private showError(form: HTMLFormElement, message: string): void {
    const { doc } = this.ctx;
    const error = doc.createElement("div");
    error.className = "elicitation-error";
    error.textContent = message;
    form.insertBefore(error, form.firstChild);
  }

  private clearErrors(form: HTMLFormElement): void {
    form.querySelectorAll(".elicitation-error").forEach((el) => el.remove());
  }
}
