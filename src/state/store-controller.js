// Lit reactive controllers that re-render their host on store changes.

import { followActive } from './workspace.js';

/** @template {object} S */
export class StoreController {
  /**
   * @param {import('lit').ReactiveControllerHost} host
   * @param {{get(): S, subscribe(fn: (s: S) => void): () => void}} store
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
 * Re-renders the host on any workspace change and on the active context's
 * structural doc changes, across activation switches (followActive).
 * `selection: true` also follows the active context's selection store. That
 * store changes at pointer-move rate during a drag, so only hosts that show
 * the selection should set it.
 */
export class ActiveDocController {
  /**
   * @param {import('lit').ReactiveControllerHost} host
   * @param {ReturnType<typeof import('./workspace.js').createWorkspace>} workspace
   * @param {{selection?: boolean}} [opts]
   */
  constructor(host, workspace, { selection = false } = {}) {
    (this.host = host).addController(this);
    this.workspace = workspace;
    this.selection = selection;
  }
  hostConnected() {
    const update = () => this.host.requestUpdate();
    const unsubWs = this.workspace.subscribe(update);
    const stop = followActive(this.workspace, (ctx) => {
      if (!ctx) return undefined;
      const unsubDoc = ctx.doc.subscribe(update);
      const unsubSel = this.selection ? ctx.selection.subscribe(update) : null;
      return () => {
        unsubDoc();
        unsubSel?.();
      };
    });
    this.unsub = () => {
      unsubWs();
      stop();
    };
  }
  hostDisconnected() {
    this.unsub?.();
  }
}
