import * as React from "react";

import { cn } from "~/lib/utils";

const VARIANTS = {
  large: "text-base leading-[22px] font-normal",
  "large-strong": "text-base leading-[22px] font-medium",
  regular: "text-sm leading-5 font-normal",
  strong: "text-sm leading-5 font-medium",
  small: "text-[13px] leading-[18px] font-normal",
  "small-strong": "text-[13px] leading-[18px] font-medium",
  mini: "text-2xs leading-[14px] font-normal",
  "mini-strong": "text-2xs leading-[14px] font-medium",
} as const;

const COLORS = {
  primary: "text-foreground",
  secondary: "text-muted-foreground",
  tertiary: "text-muted-foreground/75",
  inherit: "text-inherit",
  destructive: "text-destructive-foreground",
} as const;

type TextProps = Omit<React.ComponentProps<"span">, "color"> & {
  variant?: keyof typeof VARIANTS;
  color?: keyof typeof COLORS;
  truncate?: boolean;
  as?: "span" | "p" | "div" | "label" | "h1" | "h2" | "h3";
};

function Text({
  variant = "regular",
  color = "primary",
  truncate = false,
  as = "span",
  className,
  ...props
}: TextProps) {
  const Tag = as as "span";
  return (
    <Tag
      data-slot="text"
      className={cn(VARIANTS[variant], COLORS[color], truncate && "truncate", className)}
      {...props}
    />
  );
}

export { Text, type TextProps };
