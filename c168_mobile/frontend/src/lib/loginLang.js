/** Same-tab language bus — mirrors desktop `eazycount:language-updated`. */
export const LANGUAGE_UPDATED_EVENT = "eazycount:language-updated";

export function readLoginLang() {
  try {
    return localStorage.getItem("login_lang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** Persist `login_lang` and notify same-tab listeners (e.g. bottom nav). */
export function writeLoginLang(lang) {
  const normalized = lang === "zh" ? "zh" : "en";
  try {
    localStorage.setItem("login_lang", normalized);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_UPDATED_EVENT, { detail: { lang: normalized } }),
    );
  } catch {
    /* ignore */
  }
  return normalized;
}
