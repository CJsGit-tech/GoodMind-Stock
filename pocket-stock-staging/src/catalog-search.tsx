import { useRef, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import './catalog-controls.css';

/** A shared search field with optional separate draft and committed-search updates. */
export function CatalogSearch({ label, placeholder, value, onChange, onSearch,
  clearLabel = '清除搜尋文字', inputRef, describedBy, maxLength = 200 }: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void;
  onSearch?: (value: string) => void; clearLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>; describedBy?: string; maxLength?: number;
}) {
  const ownRef = useRef<HTMLInputElement>(null), composing = useRef(false);
  const input = inputRef || ownRef;
  return <form className='catalog-search library-search-form library-shelf-search' role='search' aria-label={label}
    onSubmit={event => { event.preventDefault(); if (!composing.current) (onSearch || onChange)(value); }}>
    <label className='search-field'>
      <Search size={18} aria-hidden='true' /><span className='sr-only'>{label}</span>
      <input ref={input} type='search' aria-label={label} aria-describedby={describedBy}
        placeholder={placeholder} value={value} maxLength={maxLength}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; onChange(event.currentTarget.value); onSearch?.(event.currentTarget.value); }}
        onChange={event => { onChange(event.target.value); if (!composing.current) onSearch?.(event.target.value); }}
        onKeyDown={event => { if ((composing.current || event.nativeEvent.isComposing) && event.key === 'Enter') event.preventDefault(); }} />
      {value && <button type='button' aria-label={clearLabel} onClick={() => { onChange(''); onSearch?.(''); input.current?.focus(); }}><X size={17} aria-hidden='true' /></button>}
    </label>
  </form>;
}
