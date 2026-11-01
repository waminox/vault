export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { currentSession, totpEnabled } from "@/lib/server/auth";
import { isInitialized } from "@/lib/server/keyring";
import { LoginScreen } from "@/components/LoginScreen";

export default async function LoginPage() {
  if (!isInitialized()) redirect("/setup");
  if (await currentSession()) redirect("/");
  return <LoginScreen totp={totpEnabled()} />;
}
