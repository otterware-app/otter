/**
 * A drive's page in Settings, as Otter Drive has it: its name and your
 * access, its members (a shared drive's), where it stores its files, and
 * handing it over or deleting it. And your API keys, for agents.
 */

import {
  Btn,
  Dialog,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  TextInput,
  toast,
} from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { useState, type ChangeEvent } from "react";

import {
  driveApi,
  driveLabel,
  type DriveFolder,
  type StorageBackend,
  type StorageChange,
  type StorageLocation,
} from "./api";
import { when } from "./document";
import { DriveMark } from "./drive-mark";
import { errorText, useRefresh } from "./hooks";
import { share } from "./share";

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Couldn't copy it."),
  );

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const usage = (files: number, bytes: number) =>
  `${files} ${files === 1 ? "file" : "files"}, ${formatBytes(bytes)}`;

// ---------------------------------------------------------------------------
// A drive's page.
// ---------------------------------------------------------------------------

export function DrivePage({ drive, back }: { drive: DriveFolder; back: () => void }) {
  const refresh = useRefresh();
  const owner = drive.role === "owner";
  const shared = drive.kind === "shared";
  const [name, setName] = useState(drive.name);
  const [dialog, setDialog] = useState<"transfer" | "delete" | null>(null);
  const rename = async () => {
    const clean = name.trim();
    if (!clean || clean === drive.name) return setName(drive.name);
    try {
      await driveApi.renameDrive(drive.id, clean);
      await refresh();
      toast.success("Renamed");
    } catch (error) {
      setName(drive.name);
      toast.error(errorText(error));
    }
  };

  return (
    <>
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Back to Otter Drive"
              onClick={back}
              className="-ms-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <DriveMark folder={drive} />
            {driveLabel(drive)}
          </span>
        }
        description={
          shared
            ? "A shared drive: its members open every folder and document in it."
            : "Your own drive. Share its folders and documents with people."
        }
      >
        <SettingsRow
          title="Name"
          description={
            !shared
              ? "My Drive is always called My Drive."
              : owner
                ? "Everyone in the drive sees this name."
                : "Only the drive's owner renames it."
          }
          control={
            shared && owner ? (
              <TextInput
                aria-label="Drive name"
                className="w-56"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : undefined
          }
        />
        <SettingsRow
          title="Your access"
          description={
            owner
              ? shared
                ? "You own it: you manage its members, storage and name."
                : "It's yours: you manage its storage."
              : drive.role === "editor"
                ? "You're an editor: you add, change and share what's in it."
                : "You're a viewer: you open and download what's in it."
          }
        />
        {shared ? (
          <SettingsRow
            title="Members"
            description="People in the drive open everything in it; editors also change it."
            control={
              <Btn
                size="sm"
                onClick={() => share({ type: "folder", id: drive.id, name: drive.name })}
              >
                {owner ? "Manage members…" : "See members"}
              </Btn>
            }
          />
        ) : null}
      </SettingsSection>

      {owner ? <StorageSection drive={drive} /> : null}

      {shared && owner ? (
        <SettingsSection title="Ownership">
          <SettingsRow
            title="Transfer ownership"
            description="Give the drive to one of its members. You stay on as an editor."
            control={
              <Btn size="sm" onClick={() => setDialog("transfer")}>
                Transfer…
              </Btn>
            }
          />
          <SettingsRow
            title="Delete this shared drive"
            description="Its members lose it. It must be empty first."
            control={
              <Btn size="sm" variant="destructive" onClick={() => setDialog("delete")}>
                Delete drive…
              </Btn>
            }
          />
        </SettingsSection>
      ) : null}

      {dialog === "transfer" ? (
        <TransferDialog drive={drive} close={() => setDialog(null)} done={back} />
      ) : null}
      {dialog === "delete" ? (
        <Dialog
          open
          title={`Delete “${drive.name}”?`}
          description="Its members lose access. Only an empty drive can be deleted."
          onOpenChange={(open) => !open && setDialog(null)}
          confirmLabel="Delete drive"
          confirmVariant="destructive"
          onConfirm={async () => {
            try {
              await driveApi.deleteDrive(drive.id);
            } catch (error) {
              toast.error(errorText(error));
              throw error;
            }
            await refresh();
            toast.success(`Deleted “${drive.name}”`);
            back();
          }}
        />
      ) : null}
    </>
  );
}

