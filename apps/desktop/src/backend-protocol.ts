/**
 * Main and the backend (core in a utility process) talk over the utility
 * process's port with core's RPC protocol (`@otter-mail/contracts/rpc`).
 */

export type AppInfo = {
  stateDir: string;
  version: string;
  packaged: boolean;
  resourcesPath: string;
  errorReports: boolean;
};

const APP_INFO_ENV = "OTTER_MAIL_APP_INFO";

export const appInfoEnv = (info: AppInfo) => ({ [APP_INFO_ENV]: JSON.stringify(info) });

let info: AppInfo | null = null;

export function appInfo(): AppInfo {
  return (info ??= JSON.parse(process.env[APP_INFO_ENV] ?? "null") as AppInfo);
}
