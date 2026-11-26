import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import markup from "@/theon/markup.html?raw";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/theon/engine").then((mod) => {
      if (cancelled) return;
      stop = mod.startTheon();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return <div className="theon-root" dangerouslySetInnerHTML={{ __html: markup }} />;
}