function TransferDialog({
  drive,
  close,
  done,
}: {
  drive: DriveFolder;
  close: () => void;
  done: () => void;
}) {
  const refresh = useRefresh();
  const members = useQuery({
    queryKey: ["otter-drive", "members", drive.id],
    queryFn: () => driveApi.driveMembers(drive.id),
    retry: false,
  });
  // Only someone who has signed in to Drive can own it.
  const eligible = (members.data ?? []).filter((m) => m.userId);
  const [to, setTo] = useState<string | undefined>(undefined);
  const picked = eligible.find((m) => m.userId === to);
  return (
    <Dialog
      open
      title={`Transfer “${drive.name}”`}
      description="The new owner manages its members, storage and name. You stay on as an editor."
      onOpenChange={(open) => !open && close()}
      confirmLabel="Transfer"
      confirmDisabled={!picked}
      onConfirm={async () => {
        try {
          await driveApi.transferDrive(drive.id, picked!.userId!);
        } catch (error) {
          toast.error(errorText(error));
          throw error;
        }
        await refresh();
        toast.success(`${picked!.email} owns “${drive.name}” now`);
        done();
      }}
    >
      {members.error ? (
        <p className="text-sm text-destructive-foreground">{errorText(members.error)}</p>
      ) : members.data && !eligible.length ? (
        <p className="text-sm text-muted-foreground">
          Add a member first: only someone who has signed in to Otter Drive can own it.
        </p>
      ) : (
        <Field label="New owner" orientation="vertical">
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger aria-label="New owner">
              <SelectValue placeholder={members.data ? "Choose a member" : "Loading…"} />
            </SelectTrigger>
            <SelectContent>
              {eligible.map((m) => (
                <SelectItem key={m.id} value={m.userId!}>
                  {m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Storage: Otterware's, or the owner's own buckets.
// ---------------------------------------------------------------------------

function describeLocation(location: StorageLocation): string {
  const prefix = location.prefix ? `/${location.prefix.replace(/\/$/, "")}` : "";
  switch (location.provider) {
    case "s3":
      return location.endpoint
        ? `${location.bucket}${prefix} at ${new URL(location.endpoint).host}`
        : `Amazon S3 · ${location.bucket}${prefix} (${location.region})`;
    case "gcs":
      return `Google Cloud Storage · ${location.bucket}${prefix}`;
    case "azure":
      return `Azure · ${location.account}/${location.container}${prefix}`;
  }
}

const OTTERWARE = "otterware";

function StorageSection({ drive }: { drive: DriveFolder }) {
  const qc = useQueryClient();
  const queryKey = ["otter-drive", "storage", drive.id];
  const storage = useQuery({
    queryKey,
    queryFn: () => driveApi.storage(drive.id),
    retry: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [rotating, setRotating] = useState<StorageBackend | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<StorageBackend | null>(null);
  const change = (c: StorageChange) => driveApi.changeStorage(drive.id, c);
  const refresh = () => qc.invalidateQueries({ queryKey });

  const setDefault = async (value: string) => {
    try {
      await change({ action: "default", backendId: value === OTTERWARE ? null : value });
      await refresh();
      toast.success("New uploads will go there");
    } catch (error) {
      toast.error(errorText(error));
    }
  };
  const check = async (backend: StorageBackend) => {
    setChecking(backend.id);
    try {
      await change({ action: "verify", backendId: backend.id });
      await refresh();
      toast.success(`${backend.name} works`, {
        description: "Drive wrote, read and deleted a test file.",
      });
    } catch (error) {
      toast.error(`${backend.name} failed its check`, { description: errorText(error) });
    } finally {
      setChecking(null);
    }
  };

  const data = storage.data;
  return (
    <SettingsSection
      title="Storage"
      description="Where the drive keeps its documents. Connect your own bucket to keep them in your cloud account."
    >
      {storage.error ? (
        <SettingsRow title="Couldn't load its storage" description={errorText(storage.error)} />
      ) : !data ? (
        <SettingsRow title="Loading…" />
      ) : (
        <>
          <SettingsRow
            title="Store new documents in"
            description="Changing this moves nothing: each version stays where it was written."
            control={
              <Select
                value={data.defaultBackendId ?? OTTERWARE}
                onValueChange={(v) => void setDefault(v)}
              >
                <SelectTrigger aria-label="Storage for new uploads" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OTTERWARE}>Otterware storage</SelectItem>
                  {data.backends.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Otterware storage"
            description={`Built in · ${usage(data.otterware.fileCount, data.otterware.byteSize)}`}
          />
          {data.backends.map((b) => (
            <SettingsRow
              key={b.id}
              title={
                <span className="flex items-center gap-2">
                  {b.name}
                  {b.isDefault ? (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      New uploads
                    </span>
                  ) : null}
                </span>
              }
              description={[
                describeLocation(b.location),
                usage(b.fileCount, b.byteSize),
                b.verifiedAt ? `checked ${when(b.verifiedAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              control={
                <div className="flex gap-1.5">
                  <Btn size="sm" disabled={checking === b.id} onClick={() => void check(b)}>
                    {checking === b.id ? "Checking…" : "Check"}
                  </Btn>
                  <Btn size="sm" onClick={() => setRotating(b)}>
                    Replace keys
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setLeaving(b)}>
                    Disconnect
                  </Btn>
                </div>
              }
            />
          ))}
          <SettingsRow
            title="Connect storage"
            description="Amazon S3, Google Cloud Storage, Azure Blob Storage, Cloudflare R2 or any S3-compatible service."
            control={
              <Btn size="sm" onClick={() => setConnecting(true)}>
                Connect…
              </Btn>
            }
          />
        </>
      )}
      {connecting ? (
        <ConnectStorageDialog
          close={() => setConnecting(false)}
          connect={async (input) => {
            const made = (await change({ action: "connect", input })) as { name: string };
            await refresh();
            toast.success(`Connected ${made.name}`, {
              description: input.makeDefault
                ? "New uploads go there now."
                : "Choose it for new uploads whenever you like.",
            });
          }}
        />
      ) : null}
      {rotating ? (
        <RotateKeysDialog
          backend={rotating}
          close={() => setRotating(null)}
          rotate={async (keys) => {
            await change({ action: "keys", backendId: rotating.id, keys });
            await refresh();
            toast.success("New keys work and are in use");
          }}
        />
      ) : null}
      {leaving ? (
        <Dialog
          open
          title={`Disconnect ${leaving.name}?`}
          description="Drive forgets its credentials; nothing in the bucket is deleted."
          onOpenChange={(open) => !open && setLeaving(null)}
          confirmLabel="Disconnect"
          confirmVariant="destructive"
          onConfirm={async () => {
            try {
              await change({ action: "disconnect", backendId: leaving.id });
            } catch (error) {
              toast.error(errorText(error));
              throw error;
            }
            await refresh();
            toast.success(`Disconnected ${leaving.name}`);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

/** The services the form knows; the last two are S3 underneath. */
const PRESETS = {
  aws: "Amazon S3",
  gcs: "Google Cloud Storage",
  azure: "Azure Blob Storage",
  r2: "Cloudflare R2",
  other: "Other S3-compatible",
} as const;
type Preset = keyof typeof PRESETS;

const EMPTY = {
  name: "",
  bucket: "",
  region: "",
  endpoint: "",
  r2Account: "",
  prefix: "otterdrive/",
  accessKeyId: "",
  secretAccessKey: "",
  account: "",
  container: "",
  accountKey: "",
  sasToken: "",
};

function ConnectStorageDialog({
  close,
  connect,
}: {
  close: () => void;
  connect: (input: Record<string, string | boolean>) => Promise<void>;
}) {
  const [preset, setPreset] = useState<Preset>("aws");
  const [form, setForm] = useState(EMPTY);
  const [makeDefault, setMakeDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  const name = form.name.trim() || (preset === "azure" ? form.container : form.bucket).trim();
  const input = (): Record<string, string | boolean> => {
    const common = { name, prefix: form.prefix, makeDefault };
    if (preset === "gcs")
      return {
        ...common,
        provider: "gcs",
        bucket: form.bucket,
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
      };
    if (preset === "azure")
      return {
        ...common,
        provider: "azure",
        account: form.account,
        container: form.container,
        ...(form.endpoint.trim() ? { endpoint: form.endpoint } : {}),
        ...(form.sasToken.trim() ? { sasToken: form.sasToken } : { accountKey: form.accountKey }),
      };
    return {
      ...common,
      provider: "s3",
      bucket: form.bucket,
      region: preset === "r2" ? "auto" : form.region.trim() || "us-east-1",
      ...(preset === "r2"
        ? { endpoint: `https://${form.r2Account.trim()}.r2.cloudflarestorage.com` }
        : preset === "other"
          ? { endpoint: form.endpoint }
          : {}),
      accessKeyId: form.accessKeyId,
      secretAccessKey: form.secretAccessKey,
    };
  };
  const complete =
    Boolean(name) &&
    (preset === "azure"
      ? Boolean(
          form.account.trim() &&
          form.container.trim() &&
          (form.accountKey.trim() || form.sasToken.trim()),
        )
      : Boolean(
          form.bucket.trim() &&
          form.accessKeyId.trim() &&
          form.secretAccessKey.trim() &&
          (preset !== "r2" || form.r2Account.trim()) &&
          (preset !== "other" || form.endpoint.trim()),
        ));

  const secret = (key: keyof typeof EMPTY, placeholder?: string) => (
    <Input
      type="password"
      autoComplete="off"
      value={form[key]}
      onChange={set(key)}
      placeholder={placeholder}
    />
  );

  return (
    <Dialog
      open
      size="large"
      title="Connect storage"
      description="Drive checks the bucket (it writes, reads and deletes a small test file) before connecting it. Credentials are encrypted and never shown again."
      onOpenChange={(open) => !open && close()}
      confirmLabel="Check and connect"
      confirmDisabled={!complete}
      onConfirm={async () => {
        setError(null);
        try {
          await connect(input());
        } catch (reason) {
          setError(errorText(reason));
          throw reason;
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <Field label="Service" orientation="vertical">
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger aria-label="Service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRESETS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {preset === "azure" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Storage account" orientation="vertical">
              <Input value={form.account} onChange={set("account")} />
            </Field>
            <Field label="Container" orientation="vertical">
              <Input value={form.container} onChange={set("container")} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket" orientation="vertical">
              <Input value={form.bucket} onChange={set("bucket")} />
            </Field>
            {preset === "aws" || preset === "other" ? (
              <Field label="Region" orientation="vertical">
                <Input value={form.region} onChange={set("region")} placeholder="us-east-1" />
              </Field>
            ) : preset === "r2" ? (
              <Field label="Account ID" orientation="vertical">
                <Input value={form.r2Account} onChange={set("r2Account")} />
              </Field>
            ) : null}
          </div>
        )}
        {preset === "other" ? (
          <Field label="Endpoint" orientation="vertical">
            <Input
              value={form.endpoint}
              onChange={set("endpoint")}
              placeholder="https://s3.example.com"
            />
          </Field>
        ) : null}
        {preset === "azure" ? (
          <>
            <Field
              label="Blob endpoint"
              description="Leave it empty for Azure's public cloud; set it for Azure Government, China or a private endpoint."
              orientation="vertical"
            >
              <Input
                value={form.endpoint}
                onChange={set("endpoint")}
                placeholder="https://<account>.blob.core.windows.net"
              />
            </Field>
            <Field
              label="Account key"
              description="Or leave it empty and give a SAS token for the container."
              orientation="vertical"
            >
              {secret("accountKey")}
            </Field>
            <Field label="SAS token" orientation="vertical">
              {secret("sasToken", "sv=…&sig=…")}
            </Field>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={preset === "gcs" ? "HMAC access ID" : "Access key ID"}
              orientation="vertical"
            >
              <Input autoComplete="off" value={form.accessKeyId} onChange={set("accessKeyId")} />
            </Field>
            <Field label="Secret" orientation="vertical">
              {secret("secretAccessKey")}
            </Field>
          </div>
        )}
        {preset === "gcs" ? (
          <p className="text-xs text-muted-foreground">
            Create an HMAC key for a service account under Cloud Storage → Settings →
            Interoperability.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Folder in the bucket" orientation="vertical">
            <Input value={form.prefix} onChange={set("prefix")} placeholder="otterdrive/" />
          </Field>
          <Field label="Name in Drive" orientation="vertical">
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder={(preset === "azure" ? form.container : form.bucket) || "Company bucket"}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
          />
          Store new uploads here
        </label>
        {error ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function RotateKeysDialog({
  backend,
  close,
  rotate,
}: {
  backend: StorageBackend;
  close: () => void;
  rotate: (keys: Record<string, string>) => Promise<void>;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const azure = backend.location.provider === "azure";
  return (
    <Dialog
      open
      size="small"
      title={`Replace keys for ${backend.name}`}
      description="Drive checks the new keys before it uses them; the old ones keep working until then."
      onOpenChange={(open) => !open && close()}
      confirmLabel="Check and replace"
      confirmDisabled={azure ? !first.trim() && !second.trim() : !first.trim() || !second.trim()}
      onConfirm={async () => {
        setError(null);
        try {
          await rotate(
            azure
              ? first.trim()
                ? { accountKey: first }
                : { sasToken: second }
              : { accessKeyId: first, secretAccessKey: second },
          );
        } catch (reason) {
          setError(errorText(reason));
          throw reason;
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <Field label={azure ? "Account key" : "Access key ID"} orientation="vertical">
          <Input
            type={azure ? "password" : "text"}
            autoComplete="off"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </Field>
        <Field label={azure ? "Or a SAS token" : "Secret"} orientation="vertical">
          <Input
            type="password"
            autoComplete="off"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A new shared drive.
// ---------------------------------------------------------------------------

export function NewDriveDialog({ close, made }: { close: () => void; made: (id: string) => void }) {
  const refresh = useRefresh();
  const [name, setName] = useState("");
  return (
    <Dialog
      open
      title="New shared drive"
      description="A drive you share with a team: its members open everything in it."
      onOpenChange={(open) => !open && close()}
      confirmLabel="Create"
      confirmDisabled={!name.trim()}
      onConfirm={async () => {
        try {
          const drive = await driveApi.createDrive(name.trim());
          await refresh();
          toast.success(`Created “${name.trim()}”`);
          made(drive.id);
        } catch (error) {
          toast.error(errorText(error));
          throw error;
        }
      }}
    >
      <Field label="Name" orientation="vertical">
        <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Agents: the CLI, and your API keys.
// ---------------------------------------------------------------------------

const COMMANDS = [
  {
    title: "Install the CLI",
    description: "Node.js 24 or newer.",
    command: "npm install --global otterdrive",
  },
  {
    title: "Sign in",
    description: "Approves the computer in the browser.",
    command: "otterdrive auth login --url https://drive.otterware.app",
  },
  {
    title: "Teach your agent",
    description: "The otterdrive skill, for Codex, Claude Code and others.",
    command: "npx skills@latest add otterware-app/otter-drive --skill otterdrive",
  },
];

function CopyField({ value, done }: { value: string; done: string }) {
  return (
    <div className="mt-2 mb-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 ps-2.5 pe-1">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground select-all">
        {value}
      </code>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => copy(value, done)}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <CopyIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function AgentsSection() {
  const qc = useQueryClient();
  const keys = useQuery({
    queryKey: ["otter-drive", "api-keys"],
    queryFn: driveApi.apiKeys,
    retry: false,
  });
  const [name, setName] = useState("Agent");
  const [created, setCreated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string | null } | null>(null);
  const create = async () => {
    setCreating(true);
    try {
      setCreated((await driveApi.createApiKey(name)).key);
      await qc.invalidateQueries({ queryKey: ["otter-drive", "api-keys"] });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setCreating(false);
    }
  };
  return (
    <>
      <SettingsSection
        title="Agents"
        description="Agents publish and edit documents with the otterdrive CLI, signed in as you or with an API key."
      >
        {COMMANDS.map((c) => (
          <SettingsRow key={c.title} title={c.title} description={c.description}>
            <CopyField value={c.command} done="Command copied" />
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection
        title="API keys"
        description="For an agent that runs on its own: give it a key through the environment (OTTERDRIVE_TOKEN), never in a prompt."
      >
        <SettingsRow
          title="New key"
          description="It can read, upload and edit documents you can access."
          control={
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <TextInput
                aria-label="Key name"
                className="w-40"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
              <Btn size="sm" type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create key"}
              </Btn>
            </form>
          }
        >
          {created ? (
            <>
              <p className="mt-2 text-[13px] text-amber-600 dark:text-amber-400">
                Copy it now: it won't be shown again.
              </p>
              <CopyField value={created} done="Key copied" />
            </>
          ) : null}
        </SettingsRow>
        {keys.error ? (
          <SettingsRow title="Couldn't load your keys" description={errorText(keys.error)} />
        ) : !keys.data ? (
          <SettingsRow title="Loading…" />
        ) : (
          keys.data.map((k) => (
            <SettingsRow
              key={k.id}
              title={
                <span className="flex items-center gap-2">
                  <KeyRoundIcon className="size-4 text-muted-foreground" />
                  {k.name ?? "Unnamed key"}
                </span>
              }
              description={
                <>
                  <code className="font-mono">{k.start ?? "otw_"}…</code> · created{" "}
                  {when(k.createdAt)}
                </>
              }
              control={
                <Btn size="sm" variant="ghost" onClick={() => setRevoking(k)}>
                  Revoke
                </Btn>
              }
            />
          ))
        )}
      </SettingsSection>
      {revoking ? (
        <Dialog
          open
          title={`Revoke ${revoking.name ?? "this key"}?`}
          description="Agents using it stop working at once."
          onOpenChange={(open) => !open && setRevoking(null)}
          confirmLabel="Revoke"
          confirmVariant="destructive"
          onConfirm={async () => {
            try {
              await driveApi.revokeApiKey(revoking.id);
            } catch (error) {
              toast.error(errorText(error));
              throw error;
            }
            await qc.invalidateQueries({ queryKey: ["otter-drive", "api-keys"] });
            toast.success(`Revoked ${revoking.name ?? "the key"}`);
          }}
        />
      ) : null}
    </>
  );
}
