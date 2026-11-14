"use client";

import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { JamKosongWorkspace } from "@/components/kepegawaian/JamKosongWorkspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { canAccessArea } from "@/lib/auth/access";
import { useAuth } from "@/lib/context/AuthContext";

export default function JamKosongPage() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (!isLoading && isAuthenticated && !canAccessArea(user, "jam_kosong")) {
    redirect("/forbidden");
  }

  return (
    <AppShell contentClassName="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <PageHeader
        eyebrow="Akademik"
        title="Jam Kosong"
        description="Jam pelajaran guru yang cuti atau izin, dan siapa yang menggantikannya."
      />
      {isAuthenticated ? <JamKosongWorkspace /> : null}
    </AppShell>
  );
}
