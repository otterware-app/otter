import { runAsTask } from "@otter-mail/core/extension-kit";
import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import * as drive from "./drive.js";

type Params = Record<string, unknown> | undefined;
const text = (value: unknown, max = 500) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

export default {
  manifest,
  activate({ handle }) {
    /** A handler whose work may take a while: it answers when done (`task`). */
    const slow = (channel: string, work: (p: Params) => Promise<unknown>) =>
      handle(channel, (params: unknown) => {
        const p = params as Params;
        return runAsTask(text(p?.taskId), () => work(p));
      });
    const id = (p: Params) => {
      const value = text(p?.id, 200);
      if (!value) throw new Error("Invalid Otter Drive document.");
      return value;
    };
    const folder = (p: Params) => text(p?.folderId, 200);
    const needFolder = (p: Params) => {
      const value = folder(p);
      if (!value) throw new Error("Choose a drive.");
      return value;
    };

    handle("otterDrive:status", () => drive.driveStatus());
    handle("otterDrive:startSignIn", () => drive.startSignIn());
    handle("otterDrive:finishSignIn", (params: unknown) => {
      const p = params as Params;
      const deviceCode = text(p?.deviceCode);
      if (!deviceCode) throw new Error("Invalid Otter Drive sign-in.");
      return runAsTask(text(p?.taskId), () => drive.finishSignIn(deviceCode));
    });
    handle("otterDrive:cancelSignIn", () => drive.cancelSignIn());
    handle("otterDrive:disconnect", () => drive.disconnect());

    slow("otterDrive:drives", () => drive.drives());
    slow("otterDrive:folders", () => drive.folders());
    slow("otterDrive:setDriveHidden", (p) => {
      const value = text(p?.id, 200);
      if (!value) throw new Error("Invalid drive.");
      return drive.setDriveHidden(value, p?.hidden === true);
    });

    slow("otterDrive:artifacts", (p) => drive.artifacts(needFolder(p), p?.archived === true));
    slow("otterDrive:shared", () => drive.sharedWithMe());
    slow("otterDrive:artifact", (p) => drive.getArtifact(id(p), folder(p)));
    slow("otterDrive:versions", (p) => drive.versions(id(p), folder(p)));
    slow("otterDrive:preview", (p) => {
      const version =
        typeof p?.version === "number" && Number.isInteger(p.version) && p.version > 0
          ? p.version
          : undefined;
      return drive.preview(id(p), folder(p), version);
    });
    slow("otterDrive:rename", (p) => {
      const title = text(p?.title, 200);
      if (!title) throw new Error("Give it a title.");
      return drive.rename(id(p), folder(p), title);
    });
    slow("otterDrive:setArchived", (p) =>
      drive.setArchived(id(p), folder(p), p?.archived === true),
    );
    slow("otterDrive:thumbnail", (p) => {
      const url = text(p?.url, 4_000);
      if (!url) throw new Error("Invalid thumbnail.");
      return drive.thumbnail(url);
    });

    slow("otterDrive:uploadPicked", (p) => drive.uploadPicked(needFolder(p)));
    slow("otterDrive:uploadBytes", (p) => {
      const name = text(p?.name, 255);
      const base64 = text(p?.base64, 140_000_000);
      if (!name || !base64) throw new Error("Invalid file.");
      const type = typeof p?.type === "string" ? p.type.slice(0, 200) : "";
      return drive.uploadBytes(needFolder(p), { name, type, base64 });
    });
    slow("otterDrive:publish", (p) => {
      const accountId = text(p?.accountId),
        messageId = text(p?.messageId),
        title = text(p?.title);
      if (!accountId || !messageId || !title) throw new Error("Invalid Otter Drive request.");
      const attachmentId = p?.attachmentId === undefined ? undefined : text(p.attachmentId, 2_000);
      if (p?.attachmentId !== undefined && !attachmentId)
        throw new Error("Invalid Otter Drive request.");
      return drive.publish({ folderId: needFolder(p), accountId, messageId, attachmentId, title });
    });
  },
} satisfies CoreExtension;
