export class ByteLruCache {
  readonly #entries = new Map<string, Uint8Array>();
  #bytes = 0;

  constructor(readonly maxBytes: number) {}

  get bytes() {
    return this.#bytes;
  }

  get(key: string) {
    const value = this.#entries.get(key);
    if (!value) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: Uint8Array) {
    const previous = this.#entries.get(key);
    if (previous) {
      this.#bytes -= previous.byteLength;
      this.#entries.delete(key);
    }
    if (value.byteLength > this.maxBytes) return;
    this.#entries.set(key, value);
    this.#bytes += value.byteLength;
    while (this.#bytes > this.maxBytes) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.#entries.get(oldest)!;
      this.#entries.delete(oldest);
      this.#bytes -= removed.byteLength;
    }
  }
}

export class RenderCache {
  readonly cache: ByteLruCache;
  readonly #inflight = new Map<string, Promise<Uint8Array>>();
  readonly #waiting: (() => void)[] = [];
  #active = 0;

  constructor(
    maxBytes: number,
    readonly maxConcurrent = 2
  ) {
    this.cache = new ByteLruCache(maxBytes);
  }

  async #slot() {
    if (this.#active < this.maxConcurrent) {
      this.#active += 1;
      return;
    }
    await new Promise<void>(resolve => this.#waiting.push(resolve));
    this.#active += 1;
  }

  #release() {
    this.#active -= 1;
    this.#waiting.shift()?.();
  }

  getOrRender(key: string, render: () => Promise<Uint8Array>) {
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.#inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      await this.#slot();
      try {
        const value = await render();
        this.cache.set(key, value);
        return value;
      } finally {
        this.#release();
      }
    })();
    this.#inflight.set(key, promise);
    void promise.then(
      () => this.#inflight.delete(key),
      () => this.#inflight.delete(key)
    );
    return promise;
  }
}
