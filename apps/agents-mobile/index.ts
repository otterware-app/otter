import "@otter/mobile/polyfills";
// Core starts here, outside the screens, so an edit to what starts it reloads the app rather than
// hot-replacing the module and starting core a second time.
import "./src/core";
import "expo-router/entry";
