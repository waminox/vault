export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { currentSession } from "@/lib/server/auth";
import { isInitialized } from "@/lib/server/keyring";
import { Vault } from "@/components/Vault";

export default async function Home() {
  if (!isInitialized()) redirect("/setup");
  if (!(await currentSession())) redirect("/login");
  return <Vault />;
}
