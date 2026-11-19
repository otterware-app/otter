import { MAILBOX_PICTURE_MAX_LENGTH } from "@otter/contracts/relay";

/** The sides to try, largest first, and the longest data URL that fits. */
export type PictureSize = { sides: number[]; maxLength: number };

const MAILBOX: PictureSize = { sides: [128, 96, 64], maxLength: MAILBOX_PICTURE_MAX_LENGTH };
const QUALITY = 0.85;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class PictureError extends Error {}

// An empty type (HEIC on Linux) isn't refused here: decoding decides.
export function pictureFileProblem(file: { type: string; size: number }): string | null {
  if (file.type && !file.type.startsWith("image/")) {
    return "That isn't an image. Choose a PNG, JPEG or WebP.";
  }
  if (file.size > MAX_FILE_BYTES) return "That image is over 20 MB. Choose a smaller one.";
  return null;
}

export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export type DrawPicture = (side: number) => {
  opaque: boolean;
  encode: (type: string, quality: number) => string;
};

// Where a browser can't write WebP, canvas returns PNG: then JPEG, or PNG to keep transparency.
export function encodePicture(draw: DrawPicture, size: PictureSize = MAILBOX): string {
  for (const side of size.sides) {
    const { opaque, encode } = draw(side);
    let url = encode("image/webp", QUALITY);
    if (!url.startsWith("data:image/webp;"))
      url = encode(opaque ? "image/jpeg" : "image/png", QUALITY);
    if (url.length <= size.maxLength) return url;
  }
  throw new PictureError("Couldn't make that image small enough. Choose another.");
}

function canvasDraw(image: HTMLImageElement): DrawPicture {
  const crop = centerSquare(image.naturalWidth, image.naturalHeight);
  return (side) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, side, side);
    const { data } = context.getImageData(0, 0, side, side);
    let opaque = true;
    for (let alpha = 3; alpha < data.length && opaque; alpha += 4) opaque = data[alpha] === 255;
    return { opaque, encode: (type, quality) => canvas.toDataURL(type, quality) };
  };
}

export async function mailboxPicture(file: File, size?: PictureSize): Promise<string> {
  const problem = pictureFileProblem(file);
  if (problem) throw new PictureError(problem);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    // An <img>, unlike createImageBitmap, reads SVG and turns photos upright.
    await image.decode().catch(() => {
      throw new PictureError("Couldn't read that image. Choose a PNG, JPEG or WebP.");
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new PictureError("That image has no size. Choose a PNG, JPEG or WebP.");
    }
    return encodePicture(canvasDraw(image), size);
  } finally {
    URL.revokeObjectURL(url);
  }
}
