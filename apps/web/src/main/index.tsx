import "../styles.css";

if (!window.desktopBridge) {
  const { webBridge, requireOtterAccount } = await import("../web/bridge");
  window.desktopBridge = webBridge;
  document.documentElement.dataset.platform = "web";
  try {
    await requireOtterAccount();
  } catch (err) {
    // Signing in needs the relay; without it there is nothing to show yet.
    const reason = err instanceof Error ? err.message : String(err);
    const main = document.createElement("main");
    main.style.cssText =
      "font:14px system-ui;display:grid;place-items:center;height:100vh;text-align:center;color:#71717a";
    main.innerHTML = `<div><p style="font-size:18px">Couldn't sign you in to Otter.</p>
      <p>Try again in a moment: <a href="" style="color:inherit">reload</a>.</p>
      <p style="font-size:12px;opacity:.7"></p></div>`;
    main.querySelector("p:last-child")!.textContent = reason;
    document.body.replaceChildren(main);
    throw err;
  }
  const { loadSyncedPreferences } = await import("./synced-preferences");
  await loadSyncedPreferences(true).catch((err) =>
    console.warn("Couldn't load UI preferences", err),
  );
}

document.documentElement.dataset.windowControls =
  window.desktopBridge.features.windowControls ?? "none";
window.desktopBridge.on("window:fullScreen", (fullScreen: unknown) => {
  document.documentElement.toggleAttribute("data-full-screen", fullScreen === true);
});

await import("./app");
