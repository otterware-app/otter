import { describe, expect, it } from "vite-plus/test";
import { MAILBOX_PICTURE_MAX_LENGTH, isMailboxPicture } from "@otter/contracts/relay";

import {
  PictureError,
  centerSquare,
  encodePicture,
  pictureFileProblem,
  type DrawPicture,
} from "./mailbox-picture-image";

// Like a browser's canvas, a type it can't write comes out PNG.
function fakeCanvas({
  formats = ["image/webp", "image/jpeg", "image/png"],
  opaque = true,
  bytes = () => 4000,
}: {
  formats?: string[];
  opaque?: boolean;
  bytes?: (side: number) => number;
} = {}) {
  const drawn: number[] = [];
  const draw: DrawPicture = (side) => {
    drawn.push(side);
    return {
      opaque,
      encode: (type) =>
        `data:${formats.includes(type) ? type : "image/png"};base64,${"A".repeat(bytes(side))}`,
    };
  };
  return { draw, drawn };
}

describe("pictureFileProblem", () => {
  it("takes images, and refuses other files and very large ones", () => {
    expect(pictureFileProblem({ type: "image/jpeg", size: 3_000_000 })).toBeNull();
    expect(pictureFileProblem({ type: "image/heic", size: 1_000 })).toBeNull();
    expect(pictureFileProblem({ type: "text/plain", size: 10 })).toMatch(/isn't an image/);
    expect(pictureFileProblem({ type: "", size: 10 })).toBeNull();
    expect(pictureFileProblem({ type: "image/png", size: 25 * 1024 * 1024 })).toMatch(/20 MB/);
  });
});

describe("centerSquare", () => {
  it("is the middle of a wide or tall image, and all of a square one", () => {
    expect(centerSquare(4000, 2500)).toEqual({ x: 750, y: 0, side: 2500 });
    expect(centerSquare(300, 900)).toEqual({ x: 0, y: 300, side: 300 });
    expect(centerSquare(512, 512)).toEqual({ x: 0, y: 0, side: 512 });
  });
});

describe("encodePicture", () => {
  it("is WebP at 128px where the browser writes WebP, transparent or not", () => {
    for (const opaque of [true, false]) {
      const { draw, drawn } = fakeCanvas({ opaque });
      const picture = encodePicture(draw);
      expect(picture).toMatch(/^data:image\/webp;base64,/);
      expect(isMailboxPicture(picture)).toBe(true);
      expect(drawn).toEqual([128]);
    }
  });

  it("is JPEG where the browser can't write WebP, or PNG to keep transparency", () => {
    const formats = ["image/jpeg", "image/png"];
    expect(encodePicture(fakeCanvas({ formats }).draw)).toMatch(/^data:image\/jpeg;/);
    expect(encodePicture(fakeCanvas({ formats, opaque: false }).draw)).toMatch(/^data:image\/png;/);
  });

  it("gets smaller until it fits the Otter account", () => {
    const { draw, drawn } = fakeCanvas({
      bytes: (side) => (side > 64 ? MAILBOX_PICTURE_MAX_LENGTH : 9000),
    });
    expect(encodePicture(draw).length).toBeLessThanOrEqual(MAILBOX_PICTURE_MAX_LENGTH);
    expect(drawn).toEqual([128, 96, 64]);
  });

  it("makes the size it's asked for", () => {
    const { draw, drawn } = fakeCanvas({ bytes: (side) => side * 50 });
    expect(encodePicture(draw, { sides: [64, 48, 32], maxLength: 2_500 }).length).toBeLessThan(
      2_500,
    );
    expect(drawn).toEqual([64, 48]);
  });

  it("gives up on an image that never fits", () => {
    const { draw } = fakeCanvas({ bytes: () => MAILBOX_PICTURE_MAX_LENGTH });
    expect(() => encodePicture(draw)).toThrow(PictureError);
  });
});
