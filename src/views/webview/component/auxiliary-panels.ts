import { DiffSummary } from "../widget/diff-summary";
import { PlanView } from "../widget/plan-view";
import type {
  AuxiliaryPanelElements,
  ExtensionMessage,
  PlanEntry,
} from "../types";
import type { WebviewContext } from "../context";
import type { MessageHandler } from "../message-router";
import { getRequiredElement } from "../widget/dom";

/**
 * Groups side-channel panels (plan, diff summary) that sit outside the
 * message stream but are still part of the chat session state.
 *
 * Implements {@link MessageHandler} to self-register for plan and
 * diffSummary messages.
 */
export class AuxiliaryPanelsComponent implements MessageHandler {
  readonly elements: AuxiliaryPanelElements;
  private planView?: PlanView;
  private diffSummary?: DiffSummary;

  constructor(
    private ctx: WebviewContext,
    options?: {
      elements?: AuxiliaryPanelElements;
    }
  ) {
    this.elements = options?.elements ?? {
      planContainer: getRequiredElement(ctx.doc, "agent-plan-container"),
      diffSummaryContainer: getRequiredElement(
        ctx.doc,
        "diff-summary-container"
      ),
    };

    this.planView = new PlanView({
      container: this.elements.planContainer,
    });

    this.diffSummary = new DiffSummary({
      container: this.elements.diffSummaryContainer,
      vscode: ctx.vscode,
      stateService: ctx.stateService,
    });

    // Register for plan and diff messages.
    ctx.messageRouter.registerMany(
      ["plan", "planComplete", "diffSummary"],
      this
    );
  }

  // -------------------------------------------------------------------
  // MessageHandler
  // -------------------------------------------------------------------

  handleMessage(msg: ExtensionMessage): boolean | void {
    switch (msg.type) {
      case "plan":
        if (msg.plan && msg.plan.entries) {
          this.showPlan(msg.plan.entries);
        }
        return;
      case "planComplete":
        this.hidePlan();
        return;
      case "diffSummary":
        if (msg.changes) {
          this.diffSummary?.setChanges(msg.changes);
        }
        return;
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  showPlan(entries: PlanEntry[]): void {
    this.planView?.show(entries);
  }

  hidePlan(): void {
    this.planView?.hide();
  }

  clearDiff(): void {
    this.diffSummary?.clear();
  }

  setDiffChanges(changes: NonNullable<ExtensionMessage["changes"]>): void {
    this.diffSummary?.setChanges(changes);
  }
}
