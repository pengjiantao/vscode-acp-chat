import { updateContextUsageRing } from "../widget/context-usage";
import { Dropdown } from "../widget/dropdown";
import type {
  DropdownOption,
  ExtensionMessage,
  SessionToolbarElements,
} from "../types";
import type { WebviewContext } from "../context";
import type { MessageHandler } from "../message-router";
import { getRequiredElement } from "../widget/dom";

function cssEscapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

const CATEGORY_ICONS: Record<string, string> = {
  thought_level: "codicon-lightbulb",
};

/**
 * Construct top-level property description title text for tooltips.
 * Format: "Name\nDescription" if description is present, otherwise "Name".
 */
function buildCustomTitle(
  name: string | null | undefined,
  description: string | null | undefined,
  fallbackName: string
): string {
  const displayName = name || fallbackName;
  const trimmedDesc = description ? description.trim() : "";
  return trimmedDesc ? `${displayName}\n${trimmedDesc}` : displayName;
}

/**
 * Owns the session option strip: mode/model pickers, generic ACP config
 * options, and context usage.
 *
 * Implements {@link MessageHandler} to self-register for session metadata
 * and config update messages.
 */
export class SessionToolbarComponent implements MessageHandler {
  readonly elements: SessionToolbarElements;
  private modeDropdown?: Dropdown;
  private modelDropdown?: Dropdown;
  private configOptionDropdowns = new Map<string, Dropdown>();
  private starredModels = new Set<string>();

  constructor(
    private ctx: WebviewContext,
    options?: {
      elements?: SessionToolbarElements;
    }
  ) {
    this.elements = options?.elements ?? {
      modeDropdown: getRequiredElement(ctx.doc, "mode-dropdown"),
      modelDropdown: getRequiredElement(ctx.doc, "model-dropdown"),
      configOptionsContainer: getRequiredElement(
        ctx.doc,
        "config-options-container"
      ),
      contextUsageRing: getRequiredElement<HTMLDivElement>(
        ctx.doc,
        "context-usage-ring"
      ),
    };

    this.initDropdowns();

    // Register for session-related messages.
    // Note: availableCommands is NOT registered here — the controller
    // forwards it directly to messageList and inputPanel.
    ctx.messageRouter.registerMany(
      ["sessionMetadata", "modeUpdate", "modelUpdate", "contextUsage"],
      this
    );
  }

  // -------------------------------------------------------------------
  // MessageHandler
  // -------------------------------------------------------------------

