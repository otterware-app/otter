import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  toast,
} from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, GlobeIcon, LockIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  driveApi,
  type AccessEntry,
  type DrivePerson,
  type ShareRole,
  type ShareTarget,
  type Sharing,
} from "./api";
import { errorText, useRefresh } from "./hooks";

const BASE = "https://drive.otterware.app";

type Request = ShareTarget & {
  name: string;
  url?: string;
};

const listeners = new Set<(request: Request) => void>();
export function share(request: Request): void {
  for (const listener of listeners) listener(request);
}

export function ShareDialogHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    listeners.add(setRequest);
    return () => void listeners.delete(setRequest);
  }, []);
  return request ? (
    <ShareDialog
      key={`${request.type}:${request.id}`}
      request={request}
      close={() => setRequest(null)}
    />
  ) : null;
}

const ROLE_LABEL: Record<ShareRole | "owner", string> = {
  viewer: "Viewer",
  editor: "Editor",
  owner: "Owner",
};

const ROLES: ShareRole[] = ["viewer", "editor"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => void toast.success("Link copied"),
    () => void toast.error("Couldn't copy it."),
  );

const names = (people: string[]) =>
  people.length <= 2
    ? people.join(" and ")
    : `${people.slice(0, 2).join(", ")} and ${people.length - 2} more`;

