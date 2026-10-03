import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ClientHoverDetailsProps {
  clientName: string;
  accountant: string;
  contact: string;
  email: string;
  isLocked?: boolean;
  lockIcon?: React.ReactNode;
}

const ClientHoverDetails: React.FC<ClientHoverDetailsProps> = ({
  clientName,
  accountant,
  contact,
  email,
  isLocked,
  lockIcon,
}) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleEnter = () => {
    clearTimeout(timeoutRef.current);
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      let top = rect.bottom + 4;
      let left = rect.left;
      
      // Flip if near bottom of viewport
      if (top + 120 > window.innerHeight) {
        top = rect.top - 120;
      }
      // Keep within right edge
      if (left + 260 > window.innerWidth) {
        left = window.innerWidth - 270;
      }
      setPos({ top, left });
    }
    setShow(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setShow(false), 150);
  };

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        tabIndex={0}
        className="cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {clientName}
        {lockIcon}
      </span>
      {show && createPortal(
        <div
          onMouseEnter={() => clearTimeout(timeoutRef.current)}
          onMouseLeave={handleLeave}
          className="fixed z-[9999] w-[260px] rounded-md border bg-popover p-2.5 text-popover-foreground shadow-md"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="font-medium text-muted-foreground">Accountant:</span>
              <span className="text-foreground text-right">{accountant}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-muted-foreground">Contact:</span>
              <span className="text-foreground text-right">{contact}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-muted-foreground">Email:</span>
              <span className="text-foreground text-right truncate max-w-[150px]">{email}</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default ClientHoverDetails;
