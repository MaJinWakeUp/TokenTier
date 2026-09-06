"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icon";

// A dialog that traps Tab, closes on Escape, and returns focus to whatever
// opened it. Every modal in the app goes through here so focus restoration is
// never re-implemented per feature.
export function Modal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  maxWidth = "640px",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  titleId: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(".modal-close-btn");
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <button aria-label="Close modal overlay" className="modal-backdrop-dismiss" onClick={onClose} type="button" />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="detail-modal"
        ref={modalRef}
        role="dialog"
        style={{ maxWidth }}
      >
        <header className="detail-modal-header">
          <div className="detail-modal-title-wrap">
            {title}
          </div>
          <button aria-label="Close modal" className="modal-close-btn" onClick={onClose} type="button">
            <Icon name="close" size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default Modal;
