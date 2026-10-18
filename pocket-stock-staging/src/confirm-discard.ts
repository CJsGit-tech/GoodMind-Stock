let pending = false;

// One shared confirmation for imperative navigation and editor actions.
export function confirmDiscard(message: string): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  pending = true;
  return new Promise(resolve => {
    const trigger = document.activeElement;
    const root = document.getElementById('root');
    const wasInert = root?.inert || false;
    const previousOverflow = document.body.style.overflow;
    const backdrop = document.createElement('div');
    backdrop.className = 'confirmation-backdrop admin-view admin-book-list-view';
    const dialog = document.createElement('section');
    dialog.className = 'confirmation-dialog publication-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'discard-title');
    dialog.setAttribute('aria-describedby', 'discard-description');
    const title = document.createElement('h2');
    title.id = 'discard-title'; title.textContent = '放棄尚未儲存的變更？';
    const description = document.createElement('p');
    description.id = 'discard-description'; description.textContent = message;
    const actions = document.createElement('div'); actions.className = 'confirmation-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '繼續編輯';
    const proceed = document.createElement('button'); proceed.type = 'button'; proceed.textContent = '放棄變更並繼續';
    function close(approved: boolean) {
      backdrop.remove(); document.removeEventListener('keydown', keydown, true);
      if (root) root.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      pending = false;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      resolve(approved);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(false); }
      if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancel ? proceed : cancel).focus();
      }
    }
    cancel.addEventListener('click', () => close(false));
    proceed.addEventListener('click', () => close(true));
    actions.append(cancel, proceed); dialog.append(title, description, actions); backdrop.append(dialog);
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden'; document.body.append(backdrop);
    document.addEventListener('keydown', keydown, true); cancel.focus();
  });
}
