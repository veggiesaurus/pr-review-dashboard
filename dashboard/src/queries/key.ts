const STORE = "prg:key";

// The link carries the key once; it is kept for this origin, taken out of the address bar and sent with every call.
function take() {
  const url = new URL(location.href);
  const fromLink = url.searchParams.get("t") ?? url.searchParams.get("g");
  if (fromLink) {
    url.searchParams.delete("t");
    url.searchParams.delete("g");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  try {
    if (fromLink) {
      localStorage.setItem(STORE, fromLink);
    }
    return fromLink ?? localStorage.getItem(STORE) ?? "";
  } catch {
    return fromLink ?? "";
  }
}

export const pageKey = take();
