import { describe, expect, test } from "bun:test";
import { validateGeofenceSettings } from "@/lib/validations/geofence";

// Vektor yang sama dengan `tests_geofence_validation` di `operational.rs`.
function message(
  enabled: boolean,
  latitude: number,
  longitude: number,
  radiusMeter: number,
) {
  return Object.values(
    validateGeofenceSettings({ enabled, latitude, longitude, radiusMeter }),
  )[0];
}

describe("validateGeofenceSettings", () => {
  test("mengikuti aturan Rust", () => {
    expect(message(true, -6.2, 106.8, 100)).toBeUndefined();
    expect(message(false, 0, 0, 100)).toBeUndefined();
    expect(message(true, 0, 0, 100)).toBe(
      "Tentukan koordinat kantor sebelum geofencing diaktifkan.",
    );
    expect(message(true, 91, 106.8, 100)).toBe(
      "Latitude harus berada antara -90 dan 90.",
    );
    expect(message(true, -6.2, 181, 100)).toBe(
      "Longitude harus berada antara -180 dan 180.",
    );
    for (const radius of [9, 10_001, 100.5, Number.NaN]) {
      expect(message(true, -6.2, 106.8, radius)).toBe(
        "Radius wajib berupa angka bulat antara 10-10.000 meter.",
      );
    }
    expect(message(true, Number.NaN, 106.8, 100)).toBe(
      "Latitude harus berada antara -90 dan 90.",
    );
  });
});
