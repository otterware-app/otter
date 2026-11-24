import { useEffect, useState } from "react";
import {
  OTTER_ACCOUNT_STATE_CHANNEL,
  type OtterAccountState,
  type OtterDevice,
} from "@otter/contracts";

import { ipc, listen } from "./bridge.ts";

export const otterApi = {
  getState: () => ipc<OtterAccountState>("otter:getState"),
  signIn: () => ipc<OtterAccountState | null>("otter:signIn"),
  cancelSignIn: () => ipc<void>("otter:cancelSignIn"),
  signOut: () => ipc<OtterAccountState>("otter:signOut"),
  listDevices: () => ipc<OtterDevice[]>("otter:listDevices"),
  signOutDevice: (token: string) => ipc<void>("otter:signOutDevice", { token }),
  deleteAccount: () => ipc<OtterAccountState>("otter:deleteAccount"),
};

/** The Otter account core is signed in to, kept current; null until core says. */
export function useOtterAccount(): OtterAccountState | null {
  const [state, setState] = useState<OtterAccountState | null>(null);
  useEffect(() => {
    let alive = true;
    void otterApi.getState().then((next) => {
      if (alive) setState(next);
    });
    const off = listen(OTTER_ACCOUNT_STATE_CHANNEL, (next) => setState(next as OtterAccountState));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
