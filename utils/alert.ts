/**
 * showAlert — the app's single entry point for confirmations and notices.
 *
 * Rendering is delegated to <DialogProvider> (components/ui/AppDialog), which
 * draws a themed in-app dialog. That exists because Alert.alert renders nothing
 * whatsoever on react-native-web — a confirm-then-act flow written with it is a
 * dead button in the browser — and because the Android system dialog ignores
 * the app's own styling.
 *
 * The signature deliberately mirrors Alert.alert so call sites read the same.
 */
import { Alert, type AlertButton } from "react-native";

type Handler = (req: { title: string; message?: string; buttons: AlertButton[] }) => void;

let handler: Handler | null = null;

/** Called by <DialogProvider> on mount. Not for use by screens. */
export function registerDialogHandler(fn: Handler) {
  handler = fn;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const list = buttons?.length ? buttons : [{ text: "OK" } as AlertButton];

  if (handler) {
    handler({ title, message, buttons: list });
    return;
  }

  // No provider mounted yet. Falling back to Alert.alert keeps native builds
  // working; on web it is a no-op, so log as well rather than losing the
  // message silently.
  if (__DEV__) console.warn(`[showAlert] no DialogProvider mounted: ${title}`);
  Alert.alert(title, message, list);
}