function ShareDialog({ request, close }: { request: Request; close: () => void }) {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const target: ShareTarget = {
    type: request.type,
    id: request.id,
    ...(request.folderId ? { folderId: request.folderId } : {}),
  };
  const queryKey = ["otter-drive", "sharing", request.type, request.id];
  const sharing = useQuery({
    queryKey,
    queryFn: () => driveApi.sharing(target),
    retry: false,
  });
  const me = useQuery({
    queryKey: ["otter-drive", "me"],
    queryFn: driveApi.me,
    staleTime: Infinity,
  });
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const typed = EMAIL.test(draft.trim()) ? draft.trim().toLowerCase() : null;
  const adding = typed && !emails.includes(typed) ? [...emails, typed] : emails;
  const [role, setRole] = useState<ShareRole>("editor");
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const data = sharing.data;
  const isDrive = data?.resource.folderKind === "shared";
  const isMyDrive = data?.resource.folderKind === "personal";
  const you = (person: DrivePerson) => Boolean(me.data && person.userId === me.data.userId);

  const change = async <T extends { data: Sharing } | null>(
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await action();
      if (result) qc.setQueryData(queryKey, result.data);
      void refresh();
      return result;
    } catch (error) {
      toast.error(errorText(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    data?.link?.url ??
    request.url ??
    (request.type === "folder" ? `${BASE}/home?folder=${encodeURIComponent(request.id)}` : BASE);

  const send = async () => {
    if (!adding.length || !data) return;
    const added = adding;
    const result = await change(() =>
      driveApi.sharePeople(target, {
        emails: added,
        role,
        notify,
        ...(message.trim() ? { message: message.trim() } : {}),
      }),
    );
    if (!result) throw new Error("not shared");
    setEmails([]);
    setDraft("");
    setMessage("");
    if (isDrive) toast.success(`Added ${names(added)} to ${data.resource.name}`);
    else if (result.notified) toast.success(`Shared with ${names(added)}`);
    else
      toast.success(`Shared with ${names(added)}`, {
        description: notify
          ? "They weren't emailed, so send them the link."
          : "Send them the link to open it.",
        action: { label: "Copy link", onClick: () => void copy(link()) },
      });
  };

  const remove = async (entry: AccessEntry) => {
    if (you(entry)) {
      const left = await change(() => driveApi.setShareRole(target, entry.id, null));
      if (left === undefined) return;
      toast.success(`Removed “${request.name}” from Shared with me`);
      close();
      return;
    }
    await change(() => driveApi.setShareRole(target, entry.id, null));
  };

  return (
    <Dialog
      open
      size="large"
      title={isDrive ? `Manage members of “${request.name}”` : `Share “${request.name}”`}
      description={
        isDrive
          ? "Members can open everything in this shared drive. Editors also add and change it."
          : isMyDrive
            ? "My Drive is yours alone. Share the folders and documents in it instead."
            : data && !data.canShare
              ? "You can see who has access. Ask an editor to share it with more people."
              : request.type === "folder"
                ? "People get access to the folder and everything in it."
                : "People get access to this document."
      }
      onOpenChange={(open) => !open && !busy && close()}
      confirmLabel={adding.length ? (isDrive ? "Add" : notify ? "Send" : "Share") : "Done"}
      confirmDisabled={busy}
      onConfirm={adding.length ? send : close}
      secondaryAction={
        data && !isMyDrive ? { label: "Copy link", onClick: () => copy(link()) } : undefined
      }
    >
      <div className="flex max-h-[min(60vh,32rem)] min-h-0 flex-col gap-5 overflow-y-auto">
        {data?.canShare ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <PeopleInput
                emails={emails}
                onEmailsChange={setEmails}
                text={draft}
                onTextChange={setDraft}
                exclude={[data.owner.email, ...data.people.map((e) => e.email)]}
                disabled={busy}
                onSubmit={() => void send().catch(() => {})}
              />
              <RoleMenu value={role} onChange={(next) => next && setRole(next)} disabled={busy} />
            </div>
            {adding.length && !isDrive ? (
              <div className="flex flex-col gap-2">
                <label className="flex w-fit items-center gap-2 text-[13px] text-foreground select-none">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="size-3.5"
                  />
                  Notify people
                </label>
                {notify ? (
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Message"
                    rows={2}
                    maxLength={1000}
                    aria-label="Message"
                    className="w-full resize-none rounded-lg border border-border bg-transparent px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <section aria-label="People with access">
          <h3 className="mb-1.5 text-sm font-medium text-foreground">
            {isDrive ? "Members" : "People with access"}
          </h3>
          {sharing.error ? (
            <p className="py-3 text-sm text-destructive-foreground">{errorText(sharing.error)}</p>
          ) : !data ? (
            <div className="flex flex-col gap-3 py-1.5" aria-hidden>
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-8 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="-mx-2 flex flex-col">
              <PersonRow
                person={data.owner}
                you={you(data.owner)}
                trailing={<span className="pe-2 text-[13px] text-muted-foreground">Owner</span>}
              />
              {!isDrive && data.drive.kind === "shared" ? (
                <li className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UsersIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">
                      Members of {data.drive.name}
                    </div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      {data.drive.memberCount} {data.drive.memberCount === 1 ? "person" : "people"}
                    </div>
                  </div>
                  <span className="pe-2 text-[13px] text-muted-foreground">Shared drive</span>
                </li>
              ) : null}
              {data.people.map((entry) => {
                const self = you(entry);
                const editable = !entry.inheritedFrom && (data.canShare || (self && !isDrive));
                return (
                  <PersonRow
                    key={entry.id}
                    person={entry}
                    you={self}
                    note={
                      entry.inheritedFrom
                        ? `Access from “${entry.inheritedFrom.name}”`
                        : entry.viaLink
                          ? "Opened the link"
                          : entry.userId
                            ? null
                            : "Hasn't signed in yet"
                    }
                    trailing={
                      editable ? (
                        <RoleMenu
                          value={entry.role}
                          disabled={busy}
                          roles={data.canShare ? undefined : []}
                          removeLabel={self ? "Remove my access" : "Remove access"}
                          onChange={(next) =>
                            void (next
                              ? next !== entry.role &&
                                change(() => driveApi.setShareRole(target, entry.id, next))
                              : remove(entry))
                          }
                          ghost
                        />
                      ) : (
                        <span className="pe-2 text-[13px] text-muted-foreground">
                          {ROLE_LABEL[entry.role]}
                        </span>
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>

        {data && !isDrive && !isMyDrive ? (
          <section aria-label="General access">
            <h3 className="mb-1.5 text-sm font-medium text-foreground">General access</h3>
            <GeneralAccess
              sharing={data}
              busy={busy}
              onChange={(next) => void change(() => driveApi.setShareLink(target, next))}
            />
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

export function Avatar({ person, className }: { person: DrivePerson; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (person.name || person.email).trim().charAt(0).toUpperCase();
  return person.image && !failed ? (
    <img
      src={person.image}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("size-8 shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}

function PersonRow({
  person,
  you,
  note,
  trailing,
}: {
  person: DrivePerson;
  you: boolean;
  note?: string | null;
  trailing: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <Avatar person={person} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          {person.name || person.email}
          {you ? <span className="text-muted-foreground"> (you)</span> : null}
        </div>
        <div className="truncate text-[13px] text-muted-foreground">
          {person.name ? person.email : null}
          {person.name && note ? " · " : null}
          {note}
        </div>
      </div>
      {trailing}
    </li>
  );
}

function RoleMenu({
  value,
  onChange,
  disabled,
  ghost = false,
  roles = ROLES,
  removeLabel,
}: {
  value: ShareRole;
  /** null removes. */
  onChange: (role: ShareRole | null) => void;
  disabled?: boolean;
  ghost?: boolean;
  roles?: ShareRole[];
  removeLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60 data-[state=open]:bg-accent",
            ghost ? "hover:bg-accent" : "border border-border hover:bg-accent",
          )}
        >
          {ROLE_LABEL[value]}
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {roles.map((role) => (
          <DropdownMenuItem
            key={role}
            icon={role === value ? <CheckIcon /> : <span className="size-4" />}
            onSelect={() => onChange(role)}
            className="h-auto py-1.5"
          >
            <span className="block">{ROLE_LABEL[role]}</span>
            <span className="block text-xs text-muted-foreground">
              {role === "viewer"
                ? "Opens and downloads"
                : "Also edits, uploads versions and shares"}
            </span>
          </DropdownMenuItem>
        ))}
        {removeLabel ? (
          <>
            {roles.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              color="red"
              icon={<span className="size-4" />}
              onSelect={() => onChange(null)}
            >
              {removeLabel}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GeneralAccess({
  sharing,
  busy,
  onChange,
}: {
  sharing: Sharing;
  busy: boolean;
  onChange: (role: ShareRole | null) => void;
}) {
  const link = sharing.link;
  const where =
    sharing.drive.kind === "shared"
      ? `members of ${sharing.drive.name} and the people added`
      : "the people added";
  const label = link ? "Anyone with the link" : "Restricted";
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            link
              ? "bg-green-500/12 text-green-600 dark:text-green-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {link ? <GlobeIcon className="size-4" /> : <LockIcon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          {sharing.canShare ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={busy}>
                <button
                  type="button"
                  className="-ms-1.5 flex h-6 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-accent"
                >
                  {label}
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64">
                <DropdownMenuItem
                  icon={<LockIcon />}
                  onSelect={() => link && onChange(null)}
                  className="h-auto py-1.5"
                >
                  <span className="block">Restricted</span>
                  <span className="block text-xs text-muted-foreground">
                    Only people with access can open it
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<GlobeIcon />}
                  onSelect={() => !link && onChange("viewer")}
                  className="h-auto py-1.5"
                >
                  <span className="block">Anyone with the link</span>
                  <span className="block text-xs text-muted-foreground">
                    Anyone with the link can view it, no sign-in needed
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="text-sm font-medium text-foreground">{label}</div>
          )}
          <div className="text-[13px] text-muted-foreground">
            {link
              ? link.role === "editor"
                ? "Anyone with the link can view; people who sign in with it can edit"
                : "Anyone on the internet with the link can view"
              : `Only ${where} can open it`}
          </div>
        </div>
        {link ? (
          sharing.canShare ? (
            <RoleMenu
              value={link.role}
              disabled={busy}
              onChange={(next) => next && next !== link.role && onChange(next)}
              ghost
            />
          ) : (
            <span className="pe-2 text-[13px] text-muted-foreground">{ROLE_LABEL[link.role]}</span>
          )
        ) : null}
      </div>
      {sharing.inheritedLink ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <UsersIcon className="size-3.5 shrink-0" />
          Anyone with the link to “{sharing.inheritedLink.folderName}” can also{" "}
          {sharing.inheritedLink.role === "editor" ? "edit" : "view"} it.
        </p>
      ) : null}
    </div>
  );
}

function PeopleInput({
  emails,
  onEmailsChange,
  text,
  onTextChange: setText,
  exclude,
  disabled,
  onSubmit,
}: {
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  text: string;
  onTextChange: (text: string) => void;
  exclude: string[];
  disabled: boolean;
  onSubmit: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const query = text.trim().toLowerCase();
  const people = useQuery({
    queryKey: ["otter-drive", "people", query],
    queryFn: () => driveApi.people(query),
    enabled: focused && query !== "",
    staleTime: 60_000,
    retry: false,
  });
  const taken = new Set([...exclude, ...emails].map((e) => e.toLowerCase()));
  const suggestions = (people.data ?? [])
    .filter((p) => !taken.has(p.email.toLowerCase()))
    .slice(0, 5);
  const showSuggestions = focused && query !== "" && suggestions.length > 0;
  const active = Math.min(highlight, suggestions.length - 1);

  useEffect(() => inputRef.current?.focus(), []);
  const clearing = Boolean(text || showSuggestions);
  useEffect(() => {
    if (!clearing) return;
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || document.activeElement !== inputRef.current) return;
      e.stopPropagation();
      setText("");
      setFocused(false);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [clearing, setText]);

  const add = (values: string[]) => {
    const next = [...emails];
    const rejected: string[] = [];
    for (const raw of values) {
      const email = raw.trim().replace(/^<|>$/g, "").toLowerCase();
      if (!email) continue;
      if (!EMAIL.test(email)) rejected.push(raw.trim());
      else if (!next.includes(email)) next.push(email);
    }
    onEmailsChange(next);
    setInvalid(rejected.length ? `“${rejected[0]}” isn't an email address` : null);
    setText(rejected.join(" "));
    setHighlight(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setHighlight((active + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions) add([suggestions[active]!.email]);
      else if (text.trim()) add([text]);
      else if (emails.length) onSubmit();
    } else if ((e.key === "," || e.key === " ") && text.trim()) {
      e.preventDefault();
      add([text]);
    } else if (e.key === "Backspace" && !text && emails.length) {
      onEmailsChange(emails.slice(0, -1));
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        className={cn(
          "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-border px-1.5 py-0.5",
          focused && "ring-2 ring-focus-ring",
          invalid && "border-destructive",
        )}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="flex h-6 max-w-full items-center gap-1 rounded-full bg-muted ps-2 pe-1 text-[13px] text-foreground"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              aria-label={`Remove ${email}`}
              disabled={disabled}
              onClick={() => onEmailsChange(emails.filter((x) => x !== email))}
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          placeholder={emails.length ? "" : "Add people by email"}
          aria-label="Add people by email"
          aria-invalid={invalid ? true : undefined}
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls={listId}
          aria-activedescendant={showSuggestions ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(null);
            setHighlight(0);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[\s,;]/.test(pasted.trim())) {
              e.preventDefault();
              add(pasted.split(/[\s,;]+/));
            }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim() && EMAIL.test(text.trim())) add([text]);
          }}
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {invalid ? (
        <p role="alert" className="mt-1 text-xs text-destructive-foreground">
          {invalid}
        </p>
      ) : null}
      {showSuggestions ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-[calc(100%+4px)] z-10 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          {suggestions.map((person, i) => (
            <li
              key={person.email}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setHighlight(i)}
              onClick={() => add([person.email])}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5",
                i === active && "bg-accent",
              )}
            >
              <Avatar person={person} className="size-6 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {person.name || person.email}
                </span>
                {person.name ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.email}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
