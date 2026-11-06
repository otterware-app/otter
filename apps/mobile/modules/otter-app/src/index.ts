import { requireNativeModule } from "expo";

/** The app's CFBundleShortVersionString and CFBundleVersion, as the release built them. */
export const app = requireNativeModule<{ version: string; build: string }>("OtterApp");
