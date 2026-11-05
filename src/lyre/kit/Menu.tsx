import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { cx } from "./cx";

export type MenuEntry =
  | {
      label: string;
      onSelect: () => void;
      icon?: IconName;
      /** One of a set (a room, a theme): shown as a radio item, ticked when true. */
      checked?: boolean;
      disabled?: boolean;
      /** Deletes or stops for good. */
      danger?: boolean;
    }
  | { separator: true }
  | { group: string };

export interface MenuButtonProps {
  /** The button's name and the menu's name, e.g. "More for The Company themes". */
  label: string;
  /** An icon-only button (with `label` as its name), or words in `children`. */
  icon?: IconName;
  children?: React.ReactNode;
  items: readonly MenuEntry[];
  className?: string;
  size?: "s";
}

/**
 * A button that opens a menu below it (ui.css .menu). The first item takes focus; the arrow keys, Home and End move;
 * Enter chooses; Escape or Tab closes; focus goes back to the button after a choice or Escape.
 */
export function MenuButton({ label, icon, children, items, className, size }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      buttonRef.current?.focus();
    }
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cx("btn", !children && "icon", size, className)}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon && <Icon name={icon} size={size === "s" ? "s" : undefined} />}
        {children}
      </button>
      {open && <Menu id={menuId} label={label} items={items} anchor={buttonRef} onClose={close} />}
    </>
  );
}

interface MenuProps {
  id?: string;
  label: string;
  items: readonly MenuEntry[];
  /** The element the menu opens from (and gives focus back to). */
  anchor: React.RefObject<HTMLElement>;
  /** refocus: give focus back to the anchor (after a choice or Escape; not after a click elsewhere or Tab). */
  onClose: (refocus: boolean) => void;
}

/** An open menu, drawn above the page next to its anchor. Use MenuButton unless the menu opens from something else. */
export function Menu({ id, label, items, anchor, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  // Below the anchor, kept inside the window; above it when there is no room below.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!menu || !at) {
      return;
    }
    const left = Math.min(Math.max(4, at.left), window.innerWidth - menu.offsetWidth - 4);
    let top = at.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 4) {
      top = Math.max(4, at.top - menu.offsetHeight - 4);
    }
    setPosition({ left, top });
    enabledItems(menu)[0]?.focus();
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.current?.contains(target)) {
        onClose(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = enabledItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        break;
      case "Tab":
        onClose(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top, position: "fixed" }}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        if ("separator" in item) {
          return <div key={index} className="sep" role="separator" />;
        }
        if ("group" in item) {
          return (
            <div key={index} className="group" role="presentation">
              {item.group}
            </div>
          );
        }
        const radio = item.checked !== undefined;
        return (
          <button
            key={index}
            type="button"
            role={radio ? "menuitemradio" : "menuitem"}
            aria-checked={radio ? item.checked : undefined}
            disabled={item.disabled}
            className={item.danger ? "danger" : undefined}
            tabIndex={-1}
            onClick={() => {
              onClose(true);
              item.onSelect();
            }}
          >
            {radio ? <Icon name={item.checked ? "check" : "minus"} size="s" className={item.checked ? undefined : "faint"} /> : item.icon && <Icon name={item.icon} size="s" />}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function enabledItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not([disabled])")) : [];
}
