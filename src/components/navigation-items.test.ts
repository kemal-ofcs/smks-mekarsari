import { describe, expect, test } from "bun:test";
import {
  BOTTOM_BAR_HREFS,
  groupNavigation,
  NAVIGATION,
  NAVIGATION_GROUPS,
  type NavigationItem,
} from "./navigation-items";

describe("pengelompokan menu sidebar", () => {
  test("setiap halaman berada di tepat satu kelompok", () => {
    const grouped = NAVIGATION_GROUPS.flatMap((group) => group.hrefs);
    expect([...grouped].sort()).toEqual(
      NAVIGATION.map((item) => item.href).sort(),
    );
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  test("tombol bilah bawah menunjuk halaman yang ada", () => {
    const hrefs = new Set(NAVIGATION.map((item) => item.href));
    for (const href of BOTTOM_BAR_HREFS) expect(hrefs.has(href)).toBe(true);
  });

  test("kelompok tanpa isi tidak dikembalikan", () => {
    const scannerOnly = NAVIGATION.filter((item) => item.href === "/scanner");
    expect(groupNavigation(scannerOnly).map((group) => group.label)).toEqual([
      "Utama",
    ]);
  });

  test("halaman yang belum dikelompokkan tetap tampil di Lainnya", () => {
    const stray: NavigationItem = {
      area: "diagnostics",
      href: "/halaman-baru",
      icon: "tools",
      label: "Halaman Baru",
    };
    const groups = groupNavigation([...NAVIGATION, stray]);
    expect(groups.at(-1)).toEqual({
      label: "Lainnya",
      pinned: false,
      items: [stray],
    });
  });
});
