import { createFileRoute } from "@tanstack/react-router";
import { DawnApp } from "@/components/game/DawnApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <DawnApp />;
}
