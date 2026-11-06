import "react-native-nitro-modules";
import { registerRootComponent } from "expo";

import App from "./src/App";
import { startErrorReports } from "./src/error-reports";

startErrorReports();

registerRootComponent(App);
