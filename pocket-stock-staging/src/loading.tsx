import { useEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode } from 'react';

export function LoadingBlock({ className = '' }: { className?: string }) {
  return <span className={'loading-block ' + className} aria-hidden='true' />;
}

export function PendingIndicator({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={'loading-pending ' + className} role='status' aria-live='polite'>
    <LoadingBlock className='loading-pending-bar' />
    <span>{children}</span>
  </span>;
}

type SkeletonKind = 'catalog' | 'article' | 'preview' | 'list' | 'comments' | 'form';
export function LoadingSkeleton({ label, kind = 'list', rows, metrics = 3, media = true, className = '' }: {
  label: string; kind?: SkeletonKind; rows?: number; metrics?: number; media?: boolean; className?: string;
}) {
  const count = rows ?? (kind === 'catalog' ? 4 : 3);
  return <div className={'loading-surface loading-surface--' + kind + ' ' + className}
    role='status' aria-label={label} aria-busy='true'>
    <span className='sr-only'>{label}</span>
    <div className='loading-content' aria-hidden='true'>
      {kind === 'article' ? <>
        <div className='loading-article-heading'>
          <div><LoadingBlock className='loading-meta' /><LoadingBlock className='loading-headline' />
            <LoadingBlock className='loading-title' /><LoadingBlock /><LoadingBlock className='loading-short' /></div>
          <LoadingBlock className='loading-article-cover' />
        </div>
        <div className='loading-tabs'><LoadingBlock /><LoadingBlock /><LoadingBlock /></div>
        <div className='loading-metrics' style={{ gridTemplateColumns: 'repeat(' + metrics + ', minmax(0, 1fr))' }}>{Array.from({ length: metrics }, (_, index) =>
          <div key={index}><LoadingBlock className='loading-meta' /><LoadingBlock className='loading-value' /></div>)}</div>
        <div className='loading-paragraphs'>{Array.from({ length: count }, (_, index) =>
          <div key={index}><LoadingBlock className='loading-title' /><LoadingBlock /><LoadingBlock /><LoadingBlock className='loading-short' /></div>)}</div>
      </> : kind === 'preview' ? <>
        <LoadingBlock className='loading-headline' />
        <div className='loading-preview-layout'>
          <div><div className='loading-preview-summary'><LoadingBlock className='loading-preview-cover' />
            <div className='loading-row-copy'><LoadingBlock className='loading-title' /><LoadingBlock /><LoadingBlock /><LoadingBlock className='loading-short' /></div></div>
            <div className='loading-preview-thumbnails'>{Array.from({ length: 4 }, (_, index) => <LoadingBlock key={index} />)}</div>
            <LoadingBlock className='loading-preview-stage' /></div>
          <div className='loading-row-copy'><LoadingBlock className='loading-title' />{Array.from({ length: 5 }, (_, index) => <LoadingBlock key={index} className='loading-form-control' />)}</div>
        </div>
      </> : kind === 'catalog' ?
        <div className='book-grid published-book-grid'>{Array.from({ length: count }, (_, index) =>
          <div className='article-card article-card--landscape etf-analysis-card content-skeleton' key={index}>
            <LoadingBlock className='article-thumb' /><div className='article-meta'><LoadingBlock className='loading-meta' /></div>
            <h3><LoadingBlock className='loading-title' /></h3><p><LoadingBlock /><LoadingBlock /><LoadingBlock className='loading-short' /></p>
          </div>)}</div> :
        Array.from({ length: count }, (_, index) => <div className='loading-row' key={index}>
          {kind === 'list' && media && <LoadingBlock className='loading-row-media' />}
          <div className='loading-row-copy'><LoadingBlock className='loading-title' />
            <LoadingBlock /><LoadingBlock className='loading-short' />
            {kind === 'form' && <LoadingBlock className='loading-form-control' />}</div>
        </div>)}
    </div>
  </div>;
}

/** Keep media geometry and show the same shimmer while cached or remote images settle. */
export function ShimmerImage({ className = '', frameClassName = '', style, onLoad, onError, ...props }:
  ImgHTMLAttributes<HTMLImageElement> & { frameClassName?: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [settledSource, setSettledSource] = useState<string | undefined>();
  const source = typeof props.src === 'string' ? props.src : '';
  const pending = !!source && settledSource !== source;
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0) setSettledSource(source);
  }, [source]);
  const ratio = props.width && props.height ? String(props.width) + ' / ' + String(props.height) : undefined;
  return <span className={'loading-image ' + frameClassName} aria-busy={pending}
    style={{ aspectRatio: ratio } as CSSProperties}>
    {pending && <LoadingBlock className='loading-image-placeholder' />}
    <img {...props} ref={image} className={className} style={{ ...style, opacity: pending ? 0 : style?.opacity }}
      onLoad={event => { setSettledSource(source); onLoad?.(event); }}
      onError={event => { setSettledSource(source); onError?.(event); }} />
  </span>;
}
