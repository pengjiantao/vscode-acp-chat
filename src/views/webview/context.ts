import type { VsCodeApi, WebviewEventMap } from "./types";
import type { EventBus } from "./event-bus";
import type { MessageRouter } from "./message-router";
import type { StatePersistenceService } from "./state-persistence";
import type { SessionStore } from "./session-store";

/**
 * Shared context available to every webview component.
 *
 * Provides access to core services (VS Code API, state, routing, events, session store).
 * Utility functions should be imported directly from their modules.
 */
export interface WebviewContext {
  readonly vscode: VsCodeApi;
  readonly doc: Document;
  readonly win: Window;
  readonly stateService: StatePersistenceService;
  readonly messageRouter: MessageRouter;
  readonly eventBus: EventBus<WebviewEventMap>;
  readonly sessionStore: SessionStore;
}
