import { useRef, useState, type DragEvent } from "react";
import { AccountPicture } from "../mail/account-picture";
import type { AliasMailboxEntry } from "../mail/alias-mailboxes";
import { useUpdateAccount } from "../mail/hooks";
import { toast } from "@otter/ui/components/toast";
import type { MailAccount } from "../mail/types";
import { PictureError, mailboxPicture } from "./mailbox-picture-image";
import { searchableSetting } from "./settings-search";
import { Button } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import { SettingsRow } from "@otter/ui/components/settings";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/** With `alias`, an alias mailbox's (`account` is its look), kept with its parent. */
export function MailboxPictureRow({
  account,
  alias,
}: {
  account: MailAccount;
  alias?: AliasMailboxEntry;
}) {
  const updateAccount = useUpdateAccount();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dropping, setDropping] = useState(false);

  const save = (picture: string) =>
    updateAccount
      .mutateAsync(
        alias
          ? { accountId: alias.parent.id, aliasPicture: { address: alias.id, picture } }
          : { accountId: account.id, customPicture: picture },
      )
      .catch((err: unknown) => {
        toast.error("Couldn't save the picture", {
          description: err instanceof Error ? err.message : String(err),
        });
      });

  const use = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      await save(await mailboxPicture(file));
    } catch (err) {
      toast.error("Couldn't use that picture", {
        description:
          err instanceof PictureError
            ? err.message
            : "Couldn't read it. Choose a PNG, JPEG or WebP.",
      });
    } finally {
      setReading(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("mailbox-picture")}
      description={`Shown in the sidebar and wherever this mailbox appears, instead of its ${account.picture ? "profile picture" : "initial"}. Only used in Otter.`}
      className={cn("transition-colors", dropping && "bg-accent-surface")}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        void use(event.dataTransfer.files[0]);
      }}
      control={
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            aria-label={`Picture for ${account.email}`}
            onChange={(event) => {
              void use(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <AccountPicture account={account} className="size-8 rounded-lg text-xs" />
          <Button size="sm" disabled={reading} onClick={() => input.current?.click()}>
            {account.customPicture ? "Change…" : "Choose…"}
          </Button>
          {account.customPicture ? (
            <Button size="sm" disabled={reading} onClick={() => void save("")}>
              Remove
            </Button>
          ) : null}
        </>
      }
    />
  );
}
