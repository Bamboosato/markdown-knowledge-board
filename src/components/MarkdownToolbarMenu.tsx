import { useCallback, useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type MarkdownToolbarMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
};

type MarkdownToolbarMenuProps = {
  menuId: string;
  label: string;
  isOpen: boolean;
  items: MarkdownToolbarMenuItem[];
  onBeforeOpen: () => void;
  onOpenChange: (menuId: string, isOpen: boolean) => void;
  onSelect: (itemId: string) => void;
};

export function MarkdownToolbarMenu({
  menuId,
  label,
  isOpen,
  items,
  onBeforeOpen,
  onOpenChange,
  onSelect,
}: MarkdownToolbarMenuProps) {
  const generatedId = useId();
  const menuElementId = `markdown-menu-${menuId}-${generatedId}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusRef = useRef<"first" | "last">("first");

  const focusEnabledItem = useCallback(
    (preferredIndex: number, direction: 1 | -1) => {
      if (items.length === 0) {
        return;
      }

      for (let offset = 0; offset < items.length; offset += 1) {
        const index =
          (preferredIndex + direction * offset + items.length) % items.length;
        if (!items[index].disabled) {
          itemRefs.current[index]?.focus();
          return;
        }
      }
    },
    [items]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const targetIndex =
      initialFocusRef.current === "last" ? items.length - 1 : 0;
    focusEnabledItem(targetIndex, initialFocusRef.current === "last" ? -1 : 1);
    initialFocusRef.current = "first";

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(menuId, false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [focusEnabledItem, isOpen, items, menuId, onOpenChange]);

  const openMenu = (initialFocus: "first" | "last" = "first") => {
    initialFocusRef.current = initialFocus;
    onBeforeOpen();
    onOpenChange(menuId, true);
  };

  const closeAndRestoreTrigger = () => {
    onOpenChange(menuId, false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? "last" : "first");
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      onBeforeOpen();
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeAndRestoreTrigger();
    }
  };

  const handleItemKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreTrigger();
      return;
    }

    if (event.key === "Tab") {
      onOpenChange(menuId, false);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const targetIndex = event.key === "Home" ? 0 : items.length - 1;
      focusEnabledItem(targetIndex, event.key === "Home" ? 1 : -1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusEnabledItem(index + direction, direction);
    }
  };

  return (
    <div className="md-toolbar-menu" data-menu={menuId} ref={rootRef}>
      <button
        type="button"
        className="md-menu-trigger"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuElementId : undefined}
        aria-expanded={isOpen}
        onPointerDown={() => {
          if (!isOpen) {
            onBeforeOpen();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (isOpen) {
            onOpenChange(menuId, false);
          } else {
            openMenu();
          }
        }}
      >
        <span>{label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          id={menuElementId}
          className="md-menu-popover"
          role="menu"
          aria-label={label}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="md-menu-item"
              role="menuitem"
              disabled={item.disabled}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              onKeyDown={(event) => handleItemKeyDown(event, index)}
              onClick={() => {
                onOpenChange(menuId, false);
                onSelect(item.id);
              }}
            >
              <span className="md-menu-item-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
