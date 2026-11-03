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

    const versionOf = (p: Params) =>
      typeof p?.version === "number" && Number.isInteger(p.version) && p.version > 0
        ? p.version
        : undefined;
    const name = (p: Params) => {
      const value = text(p?.name, 200);
      if (!value) throw new Error("Give it a name.");
      return value;
    };

    handle("otterDrive:status", () => drive.driveStatus());
    handle("otterDrive:startSignIn", () => drive.startSignIn());
    handle("otterDrive:finishSignIn", (params: unknown) => {
      const p = params as Params;
      const deviceCode = text(p?.deviceCode);
      const attempt = p?.attempt;
      if (!deviceCode || typeof attempt !== "number")
        throw new Error("Invalid Otter Drive sign-in.");
      return runAsTask(text(p?.taskId), () => drive.finishSignIn(deviceCode, attempt));
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
    slow("otterDrive:search", (p) => drive.search(text(p?.query, 200) ?? ""));
    slow("otterDrive:artifact", (p) => drive.getArtifact(id(p), folder(p)));
    slow("otterDrive:versions", (p) => drive.versions(id(p), folder(p)));
    slow("otterDrive:preview", (p) => drive.preview(id(p), folder(p), versionOf(p)));
    slow("otterDrive:rename", (p) => {
      const title = text(p?.title, 200);
      if (!title) throw new Error("Give it a title.");
      return drive.rename(id(p), folder(p), title);
    });
    slow("otterDrive:setArchived", (p) =>
      drive.setArchived(id(p), folder(p), p?.archived === true),
    );
    slow("otterDrive:thumbnail", (p) => drive.thumbnail(id(p), folder(p)));

    slow("otterDrive:download", (p) => drive.download(id(p), folder(p), versionOf(p)));
    slow("otterDrive:uploadVersion", (p) => drive.uploadNewVersion(id(p), folder(p)));
    slow("otterDrive:move", (p) => {
      const to = text(p?.destination, 200);
      if (!to) throw new Error("Choose a folder.");
      return drive.move(id(p), folder(p), to);
    });
    slow("otterDrive:deletePermanently", (p) => drive.deletePermanently(id(p), folder(p)));
    slow("otterDrive:createFolder", (p) => drive.createFolder(needFolder(p), name(p)));
    slow("otterDrive:updateFolder", (p) => {
      const parentId = p?.parentId === undefined ? undefined : text(p.parentId, 200);
      return drive.updateFolder(needFolder(p), {
        ...(p?.name === undefined ? {} : { name: name(p) }),
        ...(parentId ? { parentId } : {}),
      });
    });
    slow("otterDrive:deleteFolder", (p) => drive.deleteFolder(needFolder(p)));

    const target = (p: Params): drive.ShareTarget => {
      const type = p?.type === "folder" || p?.type === "artifact" ? p.type : null;
      const value = text(p?.id, 200);
      if (!type || !value) throw new Error("Invalid Otter Drive sharing request.");
      return { type, id: value, ...(folder(p) ? { folderId: folder(p) } : {}) };
    };
    const role = (value: unknown): drive.ShareRole | null =>
      value === "viewer" || value === "editor" ? value : null;
    slow("otterDrive:sharing", (p) => drive.sharing(target(p)));
    slow("otterDrive:sharePeople", (p) => {
      const emails = Array.isArray(p?.emails)
        ? p.emails.filter((e): e is string => typeof e === "string" && e.length <= 254)
        : [];
      const r = role(p?.role);
      if (!emails.length || emails.length > 20 || !r) throw new Error("Add someone by email.");
      const message = text(p?.message, 1_000);
      return drive.sharePeople(target(p), {
        emails,
        role: r,
        notify: p?.notify !== false,
        ...(message ? { message } : {}),
      });
    });
    slow("otterDrive:setShareRole", (p) => {
      const entry = text(p?.entryId, 200);
      if (!entry) throw new Error("Invalid Otter Drive sharing request.");
      return drive.setShareRole(target(p), entry, role(p?.role));
    });
    slow("otterDrive:setShareLink", (p) => drive.setShareLink(target(p), role(p?.role)));
    slow("otterDrive:people", (p) => drive.suggestPeople(text(p?.query, 200) ?? ""));
    slow("otterDrive:me", () => drive.me());
    slow("otterDrive:resolveLink", (p) => {
      const href = text(p?.href, 2_000);
      return href ? drive.resolveLink(href) : Promise.resolve(null);
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
