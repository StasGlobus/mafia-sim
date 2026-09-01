"use client";

import { useParams } from "next/navigation";
import LiveGame from "@/components/LiveGame";

export default function GamePage() {
  const params = useParams();
  const code = decodeURIComponent(String(params.code ?? ""));
  return <LiveGame code={code} />;
}
