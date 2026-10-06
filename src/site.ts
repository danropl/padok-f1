// Dane właściciela serwisu. Wartości w nawiasach kwadratowych to miejsca do uzupełnienia
// prawdziwymi danymi przed publikacją; strona pokazuje je wyraźnie jako brakujące.
export const SITE = {
  name: "Padok",
  owner: "[NAZWA WŁAŚCICIELA LUB FIRMY]",
  address: "[ADRES]",
  nip: "[NIP, jeśli działalność gospodarcza]",
  email: "[ADRES E-MAIL DO KONTAKTU]",
  updated: "6 października 2026",
};

export const isPlaceholder = (v: string) => v.startsWith("[");
