/** Shared by the server layout (inline script) and the client theme hooks. No React here. */

export const THEME_STORAGE_KEY = "bahi-theme";
export const THEME_CHANGE_EVENT = "bahi-theme-change";

/** Runs in <head> before paint. Keep it tiny and dependency-free. */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');function a(){var s=localStorage.getItem('${THEME_STORAGE_KEY}');d.setAttribute('data-theme',s==='light'||s==='dark'?s:(m.matches?'dark':'light'))}a();m.addEventListener('change',a);window.addEventListener('${THEME_CHANGE_EVENT}',a)}catch(e){}})()`;
