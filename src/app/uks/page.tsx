"use client";

import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { UksWorkspace } from "@/components/uks/UksWorkspace";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";

export default function UksPage() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (!isLoading && isAuthenticated && !canAccessArea(user, "uks")) {
    redirect("/forbidden");
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="UKS"
          title="Buku Kunjungan UKS"
          description="Siapa yang datang ke UKS, keluhannya, obat yang diberikan, dan tindak lanjutnya."
        />
        {isAuthenticated ? <UksWorkspace /> : null}
      </div>
    </AppShell>
  );
}
