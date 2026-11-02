import { useEffect, useState } from "react";
import {
  OTTER_ACCOUNT_STATE_CHANNEL,
  type OtterAccountState,
  type OtterDevice,
} from "@otter-mail/contracts";

const invoke = <T>(channel: string, params?: unknown) =>
  window.desktopBridge.invoke<T>(channel, params);

export const otterApi = {
  getState: () => invoke<OtterAccountState>("otter:getState"),
  signIn: () => invoke<OtterAccountState | null>("otter:signIn"),
  cancelSignIn: () => invoke<void>("otter:cancelSignIn"),
  signOut: () => invoke<OtterAccountState>("otter:signOut"),
  listDevices: () => invoke<OtterDevice[]>("otter:listDevices"),
  signOutDevice: (token: string) => invoke<void>("otter:signOutDevice", { token }),
  deleteAccount: () => invoke<OtterAccountState>("otter:deleteAccount"),
};

export function useOtterAccount(): OtterAccountState | null {
  const [state, setState] = useState<OtterAccountState | null>(null);
  useEffect(() => {
    let alive = true;
    void otterApi.getState().then((next) => {
      if (alive) setState(next);
    });
    const off = window.desktopBridge.on(OTTER_ACCOUNT_STATE_CHANNEL, (next) =>
      setState(next as OtterAccountState),
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
