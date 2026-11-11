/**
 * Settings › Discord bots (OUT-8, design/prototype/src/views/settings.js): each bot with its status, the servers it
 * is in, Connect or Disconnect, its token as its last four characters with Replace…, and Rename and Remove behind ⋯
 * (Remove has Undo; the last bot cannot be removed). Add a bot is three steps in Discord's order: create it, invite
 * it (before Lyre has its token), connect it with its token.
 *
 * A token goes from its field straight to the main process (window.lyre.outputs.addBot / replaceToken), which keeps it
 * encrypted (SEC-5); the page never gets it back, only its last four characters. The invite is made by the main
 * process from the Application ID and opened in the browser (openInvite); the link's address is shown for the mouse
 * and for copying.
 */
import React, { useEffect, useId, useRef, useState } from "react";

import { botInviteUrl, isApplicationId, type LyreBot, type LyreBotResult, type LyreOutputs } from "../../../common/lyreOutputs";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { StatusPill } from "../../kit/Pills";
import { PopMenuButton } from "../../kit/PopMenu";
import { useOutputs, type OutputsClient } from "../../outputs/OutputsProvider";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { useSaved } from "./common";
import { ADD_BOT_STEPS, DEVELOPER_PORTAL, addedWords, loginTone, loginWords, maskedToken, serverNames } from "./settingsModel";

/** A bot call's refusal in plain words, or null when it worked (the compiler settings do not narrow on `ok`). */
function problemOf(answer: LyreBotResult): string | null {
  return answer.ok ? null : (answer as { message: string }).message;
}

/** Focus a control by its data-k once it is drawn (after a state change). */
function focusLater(key: string) {
  setTimeout(() => document.querySelector<HTMLElement>(`[data-k="${key}"]`)?.focus(), 0);
}

export function BotsPane() {
  const { outputs, client } = useOutputs();
  const [adding, setAdding] = useState(false);
  return (
    <Pane
      id="st-bots"
      title="Discord bots"
      icon="users"
      kind="onair"
      size="auto"
      noMax
      silent
      describe="Each bot is one voice in Discord: one room at a time."
      actions={
        <button type="button" className="btn s" data-k="st-add" onClick={() => setAdding(true)} disabled={!client}>
          <Icon name="plus" size="s" />
          Add a bot
        </button>
      }
    >
      {!outputs || !client ? (
        <p className="hint">Looking for your Discord bots…</p>
      ) : (
        <div className="st-bots">
          {outputs.bots.length === 0 && <p className="hint">No bot yet. Add a bot: Lyre walks you through Discord&apos;s steps.</p>}
          {outputs.bots.map((bot) => (
            <BotRow key={bot.id} bot={bot} outputs={outputs} client={client} />
          ))}
          {!outputs.encryption && <p className="hint">This computer cannot keep tokens encrypted, so Lyre keeps them only until it closes.</p>}
        </div>
      )}
      {adding && client && outputs && <AddBotSheet outputs={outputs} client={client} onClose={() => setAdding(false)} />}
    </Pane>
  );
}

