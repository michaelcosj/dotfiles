// Messages between a parent pi and its child agents over the bridge.
// A child connects to the parent's socket (a Unix path, or tcp://ip:port for
// a child on another Rex host) with
//   hello { protocol, token, role: "agent", id, name }
// then sends requests (child -> parent):
//   state { status: "working" | "idle" | "blocked", message? }
//   usage { tokens }                       context tokens, for the list
//   settled { last_message, aborted }      a run ended; the parent's result
//   files_changed { paths }                for Neovim's change review
//   view { block }                         this pi swapped `block` into view
//   switch { name }                        show agent `name` (or "main"); the parent does it
//   session { session_file }               the child's pi session, so it can be resumed
// and receives events (parent -> child):
//   prompt { text }    new work; a follow-up if busy
//   note { text }      a review note; starts a turn or queues as a follow-up
//   abort              stop the current run
//   shutdown           exit
//   roster { ... }     everyone in the group, to draw the list

export type AgentStatus = "starting" | "working" | "idle" | "blocked" | "crashed";

export interface RosterEntry {
  name: string;
  title: string;
  block: string;
  /** the Rex host it runs on; undefined is the parent's machine */
  host?: string;
  status: AgentStatus;
  message?: string;
  /** current run's start, or undefined when not working */
  runStartedAt?: number;
  /** length of the last finished run */
  runMs?: number;
  tokens?: number;
}

export interface Roster {
  main: string; // the parent's block
  visible: string; // the block in view
  agents: RosterEntry[];
}

export const ENV = {
  parent: "PI_BRIDGE_PARENT",
  token: "PI_BRIDGE_TOKEN",
  id: "PI_AGENT_ID",
  name: "PI_AGENT_NAME",
  title: "PI_AGENT_TITLE",
  prompt: "PI_AGENT_PROMPT_FILE",
  /** set for a child on another host: the host's label */
  host: "PI_AGENT_HOST",
  /** how long the child outlives a lost parent connection, in ms */
  parentGone: "PI_AGENT_PARENT_GONE_MS",
} as const;
