/*
 * Finding the school's Wilma by town or name. Same ranking as the WilmAI CLI's
 * school search (packages/wilma-cli/src/tenant-search.ts), kept here so the
 * app doesn't pull the CLI's Node-only code into the window:
 * a city's own Wilma first ("helsinki" → helsinki.inschool.fi), then an exact
 * town, then prefixes, then substrings; letter-by-letter matches only when
 * nothing else matches. Within a rank, the town's own school Wilma comes
 * before private schools, institutes and colleges.
 */
import tenantList from "@wilma-client/tenant_list.json";

export interface Tenant {
  url: string;
  name: string;
  municipalities: { name_fi: string; name_sv: string }[];
}

/** The development server: two test schools, answered in memory, for trying several Wilmas by hand (demo/test-wilma.ts). */
const TEST_TENANTS: Tenant[] = [
  { url: "https://pohjoinen.wilmai.test", name: "Testikoulu Pohjoinen (testi)", municipalities: [{ name_fi: "Testi", name_sv: "Test" }] },
  { url: "https://etela.wilmai.test", name: "Testikoulu Etelä (testi)", municipalities: [{ name_fi: "Testi", name_sv: "Test" }] },
];

export const TENANTS = [...(tenantList as { wilmat: Tenant[] }).wilmat, ...(typeof __TEST_WILMAS__ !== "undefined" && __TEST_WILMAS__ ? TEST_TENANTS : [])];

function towns(t: Tenant): string[] {
  return t.municipalities.flatMap((m) => [m.name_fi, m.name_sv]).filter(Boolean).map((s) => s.toLowerCase());
}

function fuzzy(target: string, needle: string): boolean {
  if (target.includes(needle)) return true;
  let i = 0;
  for (const ch of target) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  return false;
}

/** 0 = the town's own Wilma, 1 = exact town, 2 = prefix, 3 = substring, 4 = letter by letter, null = no match. */
function rank(t: Tenant, needle: string): number | null {
  const host = t.url.replace(/^https?:\/\//, "").toLowerCase();
  const subdomain = host.split(".")[0] ?? "";
  const name = t.name.toLowerCase();
  const places = towns(t);
  const fields = [name, subdomain, ...places];
  if (subdomain === needle || name === needle) return 0;
  if (places.includes(needle)) return 1;
  if (fields.some((f) => f.startsWith(needle))) return 2;
  if (fields.some((f) => f.includes(needle)) || host.includes(needle)) return 3;
  if (fields.some((f) => fuzzy(f, needle))) return 4;
  return null;
}

// "Kuntayhtymä" (a joint authority, usually a vocational college) is not the town's own school Wilma.
const municipal = (t: Tenant) => (/kaupun|kunta(?!yhtym)|kunnan|perusopetus|opetustoimi|sivistys/i.test(t.name) ? 0 : 1);

export function searchTenants(query: string, limit = 8): Tenant[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const ranked = TENANTS.map((t) => ({ t, r: rank(t, needle) })).filter((e): e is { t: Tenant; r: number } => e.r !== null);
  const real = ranked.some((e) => e.r < 4);
  return ranked
    .filter((e) => !real || e.r < 4)
    .sort((a, b) => a.r - b.r || municipal(a.t) - municipal(b.t) || a.t.name.localeCompare(b.t.name, "fi"))
    .slice(0, limit)
    .map((e) => e.t);
}
