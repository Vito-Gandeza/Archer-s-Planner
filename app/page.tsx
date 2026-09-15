"use client";

import { useEffect } from "react";
import Dashboard from "@/components/Dashboard";

export default function Page() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // In dev the SW would serve stale chunks after every rebuild, so keep it to
    // production builds and tear down any registration left over from one.
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    }
  }, []);
  return <Dashboard />;
}
