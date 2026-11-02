import {
  Btn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  searchableSetting,
  toast,
} from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { driveApi } from "./api";
import { browseOtterDrive, useDriveStatus } from "./dialogs";

export function OtterDriveSettingsPane() {
  const status = useDriveStatus();
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const connected = status.data?.connected === true;
  const organizations = useQuery({
    queryKey: ["otter-drive", "organizations"],
    queryFn: driveApi.organizations,
    enabled: connected,
    retry: false,
  });
  useEffect(() => () => void driveApi.cancelSignIn().catch(() => {}), []);

  const refresh = async () => {
    await qc.resetQueries({ queryKey: ["otter-drive"] });
  };
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
      setCode(null);
    }
  };
  const signIn = () =>
    run(async () => {
      const start = await driveApi.startSignIn();
      setCode(start.userCode);
      // The system browser, where Otter Drive's session is: Settings stays open with the code.
      void window.desktopBridge.openExternal(start.verificationUrl).catch(() => {});
      await driveApi.finishSignIn(start.deviceCode);
    });

  return (
    <SettingsSection {...searchableSetting("otter-drive")}>
      <SettingsRow
        title="Otter Drive"
        description={
          status.isError
            ? "Could not read the connection. Try again."
            : !status.data
              ? "Loading…"
              : connected
                ? "Signed in on this device. Save attachments and emails from the reader's menu."
                : "Save attachments and emails to your Otter Drive organization."
        }
        control={
          connected ? (
            <Btn size="sm" onClick={browseOtterDrive}>
              Browse
            </Btn>
          ) : undefined
        }
      />
      {connected && organizations.data && organizations.data.length > 1 ? (
        <SettingsRow
          title="Organization"
          description="Where what you save goes, and what Browse shows."
          control={
            <Select
              value={status.data?.organizationId ?? organizations.data[0]!.id}
              onValueChange={(id) => void run(() => driveApi.selectOrganization(id))}
              disabled={pending}
            >
              <SelectTrigger aria-label="Otter Drive organization">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {organizations.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ) : null}
      <SettingsRow
        title={connected ? "Connection" : "Sign in to Otter Drive"}
        description={
          code ? (
            <span>
              Confirm the code <span className="font-mono font-medium">{code}</span> in your
              browser.
            </span>
          ) : (
            "Sign in in your browser. Your sign-in stays on this device."
          )
        }
        control={
          <div className="flex gap-2">
            {code ? (
              <Btn size="sm" onClick={() => void driveApi.cancelSignIn()}>
                Cancel
              </Btn>
            ) : (
              <Btn
                size="sm"
                variant={connected ? "outline" : "primary"}
                disabled={pending || !status.data}
                onClick={() => void signIn()}
              >
                {pending ? "Signing in…" : connected ? "Sign in again" : "Sign in"}
              </Btn>
            )}
            {connected && !code ? (
              <Btn size="sm" disabled={pending} onClick={() => void run(driveApi.disconnect)}>
                Sign out
              </Btn>
            ) : null}
          </div>
        }
      />
    </SettingsSection>
  );
}
