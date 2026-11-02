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
    handle("otterDrive:organizations", (params: unknown) =>
      runAsTask(text((params as Params)?.taskId), drive.organizations),
    );
    handle("otterDrive:setOrganization", (params: unknown) => {
      const p = params as Params;
      const id = text(p?.id, 200);
      if (!id) throw new Error("Invalid Otter Drive organization.");
      return runAsTask(text(p?.taskId), () => drive.selectOrganization(id));
    });
    handle("otterDrive:artifacts", (params: unknown) =>
      runAsTask(text((params as Params)?.taskId), drive.artifacts),
    );
    handle("otterDrive:publish", (params: unknown) => {
      const p = params as Params;
      const accountId = text(p?.accountId),
        messageId = text(p?.messageId),
        title = text(p?.title);
      if (!accountId || !messageId || !title) throw new Error("Invalid Otter Drive request.");
      const attachmentId = p?.attachmentId === undefined ? undefined : text(p.attachmentId, 2_000);
      if (p?.attachmentId !== undefined && !attachmentId)
        throw new Error("Invalid Otter Drive request.");
      return runAsTask(text(p?.taskId), () =>
        drive.publish({ accountId, messageId, attachmentId, title }),
      );
    });
  },
} satisfies CoreExtension;
