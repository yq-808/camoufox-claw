type InMemoryQueuedMessage = {
  message: unknown;
  extra?: { authInfo?: unknown };
};

export class InMemoryTransport {
  onmessage?: (message: unknown, extra?: { authInfo?: unknown }) => void;
  onclose?: () => void;
  private other?: InMemoryTransport;
  private queue: InMemoryQueuedMessage[] = [];

  static createLinkedPair(): [InMemoryTransport, InMemoryTransport] {
    const clientTransport = new InMemoryTransport();
    const serverTransport = new InMemoryTransport();
    clientTransport.other = serverTransport;
    serverTransport.other = clientTransport;
    return [clientTransport, serverTransport];
  }

  async start(): Promise<void> {
    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      if (queued) {
        this.onmessage?.(queued.message, queued.extra);
      }
    }
  }

  async close(): Promise<void> {
    const other = this.other;
    this.other = undefined;
    if (other) {
      await other.close();
    }
    this.onclose?.();
  }

  async send(message: unknown, options?: { authInfo?: unknown }): Promise<void> {
    if (!this.other) {
      throw new Error("Not connected");
    }
    const payload = { authInfo: options?.authInfo };
    if (this.other.onmessage) {
      this.other.onmessage(message, payload);
      return;
    }
    this.other.queue.push({ message, extra: payload });
  }
}