  handleMessage(msg: ExtensionMessage): boolean | void {
    switch (msg.type) {
      case "sessionMetadata":
        return this.updateMetadata(msg);
      case "modeUpdate":
        if (msg.modeId) this.modeDropdown?.setValue(msg.modeId);
        return;
      case "modelUpdate":
        if (msg.modelId) this.modelDropdown?.setValue(msg.modelId);
        return;
      case "contextUsage":
        return this.updateContextUsage(msg);
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  updateMetadata(msg: ExtensionMessage): void {
    const hasModes =
      msg.modes &&
      msg.modes.availableModes &&
      msg.modes.availableModes.length > 0;
    const hasModels =
      msg.models &&
      msg.models.availableModels &&
      msg.models.availableModels.length > 0;

    if (Array.isArray(msg.starredModels)) {
      this.starredModels = new Set(msg.starredModels);
    }

    if (hasModes && msg.modes) {
      this.elements.modeDropdown.style.display = "flex";
      this.modeDropdown?.setCustomTitle(
        buildCustomTitle(msg.modes.name, msg.modes.description, "Mode")
      );
      this.modeDropdown?.setOptions(
        msg.modes.availableModes.map((mode) => ({
          id: mode.id,
          name: mode.name || mode.id,
          description: mode.description ?? null,
        })),
        msg.modes.currentModeId
      );
    } else {
      this.elements.modeDropdown.style.display = "none";
    }

    if (hasModels && msg.models) {
      this.elements.modelDropdown.style.display = "flex";
      this.modelDropdown?.setCustomTitle(
        buildCustomTitle(msg.models.name, msg.models.description, "Model")
      );
      this.updateModelDropdown(msg.models);
    } else {
      this.elements.modelDropdown.style.display = "none";
    }

    this.renderGenericConfigOptions(msg.genericConfigOptions ?? []);
  }

  setModeValue(modeId: string): void {
    this.modeDropdown?.setValue(modeId);
  }

  setModelValue(modelId: string): void {
    this.modelDropdown?.setValue(modelId);
  }

  updateContextUsage(msg: ExtensionMessage): void {
    updateContextUsageRing(this.elements.contextUsageRing, {
      used: msg.used,
      size: msg.size,
      cost: msg.cost,
    });
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private initDropdowns(): void {
    this.modeDropdown = new Dropdown(this.elements.modeDropdown, (id) => {
      this.ctx.vscode.postMessage({ type: "selectMode", modeId: id });
    });

    this.modelDropdown = new Dropdown(
      this.elements.modelDropdown,
      (id) => {
        this.ctx.vscode.postMessage({ type: "selectModel", modelId: id });
      },
      (id, isStarred) => {
        this.ctx.vscode.postMessage({
          type: "toggleModelStar",
          modelId: id,
          isStarred,
        });
      }
    );
  }

  private updateModelDropdown(
    modelsMsg: NonNullable<ExtensionMessage["models"]>
  ): void {
    const options: DropdownOption[] = [];
    const availableModels = modelsMsg.availableModels || [];

    const starred = availableModels.filter((model) =>
      this.starredModels.has(model.modelId)
    );

    if (starred.length > 0) {
      options.push({ id: "header-starred", name: "Starred", type: "header" });
      starred.forEach((model) => {
        options.push({
          id: model.modelId,
          name: model.name || model.modelId,
          description: model.description ?? null,
          isStarred: true,
          canStar: true,
        });
      });
      options.push({ id: "divider-1", name: "", type: "divider" });
      options.push({ id: "header-all", name: "All Models", type: "header" });
    }

    availableModels.forEach((model) => {
      options.push({
        id: model.modelId,
        name: model.name || model.modelId,
        description: model.description ?? null,
        isStarred: this.starredModels.has(model.modelId),
        canStar: true,
      });
    });

    this.modelDropdown?.setOptions(options, modelsMsg.currentModelId);
  }

  private renderGenericConfigOptions(
    options: NonNullable<ExtensionMessage["genericConfigOptions"]>
  ): void {
    const container = this.elements.configOptionsContainer;
    const incomingIds = new Set(options.map((option) => option.id));

    for (const id of this.configOptionDropdowns.keys()) {
      if (!incomingIds.has(id)) {
        const element = container.querySelector<HTMLElement>(
          `[data-config-id="${cssEscapeAttr(id)}"]`
        );
        if (element) element.remove();
        this.configOptionDropdowns.delete(id);
      }
    }

    for (const option of options) {
      const safeId = option.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      let wrapper = container.querySelector<HTMLElement>(
        `[data-config-id="${cssEscapeAttr(option.id)}"]`
      );

      if (!wrapper) {
        wrapper = this.createGenericConfigOptionElement(option, safeId);
        container.appendChild(wrapper);
      }

      const dropdown = this.ensureConfigOptionDropdown(option.id, wrapper);
      dropdown.setCustomTitle(
        buildCustomTitle(option.name, option.description, option.id)
      );
      dropdown.setOptions(
        option.options.map((item) => ({
          id: item.value,
          name: item.name || item.value,
          description: item.description ?? null,
        })),
        option.currentValue
      );
    }
  }

  private createGenericConfigOptionElement(
    option: NonNullable<ExtensionMessage["genericConfigOptions"]>[number],
    safeId: string
  ): HTMLElement {
    const { doc } = this.ctx;
    const wrapper = doc.createElement("div");
    wrapper.className = "custom-dropdown";
    wrapper.setAttribute("data-config-id", option.id);
    wrapper.id = `config-option-${safeId}`;
    wrapper.style.display = "flex";

    const trigger = doc.createElement("div");
    trigger.className = "dropdown-trigger";

    const iconClass = option.category
      ? CATEGORY_ICONS[option.category]
      : undefined;
    if (iconClass) {
      const icon = doc.createElement("span");
      icon.className = `dropdown-icon codicon ${iconClass}`;
      icon.setAttribute("aria-hidden", "true");
      trigger.appendChild(icon);
    }

    const label = doc.createElement("span");
    label.className = "selected-label";
    label.textContent = option.name || option.id;
    trigger.appendChild(label);

    const chevron = doc.createElement("span");
    chevron.className = "dropdown-chevron";
    const chevronIcon = doc.createElement("span");
    chevronIcon.className = "codicon codicon-chevron-down";
    chevron.appendChild(chevronIcon);
    trigger.appendChild(chevron);

    const popover = doc.createElement("div");
    popover.className = "dropdown-popover";

    wrapper.appendChild(trigger);
    wrapper.appendChild(popover);
    return wrapper;
  }

  private ensureConfigOptionDropdown(
    configId: string,
    wrapper: HTMLElement
  ): Dropdown {
    const existing = this.configOptionDropdowns.get(configId);
    if (existing) return existing;

    const dropdown = new Dropdown(wrapper, (value) => {
      this.ctx.vscode.postMessage({
        type: "selectConfigOption",
        configId,
        value,
      });
    });
    this.configOptionDropdowns.set(configId, dropdown);
    return dropdown;
  }
}
