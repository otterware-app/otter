import { expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: {} }));
vi.mock("../backend-host.js", () => ({ invokeBackend: vi.fn() }));
vi.mock("../ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./browser.js", () => ({ getBrowserSession: vi.fn() }));
vi.mock("./extensions.js", () => ({ activeTab: () => -1 }));

const { flattened, unflattened } = await import("./tab-sharing.js");

it("brings a deep value back as a string, which Electron's debugger can return", async () => {
  const params = {
    functionDeclaration: "(a) => a",
    returnByValue: true,
    awaitPromise: true,
    arguments: [{ value: 1 }],
  };
  const flat = flattened("Runtime.callFunctionOn", params)!;
  expect(flat.arguments).toEqual(params.arguments);
  const call = new Function(`return ${String(flat.functionDeclaration)}`)() as (
    ...args: unknown[]
  ) => Promise<string | undefined>;
  const deep = { a: { b: { c: [1, null, "x"] } } };
  const sent = await call(deep);
  expect(unflattened({ result: { type: "string", value: sent } })).toEqual({
    result: { type: "object", value: deep },
  });
  expect(unflattened({ result: { type: "string", value: await call("text") } })).toEqual({
    result: { type: "string", value: "text" },
  });
  expect(unflattened({ result: { type: "undefined" } })).toEqual({ result: { type: "undefined" } });

  expect(flattened("Runtime.callFunctionOn", { ...params, returnByValue: false })).toBeNull();
  expect(flattened("Runtime.evaluate", params)).toBeNull();
});
