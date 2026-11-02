import { cn } from "@otter-mail/web/extension-kit";

export function TodoistIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <rect width="24" height="24" rx="5" fill="#E44332" />
      <path
        d="m5 8.4 4.6 2.6L19 5.7M5 12.4l4.6 2.6 9.4-5.3M5 16.4 9.6 19l9.4-5.3"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
