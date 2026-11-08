'use client';
import { useEffect, useRef } from 'react';
export function ContentDialog({content,onClose}:{content:{title:string;body:string[]};onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const opener=document.activeElement as HTMLElement;ref.current?.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;opener?.focus();};},[]);
 return <dialog ref={ref} className="content-dialog" onCancel={onClose} aria-labelledby="content-title" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="dialog-content"><button className="close-button" onClick={onClose} aria-label="Close article">×</button><span className="eyebrow">THE VEDĀ JOURNAL & NOTES</span><h2 id="content-title">{content.title}</h2>{content.body.map(p=><p key={p}>{p}</p>)}<button className="text-link" onClick={onClose}>Back to exploring <span>↗</span></button></div></dialog>
}
