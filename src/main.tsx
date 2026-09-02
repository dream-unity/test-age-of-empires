import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DawnApp } from "@/components/game/DawnApp";
import { installPreviewHostBridge } from "@/lib/preview-host-bridge";
import "./styles.css";

function Root() {
  useEffect(() => {
    return installPreviewHostBridge({
      navigate: () => undefined,
      getRoutePaths: () => ["/"],
    });
  }, []);
  return <DawnApp />;
}

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root");
createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
