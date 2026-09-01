"use client";

import { useParams } from "next/navigation";
import AdminGame from "@/components/AdminGame";

export default function AdminGamePage() {
  const params = useParams();
  const code = decodeURIComponent(String(params.code ?? ""));
  return <AdminGame code={code} />;
}
