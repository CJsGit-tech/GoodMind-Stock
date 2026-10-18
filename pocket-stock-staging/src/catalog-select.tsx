import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './catalog-controls.css';

type Option = { value: string; label: string };
export function CatalogSelect({ label, value, options, onChange, triggerRef, disabled = false }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; triggerRef?: import('react').RefObject<HTMLButtonElement | null>;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const typed = useRef({ text: '', at: 0 });
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  function choose(index: number) { onChange(options[index].value); close(true); }
  function expand(index = selected) { setActive(index); setOpen(true); }
  useLayoutEffect(() => {
    const node = popup.current, button = trigger.current;
    if (!node || !button || !open) return;
    function place() {
      if (!node || !button) return;
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upward = below < Math.min(options.length * 44 + 12, 220) && above > below;
      node.style.width = Math.min(rect.width, window.innerWidth - 24) + 'px';
      node.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12)) + 'px';
      node.style.maxHeight = Math.max(44, Math.min(300, upward ? above : below)) + 'px';
      node.style.top = upward ? 'auto' : rect.bottom + 6 + 'px';
      node.style.bottom = upward ? window.innerHeight - rect.top + 6 + 'px' : 'auto';
    }
    place();
    node.showPopover();
    const scrolled = (event: Event) => { if (!node.contains(event.target as Node)) place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      if (node.matches(':popover-open')) node.hidePopover();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [open, options.length]);
  useLayoutEffect(() => { if (open) popup.current?.querySelectorAll('[role=option]')[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  return <>
    <button ref={node => { trigger.current = node; if (triggerRef) triggerRef.current = node; }} type='button' disabled={disabled} className='catalog-select-trigger' role='combobox'
      data-value={value} aria-label={label} aria-haspopup='listbox' aria-expanded={open} aria-controls={id}
      aria-activedescendant={open ? id + '-' + active : undefined}
      onClick={() => open ? close() : expand()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Tab') { close(); return; }
        if (event.key === 'Escape') { if (open) { event.preventDefault(); close(true); } return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) choose(active); else expand(); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) expand(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : selected);
          else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
          return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLocaleLowerCase(), at: now };
          const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(typed.current.text));
          if (index >= 0) { event.preventDefault(); expand(index); }
        }
      }}>
      <span>{options[selected]?.label}</span><ChevronDown size={15} aria-hidden='true' />
    </button>
    <div ref={popup} id={id} popover='auto' role='listbox' aria-label={label} className='catalog-select-popup'
      onToggle={event => { if (event.newState === 'closed') setOpen(false); }}>
      {options.map((option, index) => <div key={option.value} id={id + '-' + index} role='option'
        data-value={option.value} aria-selected={value === option.value} className={'catalog-select-option' + (index === active ? ' is-active' : '')}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{value === option.value && <Check size={16} aria-hidden='true' />}
      </div>)}
    </div>
  </>;
}
