/**
 * A menu whose items can hold two lines, a count or an icon at the end (Add tracks, New playlist, Add to playlist,
 * a rule's tag values), with the kit Menu's keys: arrows, Home, End, Escape (focus back to the button), Tab. Items are
 * React content; `TwoLines` draws the usual icon, first line and hint. Tab closes it and goes on from its button. Something above the items (`top`, such as a
 * filter box) takes focus first. Drawn in the page body (ui.css .menu), placed under its button, or above it when
 * there is no room below.
 */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "./Icon";

export type PopMenuEntry =
  | { content: React.ReactNode; onSelect: () => void; disabled?: boolean; className?: string; key?: string; hidden?: boolean }
  | { separator: true }
  | { group: React.ReactNode };

export interface PopMenuProps {
  /** The id its button's aria-controls names. */
  id?: string;
  label: string;
  items: readonly PopMenuEntry[];
  anchor: React.RefObject<HTMLElement>;
  /** refocus: give focus back to the anchor (after a choice or Escape). */
  onClose: (refocus: boolean) => void;
  /** Something above the items, such as a filter box; it takes focus first. */
  top?: React.ReactNode;
}

/**
 * A menu like the kit's (ui.css .menu, same keys: arrows, Home, End, Escape, Tab), whose items can hold two lines,
 * a count or an icon at the end: Add tracks, New playlist, Add to playlist, and a rule's tag values.
 */
export function PopMenu({ id, label, items, anchor, onClose, top }: PopMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!menu || !at) return;
    const left = Math.min(Math.max(4, at.left), window.innerWidth - menu.offsetWidth - 4);
    let y = at.bottom + 4;
    if (y + menu.offsetHeight > window.innerHeight - 4) y = Math.max(4, at.top - menu.offsetHeight - 4);
    setPosition({ left, top: y });
    (menu.querySelector<HTMLElement>("input") ?? enabledItems(menu)[0])?.focus();
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.current?.contains(target)) onCloseRef.current(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = enabledItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(true);
        break;
      case "Tab":
        // The menu sits at the end of the page; focus goes back to its button first, so Tab goes on from there.
        onCloseRef.current(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? list.length - 1 : index - 1);
        break;
      case "Home":
        if (index < 0) break;
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        if (index < 0) break;
        event.preventDefault();
        focusAt(list.length - 1);
        break;
    }
  };

  return createPortal(
    <div ref={menuRef} id={id} className="menu" role="menu" aria-label={label} style={{ left: position.left, top: position.top, position: "fixed" }} onKeyDown={onKeyDown}>
      {top}
      {items.map((item, index) => {
        if ("separator" in item) return <div key={index} className="sep" role="separator" />;
        if ("group" in item)
          return (
            <div key={index} className="group" role="presentation">
              {item.group}
            </div>
          );
        if (item.hidden) return null;
        return (
          <button
            key={item.key ?? index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.className}
            tabIndex={-1}
            onClick={() => {
              onCloseRef.current(true);
              item.onSelect();
            }}
          >
            {item.content}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function enabledItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')) : [];
}

/** A button that opens a PopMenu; `items` is worked out when the menu opens. */
export function PopMenuButton({
  label,
  className,
  children,
  items,
  top,
  title,
  ariaLabel,
  focusKey,
  tabIndex,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  items: () => readonly PopMenuEntry[];
  top?: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  focusKey?: string;
  tabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title}
        data-focus={focusKey}
        tabIndex={tabIndex}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {children}
      </button>
      {open && (
        <PopMenu
          id={id}
          label={label}
          items={items()}
          top={top}
          anchor={ref}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus && ref.current && document.contains(ref.current)) ref.current.focus();
          }}
        />
      )}
    </>
  );
}

/** A menu item with an icon, a bold first line and a hint under it (Add tracks, New playlist). */
export function TwoLines({ icon, first, second, bold }: { icon: IconName; first: string; second: string; bold?: boolean }) {
  return (
    <>
      <Icon name={icon} size={bold ? undefined : "s"} />
      <span className="grow">
        {bold ? <b>{first}</b> : <span style={{ display: "block" }}>{first}</span>}
        <span className="hint" style={{ display: "block" }}>
          {second}
        </span>
      </span>
    </>
  );
}
