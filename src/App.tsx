import { useEffect, useState } from "react";
import { initialView, watchRuntime } from "./runtime/client";
import type { ClientView } from "./runtime/types";
import "./App.css";

export default function App() {
  const [runtime, setRuntime] = useState<ClientView>(initialView);
  useEffect(() => watchRuntime(setRuntime), []);
  return (
    <main>
      <h1>AhaKey Studio</h1>
      <p role="status">
        {runtime.status === "connected"
          ? `Runtime ${runtime.inspection?.runtimeVersion} 已连接`
          : (runtime.error?.message ?? "正在连接 Runtime…")}
      </p>
    </main>
  );
}
