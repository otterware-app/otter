import { requireNativeModule } from "expo";

type AccountModule = {
  storeEnvironment(): Promise<string>;
  authorize(url: string, scheme: string): Promise<string | null>;
};

const native = requireNativeModule<AccountModule>("OtterAccount");

/** Where this build came from: StoreKit's AppTransaction environment ("Production", "Sandbox" for TestFlight, "Xcode"), or "unknown". */
export const storeEnvironment = () => native.storeEnvironment();

/** A browser sheet on `url` until it returns to `scheme://`: that URL, or null when cancelled. */
export const authorize = (url: string, scheme: string) => native.authorize(url, scheme);
