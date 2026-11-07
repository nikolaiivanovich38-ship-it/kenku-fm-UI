/**
 * What every Settings box shares: the bridges to the main process (window.lyre, or a test's), the Saved message, and
 * the switch and radio pieces the prototype draws (settings.js sw(), the seg radios).
 */
import React, { createContext, useCallback, useContext, useId, useRef } from "react";

import type { RemoteBridge } from "../../../common/remoteControl";
import { useAnnounce } from "../../shell/Announcer";
import { savedText } from "../../shell/savedModel";
import type { LyreWindowSettingsBridge } from "../../windowSettings/preloadWindowSettings";

export interface SettingsBridges {
  /** SEC-4: window.lyre.remote. */
  remote: RemoteBridge | null;
  /** OUT-8: window.lyre.windowSettings (Sound to Discord, Website tabs, Local files). */
  windowSettings: LyreWindowSettingsBridge | null;
}

const BridgesContext = createContext<SettingsBridges | null>(null);

export function SettingsBridgesProvider({ value, children }: { value: SettingsBridges; children: React.ReactNode }) {
  return <BridgesContext.Provider value={value}>{children}</BridgesContext.Provider>;
}

/** The test's bridges, else the page's own. */
export function useSettingsBridges(): SettingsBridges {
  const given = useContext(BridgesContext);
  if (given) return given;
  const lyre = (window as unknown as { lyre?: Partial<SettingsBridges> }).lyre;
  return { remote: lyre?.remote ?? null, windowSettings: lyre?.windowSettings ?? null };
}

/**
 * "Saved: <what>" after a change (UX-19). TODO(w6-shell): show it with the shell's Saved pop-up hook once it lands;
 * until then the page's status note shows the same words.
 */
export function useSaved(): (what: string, detail?: string) => void {
  const { toast } = useAnnounce();
  return useCallback((what: string, detail?: string) => toast(savedText(what, detail)), [toast]);
}

/** A switch (a check box read out as a switch), as the prototype's sw(): its name, and why when it is greyed. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  why,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  /** Why it is greyed (read out with it, and on hover). */
  why?: string;
  title?: string;
}) {
  const whyId = useId();
  return (
    <>
      <label className={disabled ? "st-sw dis" : "st-sw"} title={disabled && why ? why : title}>
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={disabled && why ? whyId : undefined} onChange={(event) => onChange(event.target.checked)} />
        <span className="st-sw-t">
          <b>{label}</b>
        </span>
      </label>
      {disabled && why && (
        <span className="sr-only" id={whyId}>
          {why}
        </span>
      )}
    </>
  );
}

/**
 * The prototype's segmented radios (a radiogroup of buttons): one Tab stop, the arrows move and choose, as WAI-ARIA's
 * radio group.
 */
export function RadioButtons<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; name: string; description?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (to: number) => {
    const index = (to + options.length) % options.length;
    onChange(options[index].value);
    refs.current[index]?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === at ? 0 : -1}
          title={option.description}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              move(index + 1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              move(index - 1);
            }
          }}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}

/** A native radio with its words, as the prototype's lk-radio. */
export function Radio({ name, label, checked, onChange, disabled, title }: { name: string; label: string; checked: boolean; onChange: () => void; disabled?: boolean; title?: string }) {
  return (
    <label className={disabled ? "st-radio dis" : "st-radio"} title={title}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={(event) => event.target.checked && onChange()} />
      <span>{label}</span>
    </label>
  );
}
