// ---------------------------------------------------------------------------
// The Lit bridge for a store: a ReactiveController (the idiomatic Lit answer to
// shared state — not a base-class mixin). Any patch to the store re-renders the
// host; unsubscribes when the host leaves the DOM. Components read state
// through `.value` (or straight off the store) — the controller only wires the
// change notification.
// ---------------------------------------------------------------------------

import { followActive } from './workspace.js';

/** @template {object} S */
export class StoreController {
  /**
   * @param {import('lit').ReactiveControllerHost} host
   * @param {ReturnType<typeof import('./store.js').createStore<S>>} store
   */
  constructor(host, store) {
    (this.host = host).addController(this);
    this.store = store;
  }
  hostConnected() {
    this.unsub = this.store.subscribe(() => this.host.requestUpdate());
  }
  hostDisconnected() {
    this.unsub?.();
  }
  get value() {
    return this.store.get();
  }
}

/**
 * The follow-the-active-document bridge: re-renders the host on any
 * workspace change (activation, titles, dirty flips) AND on the active
 * context's structural doc changes — re-wired across activation switches by
 * followActive. For hosts that render FROM the active document (the atlas
 * status readout, the options strip's tile bounds) without owning a context
 * of their own.
 */
export class ActiveDocController {
  /**
   * @param {import('lit').ReactiveControllerHost} host
   * @param {ReturnType<typeof import('./workspace.js').createWorkspace>} workspace
   */
  constructor(host, workspace) {
    (this.host = host).addController(this);
    this.workspace = workspace;
  }
  hostConnected() {
    const update = () => this.host.requestUpdate();
    const unsubWs = this.workspace.subscribe(update);
    const stop = followActive(this.workspace, (ctx) =>
      ctx ? ctx.doc.subscribe(update) : undefined
    );
    this.unsub = () => {
      unsubWs();
      stop();
    };
  }
  hostDisconnected() {
    this.unsub?.();
  }
}
