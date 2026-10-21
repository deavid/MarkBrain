/**
 * Clipboard write with a fallback.
 *
 * `navigator.clipboard` only exists in a secure context, and this app is
 * routinely opened over plain http on a LAN address (or from a phone on the
 * same network), where the async API is simply absent. A chat message that
 * cannot be copied there is a broken button, so fall back to the legacy
 * selection route before reporting failure.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or transient failure — try the legacy route.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
