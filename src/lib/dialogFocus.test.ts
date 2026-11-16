import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDialogFocusHandlers } from './dialogFocus';

class FocusTarget {
  isConnected = true;
  focus = vi.fn();
}

afterEach(() => vi.unstubAllGlobals());

describe('dialog focus restoration without a Radix Trigger', () => {
  it('captures the opener without cancelling Radix autofocus and restores it on close', () => {
    const opener = new FocusTarget();
    const document = { activeElement: opener };
    vi.stubGlobal('HTMLElement', FocusTarget);
    vi.stubGlobal('document', document);
    const handlers = createDialogFocusHandlers();
    handlers.onOpenAutoFocus();
    document.activeElement = new FocusTarget();
    const closeEvent = new Event('closeAutoFocus', { cancelable: true });
    handlers.onCloseAutoFocus(closeEvent);
    expect(closeEvent.defaultPrevented).toBe(true);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(document.activeElement.focus).not.toHaveBeenCalled();
  });

  it('does not focus an opener that has been removed', () => {
    const opener = new FocusTarget();
    vi.stubGlobal('HTMLElement', FocusTarget);
    vi.stubGlobal('document', { activeElement: opener });
    const handlers = createDialogFocusHandlers();
    handlers.onOpenAutoFocus();
    opener.isConnected = false;
    handlers.onCloseAutoFocus(new Event('closeAutoFocus'));
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('tolerates a missing active element', () => {
    vi.stubGlobal('HTMLElement', FocusTarget);
    vi.stubGlobal('document', { activeElement: null });
    const handlers = createDialogFocusHandlers();
    handlers.onOpenAutoFocus();
    expect(() => handlers.onCloseAutoFocus(new Event('closeAutoFocus'))).not.toThrow();
  });
});
