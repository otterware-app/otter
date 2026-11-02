import {
  createBrowserHistory,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { HomeView } from "./home-view";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "~/components/ui/error-boundary-view";
import type { SettingsPane } from "./mail/api";
import { SEARCH_MAILBOX } from "./mail/gmail-query";
import { isWorkspaceSegment, workspaceSpace } from "./extensions/workspaces";
import { CALENDAR_SPACE, CHATS_SPACE } from "./mail/spaces";

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootView,
  errorComponent: ErrorBoundaryView,
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="drag-region fixed top-0 left-0 right-0 h-(--workspace-topbar-height)" />
        <p className="text-[13px] text-muted-foreground">Route not found</p>
      </div>
    );
  },
});

/**
 * Mail and Settings share one layout (HomeView), which reads where it is from
 * the route below it; those routes render nothing themselves, so moving
 * between them never remounts the list or the reader (Otter Code's `_chat`).
 */
const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "mail",
  component: HomeView,
});

const indexRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "/",
  component: () => null,
});

const SETTINGS_PANES = new Set<string>([
  "general",
  "appearance",
  "keybindings",
  "accounts",
  "calendar",
  "agents",
  "browser",
  "integrations",
  "features",
  "otter",
]);

export type SettingsSearch = { target?: string };

const settingsRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "settings/$pane",
  params: {
    parse: ({ pane }) => ({
      pane: SETTINGS_PANES.has(pane) ? (pane as SettingsPane) : "general",
    }),
    stringify: ({ pane }) => ({ pane }),
  },
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    target: typeof search.target === "string" ? search.target : undefined,
  }),
  component: () => null,
});

const composeRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "compose",
  component: () => null,
});

const settingsItemRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "settings/$pane/$item",
  params: {
    parse: ({ pane, item }) => ({
      pane: SETTINGS_PANES.has(pane) ? (pane as SettingsPane) : "general",
      item,
    }),
    stringify: ({ pane, item }) => ({ pane, item }),
  },
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    target: typeof search.target === "string" ? search.target : undefined,
  }),
  component: () => null,
});

const SPACE_SEGMENTS: Record<string, string> = { chats: CHATS_SPACE, calendar: CALENDAR_SPACE };
const toMailbox = (segment: string) =>
  SPACE_SEGMENTS[segment] ?? (isWorkspaceSegment(segment) ? workspaceSpace(segment) : segment);
const fromMailbox = (id: string) => /^__([a-z]+)__$/.exec(id)?.[1] ?? id;
const toLabel = (segment: string) => (segment === "search" ? SEARCH_MAILBOX : segment);
const fromLabel = (id: string) => /^__([a-z]+)__$/.exec(id)?.[1] ?? id;
type MailParams = { mailbox: string; label: string };
const parseMail = (params: MailParams): MailParams => {
  return { mailbox: toMailbox(params.mailbox), label: toLabel(params.label) };
};
const stringifyMail = (params: MailParams): MailParams => ({
  mailbox: fromMailbox(params.mailbox),
  label: fromLabel(params.label),
});

const labelRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "$mailbox/$label",
  params: { parse: parseMail, stringify: stringifyMail },
  component: () => null,
});

export type MessageSearch = { account?: string; message?: string };

const messageRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "$mailbox/$label/$messageId",
  params: {
    parse: ({ messageId, ...params }) => ({ ...parseMail(params), messageId }),
    stringify: ({ messageId, ...params }) => ({ ...stringifyMail(params), messageId }),
  },
  validateSearch: (search: Record<string, unknown>): MessageSearch => ({
    account: typeof search.account === "string" ? search.account : undefined,
    message: typeof search.message === "string" ? search.message : undefined,
  }),
  component: () => null,
});

/** mail.otterware.app/app, the app's address before it moved to /. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "app",
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});

const routeTree = rootRoute.addChildren([
  mailRoute.addChildren([
    indexRoute,
    composeRoute,
    settingsRoute,
    settingsItemRoute,
    labelRoute,
    messageRoute,
  ]),
  appRoute,
]);

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  // The Mac app's pages are files (ottermail://app/index.html), so it keeps
  // the route in the hash; the web app's are real paths, which the site
  // Worker answers with the app.
  history: window.desktopBridge.platform === "web" ? createBrowserHistory() : createHashHistory(),
  pathParamsAllowedCharacters: ["@"],
  // The query holds only strings (ids, addresses): plainly, where the default
  // would quote the ids that look like numbers.
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const entries = Object.entries(search).filter(([, value]) => value !== undefined);
    const query = new URLSearchParams(entries).toString().replaceAll("%40", "@");
    return query ? `?${query}` : "";
  },
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { router, queryClient };
