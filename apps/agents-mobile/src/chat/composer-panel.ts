import { createContext } from "react";

export const ComposerPanelContext = createContext({
  open: false,
  setOpen: (_open: boolean) => {},
  setHeight: (_height: number) => {},
});
