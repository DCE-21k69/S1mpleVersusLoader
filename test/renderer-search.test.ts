import { describe, expect, it } from "vitest";
import type { ScannedAddon } from "../src/main/domain/types.js";

function filterAddons(addons: ScannedAddon[], query: string): ScannedAddon[] {
  const q = query.trim().toLowerCase();
  if (!q) return addons;
  return addons.filter((addon) => {
    const title = (addon.info?.title ?? "").toLowerCase();
    const author = (addon.info?.author ?? "").toLowerCase();
    const id = addon.id.toLowerCase();
    const desc = (addon.info?.description ?? "").toLowerCase();
    return title.includes(q) || author.includes(q) || id.includes(q) || desc.includes(q);
  });
}

function sortAddons(addons: ScannedAddon[], selected: Map<string, number>): ScannedAddon[] {
  return [...addons].sort((a, b) => {
    const aPriority = selected.get(a.id);
    const bPriority = selected.get(b.id);
    if (aPriority !== undefined && bPriority !== undefined) {
      return aPriority - bPriority;
    }
    if (aPriority !== undefined) return -1;
    if (bPriority !== undefined) return 1;

    const aName = a.info?.title ?? a.id;
    const bName = b.info?.title ?? b.id;
    return aName.localeCompare(bName);
  });
}

const PLACEHOLDER_COVER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="%2324242c"/><path d="M20 22h24a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V24a2 2 0 0 1 2-2zm2 4v16h20V26H22zm4 3h12v2H26v-2zm0 4h8v2h-8v-2z" fill="%23e05c2a" opacity="0.85"/></svg>';

function getCoverUrl(coverPath: string | null): string {
  if (!coverPath) return PLACEHOLDER_COVER;
  return `mod-cover://cover/?path=${encodeURIComponent(coverPath)}`;
}

describe("Renderer Search & Thumbnail Logic", () => {
  const mockAddons: ScannedAddon[] = [
    {
      id: "132036649",
      vpkPath: "/addons/132036649.vpk",
      coverPath: "/addons/132036649.jpg",
      info: { title: "Golden SPAS-12", author: "K1CHWA", description: "Hellsing shotgun" },
    },
    {
      id: "246810121",
      vpkPath: "/addons/246810121.vpk",
      coverPath: null,
      info: { title: "Zoey HD", author: "ValveFan", description: "High resolution model" },
    },
    {
      id: "333444555",
      vpkPath: "/addons/333444555.vpk",
      coverPath: "/addons/333444555.jpg",
      info: { title: "Desert Eagle Laser", author: "ModMaster", description: "Pistol replacement" },
    },
  ];

  it("filters addons by title (case-insensitive)", () => {
    const result = filterAddons(mockAddons, "gold");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("132036649");
  });

  it("filters addons by author", () => {
    const result = filterAddons(mockAddons, "K1CHWA");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("132036649");
  });

  it("filters addons by mod ID", () => {
    const result = filterAddons(mockAddons, "246810121");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("246810121");
  });

  it("filters addons by description", () => {
    const result = filterAddons(mockAddons, "pistol");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("333444555");
  });

  it("returns all addons when query is empty or whitespace", () => {
    expect(filterAddons(mockAddons, "")).toHaveLength(3);
    expect(filterAddons(mockAddons, "   ")).toHaveLength(3);
  });

  it("returns empty array when query matches nothing", () => {
    const result = filterAddons(mockAddons, "inexistente9999");
    expect(result).toHaveLength(0);
  });

  it("sorts active mods first by priority order, then alphabetically", () => {
    const selected = new Map<string, number>();
    selected.set("333444555", 1); // Desert Eagle (priority 1)
    selected.set("132036649", 2); // Golden SPAS-12 (priority 2)
    // Zoey is not selected

    const sorted = sortAddons(mockAddons, selected);
    expect(sorted.map((m) => m.id)).toEqual(["333444555", "132036649", "246810121"]);
  });

  it("generates mod-cover URL when coverPath exists", () => {
    const url = getCoverUrl("/addons/132036649.jpg");
    expect(url).toContain("mod-cover://cover/?path=");
    expect(url).toContain("132036649.jpg");
  });

  it("returns SVG placeholder when coverPath is null", () => {
    const url = getCoverUrl(null);
    expect(url).toBe(PLACEHOLDER_COVER);
    expect(url).toContain("data:image/svg+xml");
  });
});
