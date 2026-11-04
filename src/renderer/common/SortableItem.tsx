import React, { createContext, useContext } from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SortableItemProps = {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

type HandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  onKeyDown?: React.KeyboardEventHandler;
};

const HandleContext = createContext<HandleProps | undefined>(undefined);

/**
 * A row that can be reordered by dragging. UX finding 2: the mouse can drag
 * the row from anywhere (after moving 10 px, so clicks still work), but the
 * keyboard picks it up only from its DragHandle. Before, the whole row was one
 * big focusable button around the row's own buttons, so Enter or Space on
 * "close" or "bookmark" picked the row up instead of pressing the button.
 */
export function SortableItem({ id, style, children }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { onKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<string, React.EventHandler<React.SyntheticEvent>>;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...(style || {}),
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
      }}
      {...pointerListeners}
    >
      <HandleContext.Provider value={{ attributes, onKeyDown }}>{children}</HandleContext.Provider>
    </div>
  );
}

type DragHandleProps = {
  /** What a screen reader says, e.g. "Move Tabletop Audio". */
  label: string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
};

/**
 * The keyboard's way to move a SortableItem: focus it, press Space, use the
 * arrow keys, press Space again (or Escape). Outside a SortableItem (the
 * player tab, a dragged copy) it shows its content only, with no button.
 */
export function DragHandle({ label, children, sx }: DragHandleProps) {
  const handle = useContext(HandleContext);
  if (!handle) {
    return (
      <Box component="span" sx={sx} aria-hidden>
        {children}
      </Box>
    );
  }
  return (
    <Box
      component="span"
      {...handle.attributes}
      aria-roledescription="drag handle"
      aria-label={label}
      onKeyDown={handle.onKeyDown}
      sx={[{ cursor: "grab", borderRadius: "6px" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
}
