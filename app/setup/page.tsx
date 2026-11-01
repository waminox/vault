export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { isInitialized } from "@/lib/server/keyring";
import { SetupScreen } from "@/components/SetupScreen";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (isInitialized()) redirect("/login");
  const { token } = await searchParams;
  return <SetupScreen token={token ?? ""} />;
}
