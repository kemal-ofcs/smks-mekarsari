"use client";

import { requestWebApi } from "@/lib/client/api-client";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";
import type { AttendanceDashboardMetrics } from "@/lib/services/attendance-dashboard";

export type {
  AttendanceDashboardCategoryMetrics,
  AttendanceDashboardMetrics,
  AttendanceDashboardRombelItem,
  AttendanceDashboardTeacherItem,
} from "@/lib/services/attendance-dashboard";

export async function getAttendanceDashboardMetrics(params?: {
  tanggal?: string;
}): Promise<AttendanceDashboardMetrics> {
  if (isDesktopRuntime()) {
    return invokeDesktop<AttendanceDashboardMetrics>(
      "desktop_get_attendance_dashboard_metrics",
      { tanggal: params?.tanggal },
    );
  }

  const result = await requestWebApi<{ data: AttendanceDashboardMetrics }>(
    "/api/academic/dashboard/metrics/query",
    "POST",
    params ?? {},
  );
  return result.data;
}
