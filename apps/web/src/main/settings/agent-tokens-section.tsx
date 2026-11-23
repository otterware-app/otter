import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentToken, AgentTokens } from "@otter/contracts/agent-tokens";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button, IconButton } from "@otter/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@otter/ui/components/dialog";
import { Field } from "@otter/ui/components/field";
import { Input } from "@otter/ui/components/input";
import { toast } from "@otter/ui/components/toast";
import { SettingsGroup, SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { timeAgo } from "./time-ago";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={label}
      size="icon-xs"
      className={className}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </IconButton>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-8 items-center gap-3 rounded-lg bg-input/40 pr-1 pl-3">
      <span className="w-24 shrink-0 text-body whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">{value}</code>
      <CopyButton value={value} label={`Copy: ${label}`} />
    </div>
  );
}

export function AgentTokensSection<T extends AgentToken>({
  id,
  title,
  description,
  queryKey,
  list,
  create,
  revoke,
  defaultName,
  newTokenFields,
  renderControl,
  commands,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  queryKey: string;
  list: () => Promise<AgentTokens<T>>;
  create: (name: string) => Promise<string>;
  revoke: (id: string) => Promise<void>;
  defaultName: string;
  newTokenFields?: ReactNode;
  renderControl?: (token: T) => ReactNode;
  commands?: { agent: string; text: (url: string, token: string) => string }[];
}) {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: [queryKey], queryFn: list });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(defaultName);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: [queryKey] });
  const remove = useMutation({
    mutationFn: revoke,
    onSuccess: refresh,
    onError: (err) => toast.error("Couldn't revoke the token", { description: errorText(err) }),
  });
  const url = tokens.data?.url ?? "";

  return (
    <SettingsSection
      id={id}
      title={title}
      description={description}
      variant="plain"
      headerAction={
        <Button
          size="sm"
          onClick={() => {
            setName(defaultName);
            setAdding(true);
          }}
        >
          Add agent…
        </Button>
      }
    >
      <SettingsGroup>
        {tokens.isError ? (
          <SettingsRow title="Couldn't load your agents" description={errorText(tokens.error)} />
        ) : tokens.data?.tokens.length === 0 ? (
          <SettingsRow title={<span className="text-muted-foreground">No agents yet</span>} />
        ) : (
          tokens.data?.tokens.map((token) => (
            <SettingsRow
              key={token.id}
              title={token.name}
              description={
                token.lastUsedAt ? `Last used ${timeAgo(token.lastUsedAt)}` : "Never used"
              }
              control={
                <>
                  {renderControl?.(token)}
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(token.id)}
                  >
                    Revoke
                  </Button>
                </>
              }
            />
          ))
        )}
      </SettingsGroup>
      {url ? (
        <p className="mt-2 flex items-center gap-1.5 px-[17px] text-xs text-muted-foreground">
          MCP server
          <code className="font-mono select-all">{url}</code>
          <CopyButton value={url} label="Copy the server's address" className="-my-1 size-5" />
        </p>
      ) : null}

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an agent"
        confirmLabel="Add"
        confirmDisabled={!name.trim()}
        onConfirm={async () => {
          const agentName = name.trim();
          const token = await create(agentName).catch((err: unknown) => {
            toast.error("Couldn't add the agent", { description: errorText(err) });
            throw err;
          });
          refresh();
          setCreated({ name: agentName, token });
        }}
      >
        <Field label="Name" orientation="vertical">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {newTokenFields}
      </Dialog>

      <Dialog
        open={created != null}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Connect {created?.name}</DialogTitle>
            <DialogDescription>Copy its token now: it won't be shown again.</DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="flex flex-col gap-2 px-6">
              {commands?.map((command) => (
                <CopyRow
                  key={command.agent}
                  label={command.agent}
                  value={command.text(url, created.token)}
                />
              ))}
              <CopyRow label="Server" value={url} />
              <CopyRow label="Token" value={created.token} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
