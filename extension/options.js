const CANVAS_ORIGIN = "https://dlsu.instructure.com";
const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.sync.get(["appUrl", "syncToken", "lastSync", "lastResult", "lastError"]);
  $("appUrl").value = s.appUrl ?? "";
  $("syncToken").value = s.syncToken ?? "";
  $("status").innerHTML = [
    s.lastSync ? `Last sync: <b>${new Date(s.lastSync).toLocaleString()}</b>` : "Never synced yet.",
    s.lastResult ? `Pulled ${s.lastResult}.` : "",
    s.lastError ? `<span class="bad">Last error:</span> ${s.lastError}` : "",
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

/**
 * Checks each hop separately so a failure says which one broke: the Canvas
 * session, the Canvas course list, or the planner endpoint. Extension pages
 * may call Canvas cross-origin because the manifest holds its host permission.
 */
async function probe(label, url, init) {
  try {
    const res = await fetch(url, { credentials: "include", ...init });
    const text = await res.text();
    return { label, status: res.status, ok: res.ok, body: text.slice(0, 400) };
  } catch (e) {
    return { label, status: 0, ok: false, body: `request failed: ${e.message}` };
  }
}

$("test").addEventListener("click", async () => {
  const { appUrl, syncToken } = await chrome.storage.sync.get(["appUrl", "syncToken"]);
  $("test").disabled = true;
  $("report").hidden = false;
  $("report").textContent = "Testing…";

  const checks = [
    await probe("Canvas session (who am I)", `${CANVAS_ORIGIN}/api/v1/users/self`, {
      headers: { Accept: "application/json+canvas-string-ids" },
    }),
    await probe("Canvas course list", `${CANVAS_ORIGIN}/api/v1/courses?enrollment_state=active&per_page=5&include[]=teachers`, {
      headers: { Accept: "application/json+canvas-string-ids" },
    }),
  ];

  if (appUrl && syncToken) {
    checks.push(
      // An empty payload is a valid sync: it proves the URL and token without writing anything.
      await probe("Planner /api/sync", new URL("/api/sync", appUrl).toString(), {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: `Bearer ${syncToken}` },
        body: JSON.stringify({ courses: [], deadlines: [], files: [] }),
      }),
    );
  } else {
    checks.push({ label: "Planner /api/sync", status: 0, ok: false, body: "Save a planner URL and token first." });
  }

  $("report").textContent = checks
    .map((c) => `${c.ok ? "OK  " : "FAIL"}  ${c.label}  [${c.status}]\n      ${c.body.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n\n");
  $("test").disabled = false;
  render();
});

render();
