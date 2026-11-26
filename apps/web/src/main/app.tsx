import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router, queryClient } from "./router";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@otter/ui/components/tooltip";
import { ToastProvider } from "@otter/ui/components/toast";
import { ReportProblemDialog } from "./support/report-problem";
import { reactErrorHandlers, startErrorReports } from "./error-reports";

startErrorReports(router);

declare const __APP_DISPLAY_NAME__: string | undefined;

document.title = __APP_DISPLAY_NAME__ || document.title;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement, reactErrorHandlers);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <ReportProblemDialog />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.accept();
}
