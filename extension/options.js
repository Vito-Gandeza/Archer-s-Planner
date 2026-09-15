const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.sync.get(["appUrl", "syncToken", "lastSync", "lastResult", "lastError"]);
  $("appUrl").value = s.appUrl ?? "";
  $("syncToken").value = s.syncToken ?? "";
  $("status").innerHTML = [
    s.lastSync ? `Last sync: <b>${new Date(s.lastSync).toLocaleString()}</b>` : "Never synced yet.",
    s.lastResult ? `Pulled ${s.lastResult}.` : "",
    s.lastError ? `Last error: ${s.lastError}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
}

$("save").addEventListener("click", async () => {
  const appUrl = $("appUrl").value.trim().replace(/\/+$/, "");
  const syncToken = $("syncToken").value.trim();
  if (!/^https?:\/\//.test(appUrl)) return alert("Planner URL must start with http:// or https://");
  if (!syncToken.startsWith("csp_")) return alert("That does not look like a sync token.");
  await chrome.storage.sync.set({ appUrl, syncToken });
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save"), 1500);
});

render();
