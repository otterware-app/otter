import { createContext } from "react";

/**
 * The panel under the composer's ＋, between the chat screen, which holds the keyboard, and the
 * footer, which draws the panel: it takes the keyboard's place, as tall, so the keyboard passes
 * over it and nothing moves (Composer.swift).
 */
export type ComposerPanel = {
  open: boolean;
  /** The keyboard's height when it was last up: the panel draws that tall from under the composer. */
  height: number;
  /** Open, or close to nothing. To close to the keyboard, focus the composer: the panel goes once the keyboard is over it. */
  setOpen: (open: boolean) => void;
};

export const ComposerPanelContext = createContext<ComposerPanel>({
  open: false,
  height: 336,
  setOpen: () => {},
});
