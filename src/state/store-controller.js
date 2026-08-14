// ---------------------------------------------------------------------------
// The Lit bridge for a store: a ReactiveController (the idiomatic Lit answer to
// shared state — not a base-class mixin). Any patch to the store re-renders the
// host; unsubscribes when the host leaves the DOM. Components read state
// through `.value` (or straight off the store) — the controller only wires the
// change notification.
// ---------------------------------------------------------------------------

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
