import { app, nativeImage, type NativeImage } from "electron";
import { join } from "node:path";
import { isNightlyVersion } from "@otter/shared/release-channel";

const resourcesDir = () =>
  app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");

export function appIconImage(): NativeImage {
  const filename = app.isPackaged
    ? isNightlyVersion(app.getVersion())
      ? "icon-nightly.png"
      : "icon.png"
    : "icon-dev.png";
  return nativeImage.createFromPath(join(resourcesDir(), filename));
}
