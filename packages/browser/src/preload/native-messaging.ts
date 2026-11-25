type NativeBridge = {
  call(method: string, args: unknown[]): Promise<unknown>;
  listen(id: string, listener: (kind: string, payload: unknown) => void): void;
  forget(id: string): void;
};

export function installNativeMessaging(bridge: NativeBridge): void {
  type Runtime = Record<string, unknown>;
  const { chrome, browser } = globalThis as {
    chrome?: { runtime?: Runtime };
    browser?: { runtime?: Runtime };
  };
  const runtimes = [...new Set([chrome?.runtime, browser?.runtime])].filter(
    (runtime): runtime is Runtime => !!runtime,
  );
  let lastError: { message: string } | undefined;
  for (const runtime of runtimes) {
    const original = Object.getOwnPropertyDescriptor(runtime, "lastError");
    Object.defineProperty(runtime, "lastError", {
      configurable: true,
      enumerable: true,
      get: () => lastError ?? original?.get?.call(runtime) ?? original?.value,
    });
  }
  const withError = (message: string | undefined, callback: () => void) => {
    const previous = lastError;
    lastError = message ? { message } : undefined;
    try {
      callback();
    } finally {
      lastError = previous;
    }
  };
  const event = <Args extends unknown[]>() => {
    const listeners = new Set<(...args: Args) => void>();
    return {
      addListener: (listener: (...args: Args) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (...args: Args) => void) => {
        listeners.delete(listener);
      },
      hasListener: (listener: (...args: Args) => void) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
      emit(...args: Args) {
        for (const listener of listeners) {
          try {
            listener(...args);
          } catch (error) {
            console.error(error);
          }
        }
      },
    };
  };
  type Port = {
    name: string;
    error: { message: string } | undefined;
    onMessage: ReturnType<typeof event<[unknown, Port]>>;
    onDisconnect: ReturnType<typeof event<[Port]>>;
    postMessage(message: unknown): void;
    disconnect(): void;
  };
  const connectNative = (name: string): Port => {
    if (typeof name !== "string") throw new TypeError("A native messaging host name is required.");
    const id = crypto.randomUUID();
    let disconnected = false;
    const onMessage = event<[unknown, Port]>();
    const onDisconnect = event<[Port]>();
    function makePort(): Port {
      return {
        name,
        error: undefined as { message: string } | undefined,
        onMessage,
        onDisconnect,
        postMessage(message: unknown) {
          if (disconnected) throw new Error("Attempting to use a disconnected port object.");
          const json = JSON.stringify(message);
          if (json === undefined) throw new TypeError("Native messages must be JSON serializable.");
          const value: unknown = JSON.parse(json);
          void ready
            .then(() => {
              if (!disconnected) return bridge.call("postMessage", [id, value]);
              return undefined;
            })
            .catch((error: unknown) => {
              finish(String(error instanceof Error ? error.message : error));
              void bridge.call("disconnect", [id]).catch(() => {});
            });
        },
        disconnect() {
          if (disconnected) return;
          disconnected = true;
          bridge.forget(id);
          void ready.then(() => bridge.call("disconnect", [id])).catch(() => {});
        },
      };
    }
    const port = makePort();
    const finish = (error?: string) => {
      if (disconnected) return;
      disconnected = true;
      bridge.forget(id);
      port.error = error ? { message: error } : undefined;
      withError(error, () => onDisconnect.emit(port));
    };
    bridge.listen(id, (kind, payload) => {
      if (disconnected) return;
      if (kind === "message") onMessage.emit(payload, port);
      else if (kind === "disconnect") finish(typeof payload === "string" ? payload : undefined);
    });
    const ready = bridge.call("connect", [id, name]).catch((error: unknown) => {
      finish(String(error instanceof Error ? error.message : error));
    });
    return port;
  };
  const sendNativeMessage = (
    name: string,
    message: unknown,
    callback?: (response?: unknown) => void,
  ) => {
    const result = new Promise<unknown>((resolve, reject) => {
      const port = connectNative(name);
      port.onMessage.addListener((response) => {
        port.disconnect();
        resolve(response);
      });
      port.onDisconnect.addListener(() =>
        reject(new Error(port.error?.message ?? "Native host has exited.")),
      );
      try {
        port.postMessage(message);
      } catch (error) {
        port.disconnect();
        reject(error);
      }
    });
    if (!callback) return result;
    void result.then(
      (response) => callback(response),
      (error: unknown) =>
        withError(String(error instanceof Error ? error.message : error), () => callback()),
    );
    return undefined;
  };
  for (const runtime of runtimes) {
    Object.defineProperties(runtime, {
      connectNative: { value: connectNative, configurable: true, writable: true, enumerable: true },
      sendNativeMessage: {
        value: sendNativeMessage,
        configurable: true,
        writable: true,
        enumerable: true,
      },
    });
  }
}
