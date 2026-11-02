import { ipc, task } from "@otter-mail/web/extension-kit";

export type DriveOrganization = { id: string; name: string; slug: string };
export type DriveArtifact = {
  id: string;
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  url: string;
  versionCount: number;
};

export const driveApi = {
  status: (): Promise<{ connected: boolean; organizationId?: string }> => ipc("otterDrive:status"),
  startSignIn: (): Promise<{ userCode: string; verificationUrl: string; deviceCode: string }> =>
    ipc("otterDrive:startSignIn"),
  finishSignIn: (deviceCode: string): Promise<void> =>
    task("otterDrive:finishSignIn", { deviceCode }),
  cancelSignIn: (): Promise<void> => ipc("otterDrive:cancelSignIn"),
  disconnect: (): Promise<void> => ipc("otterDrive:disconnect"),
  organizations: (): Promise<DriveOrganization[]> => task("otterDrive:organizations", {}),
  selectOrganization: (id: string): Promise<void> => task("otterDrive:setOrganization", { id }),
  artifacts: (): Promise<DriveArtifact[]> => task("otterDrive:artifacts", {}),
  publish: (input: {
    accountId: string;
    messageId: string;
    attachmentId?: string;
    title: string;
  }): Promise<{ url: string; title: string }> => task("otterDrive:publish", input),
};
