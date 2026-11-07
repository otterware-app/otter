import "react-native-nitro-modules";
import { registerRootComponent } from "expo";

import App from "./src/App";
import { startErrorReports } from "./src/error-reports";

try {
  startErrorReports();
} catch (error) {
  console.error("Error reports didn't start", error);
}

registerRootComponent(App);
