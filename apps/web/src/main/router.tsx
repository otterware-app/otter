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
import {
  fromLabel,
  fromSpace,
  isSpaceId,
  placeHref,
  searchString,
  toLabel,
  toSpace,
  type MessageSearch,
} from "./places";
import { firstLabelOf } from "./mail/spaces";

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
 * between them never remounts the list or the reader (T3 Code's `_chat`).
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

const validateMessageSearch = (search: Record<string, unknown>): MessageSearch => ({
  account: typeof search.account === "string" ? search.account : undefined,
  message: typeof search.message === "string" ? search.message : undefined,
});

const labelRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "mail/$mailbox/$label",
  params: {
    parse: ({ mailbox, label }) => ({ mailbox, label: toLabel(label) }),
    stringify: ({ mailbox, label }) => ({ mailbox, label: fromLabel(label) }),
  },
  component: () => null,
});

const messageRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "mail/$mailbox/$label/$messageId",
  params: {
    parse: ({ mailbox, label, messageId }) => ({ mailbox, label: toLabel(label), messageId }),
    stringify: ({ mailbox, label, messageId }) => ({
      mailbox,
      label: fromLabel(label),
      messageId,
    }),
  },
  validateSearch: validateMessageSearch,
  component: () => null,
});

/** Sends an address from before the /mail prefix, or /chats, to where it is now. */
const toCurrentPlace = (
  { mailbox, label, messageId }: { mailbox: string; label: string; messageId?: string },
  location: { pathname: string; searchStr: string },
) => {
  if (isSpaceId(mailbox) && location.pathname.split("/")[1] === fromSpace(mailbox)) return;
  throw redirect({
    href: placeHref(mailbox, label, messageId) + location.searchStr,
    replace: true,
  });
};

/** A mode on its own (/agents, /calendar, /drive) opens where it starts; /mail, its first mailbox. */
const modeRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "$space",
  beforeLoad: ({ params }) => {
    const id = toSpace(params.space);
    // No mailbox named: the app opens its first one in place of "-".
    const mail = params.space === "mail" ? placeHref("-", "INBOX") : "/";
    throw redirect({ href: isSpaceId(id) ? placeHref(id, firstLabelOf(id)) : mail, replace: true });
  },
});

const spaceRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "$space/$label",
  params: {
    parse: ({ space, label }) => ({ space, mailbox: toSpace(space), label: toLabel(label) }),
    stringify: ({ space, label }) => ({ space, label: fromLabel(label) }),
  },
  beforeLoad: ({ params, location }) => toCurrentPlace(params, location),
  component: () => null,
});

const spaceItemRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: "$space/$label/$messageId",
  params: {
    parse: ({ space, label, messageId }) => ({
      space,
      mailbox: toSpace(space),
      label: toLabel(label),
      messageId,
    }),
    stringify: ({ space, label, messageId }) => ({ space, label: fromLabel(label), messageId }),
  },
  validateSearch: validateMessageSearch,
  beforeLoad: ({ params, location }) => toCurrentPlace(params, location),
  component: () => null,
});

/** /app, the web app's address before it moved to /. */
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
    modeRoute,
    spaceRoute,
    spaceItemRoute,
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
  stringifySearch: (search) => searchString(search as Record<string, string | undefined>),
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
