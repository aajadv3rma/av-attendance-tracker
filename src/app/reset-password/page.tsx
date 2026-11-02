"use client";

import { useRouter } from "next/navigation";
import AuthScreen from "@/components/workspace/AuthScreen";

export default function ResetPasswordPage() {
  const router = useRouter();
  return <AuthScreen initialMode="reset" onAuthenticated={() => router.push("/workspace")} />;
}
