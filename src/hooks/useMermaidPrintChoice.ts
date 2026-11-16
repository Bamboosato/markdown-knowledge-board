import { useEffect, useRef, useState } from "react";

// null means canceled; false/true select diagrams/source for this print only.
export function useMermaidPrintChoice() {
  const [isOpen, setIsOpen] = useState(false);
  const pending = useRef<((choice: boolean | null) => void) | null>(null);

  useEffect(() => () => {
    pending.current?.(null);
    pending.current = null;
  }, []);

  const choose = () => new Promise<boolean | null>((resolve) => {
    pending.current?.(null);
    pending.current = resolve;
    setIsOpen(true);
  });

  const finish = (choice: boolean | null) => {
    const resolve = pending.current;
    pending.current = null;
    setIsOpen(false);
    resolve?.(choice);
  };

  return { isOpen, choose, finish };
}
