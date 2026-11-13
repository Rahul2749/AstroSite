'use client';

import { useEffect, useRef } from 'react';
import { translate, type Language } from '@/lib/language';

export function ContentDialog({ language, content, onClose }: {
  language: Language;
  content: { title: string; body: string[] };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = translate(language);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="content-dialog" onCancel={onClose} aria-labelledby="content-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <button className="close-button" onClick={onClose} aria-label={t('Close', 'बंद करें')}>×</button>
        <span className="eyebrow">{t('NOTES FROM VEDĀ', 'वेदा की ओर से')}</span>
        <h2 id="content-title">{content.title}</h2>
        {content.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <button className="text-link" onClick={onClose}>{t('Back to exploring', 'वापस जाएँ')} <span aria-hidden="true">↗</span></button>
      </div>
    </dialog>
  );
}
