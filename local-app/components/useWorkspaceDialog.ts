import { RefObject, useEffect, useRef } from 'react';

const focusableSelector = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keyboard modal behavior without requiring native dialog support. */
export function useWorkspaceDialog(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  locked = false,
) {
  const lockedRef = useRef(locked);
  const onCloseRef = useRef(onClose);
  lockedRef.current = locked;
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    // Move focus before hiding the trigger's branch from assistive technology.
    (focusables()[0] || dialog).focus();
    const isolated: { element: Element; inert: string | null; ariaHidden: string | null }[] = [];
    let branch: Element = dialog;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || sibling.contains(dialog)) continue;
        isolated.push({
          element: sibling,
          inert: sibling.getAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        // Native inert blocks pointer/focus interaction where supported; the
        // keyboard/focus trap below remains the fallback in older browsers.
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (parent === document.body) break;
      branch = parent;
    }
    const frame = requestAnimationFrame(() => (focusables()[0] || dialog).focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lockedRef.current) onCloseRef.current();
      }
      if (event.key === 'Tab') {
        const list = focusables();
        const first = list[0] || dialog;
        const last = list[list.length - 1] || dialog;
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (focusables()[0] || dialog).focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      for (const { element, inert, ariaHidden } of isolated) {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      }
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('[data-workspace-focus-fallback]:not([disabled])')?.focus();
    };
  }, [ref, open]);
}
