import { useSyncExternalStore } from "react";

// Padok nie używa analityki ani pikseli reklamowych. Jedyna opcjonalna rzecz to mapy torów z OpenStreetMap,
// które łączą przeglądarkę z zewnętrznym serwerem (adres IP). Wybór trzymamy w localStorage, nie w ciasteczku.
export interface Consent {
  maps: boolean;
  decidedAt: string;
}

const KEY = "padok.consent.v1";
const listeners = new Set<() => void>();
let current: Consent | null = read();

function read(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Consent) : null;
  } catch {
    return null;
  }
}

export function setConsent(maps: boolean) {
  current = { maps, decidedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Prywatny tryb przeglądarki: wybór obowiązuje do zamknięcia karty.
  }
  listeners.forEach((l) => l());
}

export function reopenConsent() {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* jw. */
  }
  listeners.forEach((l) => l());
}

export function useConsent() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
