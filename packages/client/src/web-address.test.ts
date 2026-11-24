import { describe, expect, it } from "vite-plus/test";
import { addressToUrl, hostOf } from "./web-address.ts";

describe("an address bar", () => {
  it("opens an address, this machine over http, and searches for the rest", () => {
    expect(addressToUrl(" otterware.app/mail ")).toBe("https://otterware.app/mail");
    expect(addressToUrl("http://example.com/a?b=1#c")).toBe("http://example.com/a?b=1#c");
    expect(addressToUrl("localhost:5833")).toBe("http://localhost:5833");
    expect(addressToUrl("127.0.0.1/x")).toBe("http://127.0.0.1/x");
    expect(addressToUrl("")).toBeNull();
    expect(addressToUrl("two words")).toBe("https://www.google.com/search?q=two%20words");
    expect(addressToUrl("HTTPS://Example.com")).toBe("HTTPS://Example.com");
    expect(addressToUrl("javascript://alert(1)")).toMatch(
      /^https:\/\/www\.google\.com\/search\?q=/,
    );
    expect(addressToUrl("ftp://example.com")).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
  });

  it("names a page by its site", () => {
    expect(hostOf("https://www.booking.com/hotels")).toBe("booking.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
