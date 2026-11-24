import { it, expect, vi } from "vite-plus/test";
import { todoistSignIn } from "./todoist-oauth.ts";
const opened = vi.hoisted(() => vi.fn());
vi.mock("../main-link.ts", () => ({ requestMain: opened }));
it("accepts only the current loopback callback and closes the listener afterward", async () => {
  let redirect = "";
  opened.mockImplementationOnce(async (_kind: string, { url }: { url: string }) => {
    const consent = new URL(url);
    expect(consent.origin).toBe("https://app.todoist.com");
    expect((await fetch(`${redirect}?state=wrong&code=bad`)).status).toBe(400);
    expect((await fetch(`${redirect}?state=expected&code=good`)).status).toBe(200);
  });
  const result = await todoistSignIn(async (uri) => {
    redirect = uri;
    return "https://app.todoist.com/oauth/authorize?state=expected";
  });
  expect(result).toBe(`${redirect}?state=expected&code=good`);
  await expect(fetch(redirect)).rejects.toThrow();
});
