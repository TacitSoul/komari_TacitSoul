/** These dialogs are mounted without a Radix Trigger, so remember their actual opener. */
export function createDialogFocusHandlers() {
  let opener: HTMLElement | null = null;
  return {
    onOpenAutoFocus() {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Leave Radix's default autofocus and focus trap in place.
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault();
      if (opener?.isConnected) opener.focus();
    },
  };
}
