import { useState, type ReactNode } from "react";
import type { ImapSettings, MailServer } from "@otter-mail/contracts";
import { ChevronRightIcon, CloudIcon, ServerIcon } from "lucide-react";
import { GmailMark, MicrosoftMark } from "./provider-mark";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { mailApi } from "./api";
import { useAddAccount, useAddImapAccount, useMailProviders, useSignInImap } from "./hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { toast } from "./toast";
import type { MailAccount } from "./types";
import { cn } from "./ui";

export function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

export function useAddOutlook(onAdded?: (account: MailAccount) => void) {
  const add = useAddAccount("outlook");
  const start = () =>
    void add.mutateAsync(undefined).then(
      (account) => {
        if (account) onAdded?.(account);
      },
      (err: unknown) =>
        toast.error("Couldn't add the mailbox", { description: readableError(err) }),
    );
  return { start, pending: add.isPending };
}

export function AddMailboxMenu({
  onGmail,
  onAdded,
  align = "start",
  services,
  children,
}: {
  onGmail: () => void;
  onAdded?: (account: MailAccount) => void;
  align?: "start" | "end";
  services?: ReactNode;
  children: ReactNode;
}) {
  const [imapOpen, setImapOpen] = useState<ImapService | null>(null);
  const outlook = useAddOutlook(onAdded);
  const providers = useMailProviders().data;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {services ? <DropdownMenuLabel>Mail & calendar</DropdownMenuLabel> : null}
          <DropdownMenuItem icon={<GmailMark />} onSelect={onGmail}>
            Gmail
          </DropdownMenuItem>
          {providers?.outlook ? (
            <DropdownMenuItem icon={<MicrosoftMark />} onSelect={outlook.start}>
              Outlook
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem icon={<CloudIcon />} onSelect={() => setImapOpen("icloud")}>
            iCloud
          </DropdownMenuItem>
          <DropdownMenuItem icon={<ServerIcon />} onSelect={() => setImapOpen("other")}>
            Other mail (IMAP)
          </DropdownMenuItem>
          {services ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Other services</DropdownMenuLabel>
              {services}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ImapAccountDialog
        open={imapOpen !== null}
        service={imapOpen ?? undefined}
        onOpenChange={(open) => {
          if (!open) setImapOpen(null);
        }}
        onAdded={onAdded}
      />
    </>
  );
}

const APP_PASSWORDS: { host: RegExp; hint: string }[] = [
  {
    host: /(^|\.)me\.com$/,
    hint: "iCloud needs an app-specific password, made at account.apple.com.",
  },
  {
    host: /(^|\.)yahoo\.com$/,
    hint: "Yahoo needs an app password, made in your Yahoo account's security settings.",
  },
  {
    host: /(^|\.)fastmail\.com$/,
    hint: "Fastmail needs an app password, made in Settings › Privacy & Security.",
  },
  {
    host: /(^|\.)aol\.com$/,
    hint: "AOL needs an app password, made in your AOL account's security settings.",
  },
  { host: /(^|\.)gmx\.(com|net|de)$/, hint: "GMX needs IMAP turned on in its web settings first." },
  {
    host: /(^|\.)(office365|outlook)\.com$/,
    hint: "Outlook and Microsoft 365 don't take passwords over IMAP: add the mailbox as Outlook instead.",
  },
];

function appPasswordHint(settings: ImapSettings | null): string | undefined {
  const host = settings?.imap.host.toLowerCase();
  return host ? APP_PASSWORDS.find((p) => p.host.test(host))?.hint : undefined;
}

function guessSettings(email: string): ImapSettings {
  const domain = email.split("@")[1] ?? "";
  return {
    username: email,
    imap: { host: domain ? `imap.${domain}` : "", port: 993, security: "tls" },
    smtp: { host: domain ? `smtp.${domain}` : "", port: 465, security: "tls" },
  };
}

function icloudSettings(email: string): ImapSettings {
  return {
    username: email,
    imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  };
}

const ICLOUD_DOMAINS = /@(icloud|me|mac)\.com$/i;
const APPLE_ACCOUNT_URL = "https://account.apple.com";

export type ImapService = "icloud" | "other";

const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

type Discovery = { email: string; state: "looking" | "found" | "none" } | null;

export function ImapAccountDialog({
  open,
  service = "other",
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  service?: ImapService;
  onOpenChange: (open: boolean) => void;
  onAdded?: (account: MailAccount) => void;
}) {
  const add = useAddImapAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<ImapSettings | null>(null);
  const [discovery, setDiscovery] = useState<Discovery>(null);
  const [showServers, setShowServers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setPassword("");
    setName("");
    setSettings(null);
    setDiscovery(null);
    setShowServers(false);
    setError(null);
  };

  const discover = async (address: string): Promise<ImapSettings> => {
    if (discovery?.email === address && settings) return settings;
    setDiscovery({ email: address, state: "looking" });
    setError(null);
    const found = await mailApi.discoverImap(address).catch(() => null);
    const icloud = service === "icloud";
    const next = found ?? (icloud ? icloudSettings(address) : guessSettings(address));
    setSettings(next);
    setDiscovery({ email: address, state: found || icloud ? "found" : "none" });
    if (!found && !icloud) setShowServers(true);
    return next;
  };

  const submit = async () => {
    const address = email.trim();
    setError(null);
    if (!looksLikeEmail(address)) {
      setError("Enter your email address.");
      throw new Error("invalid");
    }
    const imap = await discover(address);
    if (!password) {
      setError("Enter your password.");
      throw new Error("invalid");
    }
    try {
      const account = await add.mutateAsync({
        email: address,
        name: name.trim() || undefined,
        password,
        imap,
      });
      onAdded?.(account);
    } catch (err) {
      const message = readableError(err);
      setError(message);
      if (/reach|connect|certificate|tls|timed out|host|port/i.test(message)) setShowServers(true);
      throw err;
    }
  };

  const setServer = (key: "imap" | "smtp", server: MailServer) =>
    setSettings((s) => (s ? { ...s, [key]: server } : s));
  const icloud = service === "icloud";
  const hint = icloud ? undefined : appPasswordHint(settings);
  // iCloud+ custom domains sign in with the Apple Account's iCloud address.
  const ownDomain = icloud && looksLikeEmail(email.trim()) && !ICLOUD_DOMAINS.test(email.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title={icloud ? "Add iCloud" : "Add other mail"}
      size="large"
      description={
        icloud
          ? "Apple doesn't let other apps use your Apple Account password: make an app-specific password for Otter Mail."
          : "Any mailbox that works with IMAP: iCloud, Fastmail, Yahoo, your own domain."
      }
      confirmLabel={add.isPending ? "Signing in…" : "Add mailbox"}
      confirmDisabled={add.isPending}
      onConfirm={submit}
    >
      <div className="flex flex-col gap-3">
        {icloud ? (
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
            <li>
              Open{" "}
              <button
                type="button"
                className="cursor-pointer text-foreground underline underline-offset-2"
                onClick={() => void window.desktopBridge.openExternal(APPLE_ACCOUNT_URL)}
              >
                account.apple.com
              </button>{" "}
              and sign in.
            </li>
            <li>Sign-In and Security › App-Specific Passwords: add one named Otter Mail.</li>
            <li>Paste it below, with your iCloud address.</li>
          </ol>
        ) : null}
        <Field
          label="Email"
          description={
            ownDomain
              ? "With your own domain, sign in with your @icloud.com address. Your domain's addresses go in Send from after."
              : undefined
          }
        >
          <Input
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              const address = email.trim();
              if (looksLikeEmail(address)) void discover(address);
            }}
            placeholder={icloud ? "you@icloud.com" : "you@example.com"}
          />
        </Field>
        <Field label={icloud ? "App-specific password" : "Password"} description={hint}>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={icloud ? "xxxx-xxxx-xxxx-xxxx" : undefined}
          />
        </Field>
        <Field label="Your name (optional)">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shown to the people you write to"
          />
        </Field>

        {settings ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={showServers}
              onClick={() => setShowServers((s) => !s)}
              className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronRightIcon
                className={cn("size-3.5 shrink-0 transition-transform", showServers && "rotate-90")}
              />
              <span className="shrink-0">Server settings</span>
              {showServers ? null : (
                <span className="min-w-0 truncate text-muted-foreground/70">
                  {settings.imap.host} · {settings.smtp.host}
                </span>
              )}
            </button>
            {showServers ? (
              <>
                {discovery?.state === "none" ? (
                  <p className="text-xs text-muted-foreground">
                    Otter Mail couldn't find this domain's servers. Check these with your mail
                    provider.
                  </p>
                ) : null}
                <ServerFields
                  label="Incoming (IMAP)"
                  server={settings.imap}
                  ports={{ tls: 993, starttls: 143 }}
                  onChange={(server) => setServer("imap", server)}
                />
                <ServerFields
                  label="Outgoing (SMTP)"
                  server={settings.smtp}
                  ports={{ tls: 465, starttls: 587 }}
                  onChange={(server) => setServer("smtp", server)}
                />
                <Field label="Username">
                  <Input
                    autoComplete="off"
                    value={settings.username}
                    onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </div>
        ) : discovery?.state === "looking" ? (
          <p className="text-[13px] text-muted-foreground">Looking up the servers…</p>
        ) : null}

        {error ? (
          <p role="alert" className="text-[13px] text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function ServerFields({
  label,
  server,
  ports,
  onChange,
}: {
  label: string;
  server: MailServer;
  ports: Record<MailServer["security"], number>;
  onChange: (server: MailServer) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <Input
          aria-label={`${label} server`}
          autoComplete="off"
          value={server.host}
          onChange={(e) => onChange({ ...server, host: e.target.value.trim() })}
          placeholder="mail.example.com"
          className="flex-1"
        />
        <Input
          aria-label={`${label} port`}
          inputMode="numeric"
          value={String(server.port)}
          onChange={(e) => onChange({ ...server, port: Number(e.target.value.replace(/\D/g, "")) })}
          className="w-16 text-center tabular-nums"
        />
        <Select
          value={server.security}
          onValueChange={(security: MailServer["security"]) =>
            onChange({
              ...server,
              security,
              port: server.port === ports[server.security] ? ports[security] : server.port,
            })
          }
        >
          <SelectTrigger aria-label={`${label} security`} className="w-28 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tls">SSL/TLS</SelectItem>
            <SelectItem value="starttls">STARTTLS</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * Signs an IMAP mailbox in on this device: its password stays on the device
 * it was typed on, so a mailbox linked elsewhere asks for it here once. It
 * names the server the password goes to: the settings came from the Otter
 * account, and whoever holds that session could have changed them.
 */
export function ImapPasswordForm({
  account,
  size = "small",
  className,
}: {
  account: MailAccount;
  size?: "small" | "default";
  className?: string;
}) {
  const signIn = useSignInImap();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const where = account.imap
    ? `Password for ${account.imap.username} on ${account.imap.imap.host}`
    : `Password for ${account.email}`;
  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || signIn.isPending) return;
        setError(null);
        signIn.mutate(
          { accountId: account.id, password },
          { onError: (err) => setError(readableError(err)), onSuccess: () => setPassword("") },
        );
      }}
    >
      <p className="text-xs text-muted-foreground">{where}</p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="current-password"
          aria-label={where}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={size === "small" ? "h-7 min-w-44 text-[13px]" : "min-w-52"}
        />
        <Button type="submit" size={size} variant="accent" disabled={!password || signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </form>
  );
}