function BotRow({ bot, outputs, client }: { bot: LyreBot; outputs: LyreOutputs; client: OutputsClient }) {
  const { say, toast } = useAnnounce();
  const saved = useSaved();
  const { offerUndo } = useUndoNote();
  const [replacing, setReplacing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);
  const tokenId = useId();
  const k = `st-b-${bot.id}`;
  const on = bot.login === "ready" || bot.login === "connecting";
  const servers = serverNames(outputs, bot);
  const masked = maskedToken(bot);

  useEffect(() => {
    if (replacing) tokenRef.current?.focus();
  }, [replacing]);

  const connect = () => {
    if (bot.login === "connecting") return;
    if (on) {
      client.disconnect(bot.id);
      say(`${bot.name} disconnected`);
    } else {
      client.connect(bot.id);
      say(`${bot.name} is connecting`);
    }
  };
  const saveToken = async () => {
    const value = tokenRef.current?.value.trim() ?? "";
    if (!value) {
      toast("Paste the token first");
      tokenRef.current?.focus();
      return;
    }
    const answer = await client.replaceToken(bot.id, value);
    if (problemOf(answer)) {
      toast(problemOf(answer)!);
      tokenRef.current?.focus();
      return;
    }
    setReplacing(false);
    saved(`${bot.name} token`);
    say(`New token saved for ${bot.name}`);
    focusLater(`${k}-conn`);
  };
  const remove = async () => {
    const answer = await client.remove(bot.id);
    if (problemOf(answer)) {
      toast(problemOf(answer)!);
      return;
    }
    offerUndo(`Removed ${bot.name} and its token.`, () => {
      void client.restore(bot.id).then((back) => {
        const problem = problemOf(back);
        if (problem) toast(problem);
      });
    });
    say(`Removed ${bot.name}. Undo is at the foot of the screen, or press Ctrl+Z.`);
    focusLater("st-add");
  };

  return (
    <div className="st-bot" role="group" aria-label={bot.name}>
      <div className="st-bot-1">
        <b className="ellipsis" title={bot.name !== bot.savedName ? `${bot.name} (in Lyre: ${bot.savedName})` : bot.name}>
          {bot.name}
        </b>
        <StatusPill text={loginWords(bot)} tone={loginTone(bot)} />
        <span className="grow" />
        <button type="button" className={on ? "btn s" : "btn s primary"} data-k={`${k}-conn`} aria-disabled={bot.login === "connecting" || undefined} onClick={connect}>
          {on ? "Disconnect" : "Connect"}
        </button>
        <PopMenuButton
          label={`More for ${bot.name}`}
          ariaLabel={`More for ${bot.name}`}
          title={`More for ${bot.name}`}
          className="closer"
          items={() => [
            { key: "rename", content: <><Icon name="edit" size="s" />Rename…</>, onSelect: () => setRenaming(true) },
            {
              key: "remove",
              content: <><Icon name="trash" size="s" />Remove {bot.name}</>,
              disabled: !bot.canRemove,
              onSelect: () => void remove(),
            },
            ...(bot.canRemove ? [] : [{ note: "Lyre needs at least one bot: replace its token instead." }]),
          ]}
        >
          <Icon name="more" />
        </PopMenuButton>
      </div>
      <div className="st-bot-2">
        <span className="st-l">Token</span>
        {replacing ? (
          <div className="st-tok-new">
            <label className="sr-only" htmlFor={tokenId}>
              New token for {bot.name}
            </label>
            <input
              ref={tokenRef}
              className="input"
              type="password"
              id={tokenId}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the new token"
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveToken();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setReplacing(false);
                  focusLater(`${k}-tokrep`);
                }
              }}
            />
            <button type="button" className="btn s primary" onClick={() => void saveToken()}>
              Save
            </button>
            <button
              type="button"
              className="btn s ghost"
              onClick={() => {
                setReplacing(false);
                focusLater(`${k}-tokrep`);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="st-tok num" title={bot.tokenRemembered ? "Kept encrypted on this computer; only the last four characters show" : "Kept until Lyre closes; only the last four characters show"}>
              {masked ?? <span className="faint">No token</span>}
            </span>
            <button type="button" className="btn s ghost" data-k={`${k}-tokrep`} aria-label={`Replace the token of ${bot.name}`} onClick={() => setReplacing(true)}>
              Replace…
            </button>
          </>
        )}
      </div>
      {bot.login === "ready" && (
        <div className="st-bot-2">
          <span className="st-l">Servers</span>
          {servers.length ? (
            <span className="ellipsis" title={servers.join(", ")}>
              {servers.join(", ")}
            </span>
          ) : (
            <>
              <span className="st-none">
                <Icon name="warn" size="s" />
                In no server yet
              </span>
              {bot.applicationId && <InviteLink applicationId={bot.applicationId} client={client} className="btn s">Invite it…</InviteLink>}
            </>
          )}
        </div>
      )}
      {bot.login === "error" && (
        <p className="st-err" role="alert">
          <Icon name="warn" size="s" />
          {bot.error ?? "Discord refused the token"}
        </p>
      )}
      {renaming && <RenameSheet bot={bot} client={client} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** The invite: its address for the mouse and for copying; the main process opens it in the browser. */
function InviteLink({ applicationId, client, className, children, dataK, onOpened }: { applicationId: string; client: OutputsClient; className?: string; children: React.ReactNode; dataK?: string; onOpened?: () => void }) {
  const { toast } = useAnnounce();
  return (
    <a
      className={className}
      href={botInviteUrl(applicationId)}
      data-k={dataK}
      onClick={(event) => {
        event.preventDefault();
        client.openInvite(applicationId);
        onOpened?.();
        toast("Opens Discord in your browser: choose your server, Authorize");
      }}
    >
      <Icon name="link" size="s" />
      {children}
    </a>
  );
}

function RenameSheet({ bot, client, onClose }: { bot: LyreBot; client: OutputsClient; onClose: () => void }) {
  const saved = useSaved();
  const { toast } = useAnnounce();
  const [name, setName] = useState(bot.savedName);
  const id = useId();
  const save = async () => {
    const value = name.trim();
    if (!value) return onClose();
    const answer = await client.rename(bot.id, value);
    const problem = problemOf(answer);
    if (problem) return toast(problem);
    onClose();
    saved(`name “${value}”`);
  };
  return (
    <Dialog
      open
      title={`Rename ${bot.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()}>
            Rename
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor={id}>Name in Lyre</label>
        <input className="input" id={id} value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void save()} />
        <span className="hint">Discord shows the bot&apos;s own name once it is connected; this one is for Lyre.</span>
      </div>
    </Dialog>
  );
}

/* ---------- Add a bot: three steps, in the order Discord needs ---------- */

function AddBotSheet({ outputs, client, onClose }: { outputs: LyreOutputs; client: OutputsClient; onClose: () => void }) {
  const { say, toast } = useAnnounce();
  const [step, setStep] = useState(0);
  const [appId, setAppId] = useState("");
  const [byHand, setByHand] = useState(false);
  const [botId, setBotId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const appIdRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const typedId = appId.trim();
  const validId = isApplicationId(typedId);
  // UX-R11: what was typed is kept as typed; a wrong one is said under the field, never changed without a word.
  const [idTried, setIdTried] = useState(false);
  const idProblem = typedId && !validId ? "An Application ID is a long number: copy it from General Information." : idTried && !typedId ? "Paste the Application ID first (General Information)." : null;
  const [tokenMissing, setTokenMissing] = useState(false);
  const added = botId ? outputs.bots.find((b) => b.id === botId) : undefined;
  const done = added?.login === "ready";
  const example = `Lyre ${["Side", "Third", "Fourth", "Fifth"][Math.min(3, Math.max(0, outputs.bots.length - 1))]}`;

  const go = (to: number) => {
    setStep(to);
    say(`Step ${to + 1} of 3: ${ADD_BOT_STEPS[to]}`);
    setTimeout(() => (to === 1 ? appIdRef.current : to === 2 ? tokenRef.current : null)?.focus(), 0);
  };
  const connect = async () => {
    const token = tokenRef.current?.value.trim() ?? "";
    if (!token) {
      // UX-R11: said under the field, like Discord's own refusal, not in a corner of the window.
      setTokenMissing(true);
      tokenRef.current?.focus();
      return;
    }
    setTokenMissing(false);
    setProblem(null);
    // A second try after Discord refused the token replaces the token of the bot the first try added.
    const answer = botId ? await client.replaceToken(botId, token) : await client.addBot(token, validId ? typedId : null);
    const problem = problemOf(answer);
    if (problem) {
      setProblem(problem);
      tokenRef.current?.focus();
      return;
    }
    if (tokenRef.current) tokenRef.current.value = "";
    setBotId((answer as { botId: string }).botId);
  };
  useEffect(() => {
    if (!added) return;
    if (added.login === "ready") {
      const words = addedWords(outputs, added);
      say(`${words.connected} ${words.where}`);
      focusLater("st-done");
    } else if (added.login === "error") {
      setProblem(added.error ?? "Discord refused the token. Copy it again (Bot › Reset Token › Copy) and paste it here.");
    }
    // say is stable; the bot's login is what moves this on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added?.login]);
  const finish = () => {
    onClose();
    if (botId) focusLater(`st-b-${botId}-conn`);
  };

  const words = added && done ? addedWords(outputs, added) : null;
  let body: React.ReactNode;
  if (step === 0) {
    body = (
      <ol className="st-do">
        <li>
          <a className="btn s" href={DEVELOPER_PORTAL} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size="s" />
            Open the Discord Developer Portal
          </a>
        </li>
        <li>
          <b>New Application</b>, give it a name (for example {example}), <b>Create</b>.
        </li>
      </ol>
    );
  } else if (step === 1) {
    body = (
      <>
        <p className="st-why">Invite the bot before you give Lyre its token.</p>
        {/* Could 17 of the round 6 review: where to find the ID comes before the field, in the order it is done. */}
        <ol className="st-do">
          <li>
            <b>General Information</b> › <b>Application ID</b> › <b>Copy</b>
          </li>
        </ol>
        <div className="field">
          <label htmlFor={`${ids}-appid`}>Application ID</label>
          <div className="row-flex">
            <input
              ref={appIdRef}
              className="input num"
              id={`${ids}-appid`}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Paste it here"
              value={appId}
              aria-invalid={idProblem ? true : undefined}
              aria-describedby={idProblem ? `${ids}-appid-e` : undefined}
              onChange={(event) => setAppId(event.target.value)}
            />
            {validId ? (
              <InviteLink applicationId={typedId} client={client} className="btn s primary" dataK="st-openinv">
                Open the invite
              </InviteLink>
            ) : (
              <a
                className="btn s primary"
                role="link"
                aria-disabled="true"
                tabIndex={0}
                data-k="st-openinv"
                onClick={() => {
                  setIdTried(true);
                  appIdRef.current?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  setIdTried(true);
                  appIdRef.current?.focus();
                }}
              >
                <Icon name="link" size="s" />
                Open the invite
              </a>
            )}
          </div>
          {idProblem && (
            <p className="st-err" id={`${ids}-appid-e`}>
              <Icon name="warn" size="s" />
              {idProblem}
            </p>
          )}
        </div>
        <ol className="st-do">
          <li>
            Choose your server, <b>Authorize</b>. You need <b>Manage Server</b> on it.
          </li>
        </ol>
        <button type="button" className="st-handbtn" aria-expanded={byHand} aria-controls={`${ids}-hand`} onClick={() => setByHand(!byHand)}>
          <Icon name={byHand ? "chevup" : "chevdown"} size="s" />
          Or make the invite by hand
        </button>
        {byHand && (
          <ol className="st-do" id={`${ids}-hand`}>
            <li>
              <b>OAuth2</b> › <b>URL Generator</b>
            </li>
            <li>
              Scopes: <b>bot</b>
            </li>
            <li>
              Bot Permissions: <b>View Channels</b>, <b>Connect</b>, <b>Speak</b>
            </li>
            <li>
              Open the <b>Generated URL</b>, choose your server, <b>Authorize</b>
            </li>
          </ol>
        )}
      </>
    );
  } else {
    body = (
      <>
        <ol className="st-do">
          <li>
            <b>Bot</b> › <b>Reset Token</b> › <b>Copy</b>. Discord shows it once.
          </li>
        </ol>
        <div className="field">
          <label htmlFor={`${ids}-token`}>Token</label>
          <input
            ref={tokenRef}
            className="input"
            type="password"
            id={`${ids}-token`}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste it here"
            aria-describedby={`${ids}-token-d`}
            aria-invalid={tokenMissing || problem ? true : undefined}
            disabled={done}
            onInput={() => setTokenMissing(false)}
            onKeyDown={(event) => event.key === "Enter" && !done && void connect()}
          />
          <span className="hint" id={`${ids}-token-d`} title="Lost it? Reset Token again makes a new one">
            {/* UX-R10: the same as Settings says about this computer. */}
            {outputs.encryption ? "Kept encrypted on this computer." : "Kept only until Lyre closes: this computer cannot keep it encrypted."}
          </span>
        </div>
        {tokenMissing && !problem && (
          <p className="st-err" role="alert">
            <Icon name="warn" size="s" />
            Paste the token first
          </p>
        )}
        {problem && (
          <p className="st-err" role="alert">
            <Icon name="warn" size="s" />
            {problem}
          </p>
        )}
        {added && !done && !problem && <p className="hint">Connecting {added.name}…</p>}
        {words && (
          <div className="st-result" role="status">
            <Icon name="check" size="s" />
            <b>{words.connected}</b> {words.where}
            {words.inNoServer && added?.applicationId && (
              <>
                {" "}
                <InviteLink applicationId={added.applicationId} client={client}>
                  Invite it
                </InviteLink>
                , then it shows here.
              </>
            )}
          </div>
        )}
      </>
    );
  }

  const footer = (
    <>
      {step === 0 ? (
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => go(step - 1)} disabled={done}>
          Previous
        </button>
      )}
      {step < 2 ? (
        <button type="button" className="btn primary" onClick={() => go(step + 1)}>
          Next
        </button>
      ) : done ? (
        <button type="button" className="btn primary" data-k="st-done" onClick={finish}>
          Done
        </button>
      ) : (
        <button type="button" className="btn primary" onClick={() => void connect()}>
          Connect
        </button>
      )}
    </>
  );

  return (
    <Dialog open title={`Add a bot: step ${step + 1} of 3`} onClose={done ? finish : onClose} footer={footer}>
      <div className="st-add">
        <ol className="st-steps" aria-label="Steps">
          {ADD_BOT_STEPS.map((name, i) => (
            <li key={name} aria-current={i === step ? "step" : undefined} className={i === step ? "now" : i < step ? "done" : undefined}>
              <span className="num">{i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
        <p className="sr-only">Create the application, invite the bot to your server, then give Lyre its token.</p>
        <div className="st-stepbody">{body}</div>
      </div>
    </Dialog>
  );
}
