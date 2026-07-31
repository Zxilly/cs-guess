const CONFIGURED_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

// Hidden traffic policy: Chinese-primary browsers keep using the configured
// API origin, while every other browser uses the site's same-origin CDN route.
const DIRECT_API_LANGUAGE = "zh-CN";

function normalizedPrimaryLanguage(languageTags: readonly string[]) {
  return languageTags[0]?.trim().toLowerCase() ?? "";
}

export function prefersDirectApi(languageTags: readonly string[]) {
  const primaryLanguage = normalizedPrimaryLanguage(languageTags);
  return (
    primaryLanguage === "zh" ||
    primaryLanguage === DIRECT_API_LANGUAGE.toLowerCase() ||
    primaryLanguage.startsWith("zh-")
  );
}

export function shouldUseSameOriginApi(languageTags: readonly string[]) {
  return languageTags.length > 0 && !prefersDirectApi(languageTags);
}

export function apiBaseForLanguages(
  languageTags: readonly string[],
  configuredApiBase = CONFIGURED_API_BASE,
) {
  return shouldUseSameOriginApi(languageTags)
    ? ""
    : configuredApiBase.replace(/\/$/, "");
}

function browserAcceptedLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

const acceptedLanguages = browserAcceptedLanguages();
export const USE_SAME_ORIGIN_API = shouldUseSameOriginApi(acceptedLanguages);
export const API_BASE = apiBaseForLanguages(acceptedLanguages);

interface SocketRoutingOptions {
  apiBase: string;
  pageOrigin: string;
  useSameOriginApi: boolean;
}

export function socketUrlForRouting(
  socketIoUrl: string,
  { apiBase, pageOrigin, useSameOriginApi }: SocketRoutingOptions,
) {
  const fallbackBase = apiBase || pageOrigin;
  const resolved = new URL(socketIoUrl || "/socket.io", fallbackBase);

  if (!useSameOriginApi) return resolved;

  return new URL(
    `${resolved.pathname}${resolved.search}${resolved.hash}`,
    pageOrigin,
  );
}

export function resolveApiSocketUrl(
  socketIoUrl: string,
  pageOrigin = window.location.origin,
) {
  return socketUrlForRouting(socketIoUrl, {
    apiBase: API_BASE,
    pageOrigin,
    useSameOriginApi: USE_SAME_ORIGIN_API,
  });
}
