/** What the server sends a machine window (window props): the client draws every machine from this. */
export interface MachineProps {
  comp: string;
  name: string;
  tier: number;
  kind: string;
  layout: { input: number; output: number; fuel: number; tool: number; upgrades: number; ghost: number };
  energy?: number;
  energyMax?: number;
  progress?: number;
  time?: number;
  status?: string;
  statusText?: string;
  fluid?: { id: string | null; amount: number; cap: number };
  info: string[];
  buttons: { key: string; label: string; on?: boolean }[];
  guide: string;
  ghostLabel?: string;
  /** V6 phase 4: a text field (a Teleportation Node's name); typing sends eng_cfg with `key`. */
  field?: { key: string; value: string; max: number; placeholder: string; editable: boolean };
  /** V6 phase 4: a list of choices (a node's destinations), each a button sending eng_cfg `key`. */
  choices?: { key: string; label: string; detail: string; ok: boolean }[];
  choicesLabel?: string;
}
