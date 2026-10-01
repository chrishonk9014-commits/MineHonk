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
}
