// Side configurations of the review bench and everything derived from the registry (src/review/options.ts):
// which options apply, the denoiser options per node, presets (shipped / defaults as of a date / one per decision).
// A side's configuration is only its overrides: an empty object is the shipped package defaults.
import { DECISIONS, OPTIONS, type Decision, type ReviewOption, type Target, type Value, type Where } from './options';

export type SideConfig = Record<string, Value>;
export type Pair = { A: SideConfig; B: SideConfig };

export const optionById = new Map(OPTIONS.map((o) => [o.id, o]));
export const decisionById = new Map(DECISIONS.map((d) => [d.id, d]));

/** The value a side runs with as far as the registry knows (override, else the registry default). */
export const valueOf = (cfg: SideConfig, id: string): Value => cfg[id] ?? optionById.get(id)!.default;

/** Filter of a node on a side ('svgf' | 'recurrent'). */
export const filterOf = (cfg: SideConfig, node: 'gi' | 'ao') => valueOf(cfg, node === 'gi' ? 'gi.filter' : 'ao.filter') as 'svgf' | 'recurrent';
export const payloadOf = (cfg: SideConfig) => valueOf(cfg, 'gi.payload') as 'radiance' | 'sh';

const nodeOfTarget = (t: Target) => (t === 'ao' ? 'ao' : t === 'shadows' ? 'shadows' : 'gi');

/** The filter an option needs on its node ('svgf' | 'recurrent'), or undefined (shadows, switches, anyFilter). */
function needOf(o: ReviewOption): 'svgf' | 'recurrent' | undefined {
  if (o.anyFilter) return undefined;
  if (o.switch) return o.filter === 'sh' ? 'svgf' : undefined; // the SH payload needs SVGF; the filter switches nothing
  if (o.filter === 'shadows') return undefined;
  return o.filter === 'recurrent' ? 'recurrent' : 'svgf';
}

/** Targets of an option that are live on this side (an SVGF option skips a node running the recurrent filter, and v.v.). */
function liveTargets(o: ReviewOption, cfg: SideConfig): Target[] {
  const need = needOf(o);
  if (!need) return o.targets;
  return o.targets.filter((t) => { const node = nodeOfTarget(t); return node === 'shadows' || filterOf(cfg, node) === need; });
}

/** Why an option doesn't apply on this side (undefined = it applies), e.g. "needs filter 'recurrent'". */
export function inapplicable(o: ReviewOption, cfg: SideConfig): string | undefined {
  if (o.unwired) return o.unwired;
  if (o.filter === 'sh' && !o.switch && payloadOf(cfg) !== 'sh') return "needs payload 'sh' (the SH switch)";
  for (const [id, vs] of Object.entries(o.requires ?? {})) {
    if (!vs.includes(valueOf(cfg, id))) return `needs ${optionById.get(id)?.key ?? id} ${vs.map(String).join(' / ')}`;
  }
  if (!liveTargets(o, cfg).length) {
    const nodes = [...new Set(o.targets.map(nodeOfTarget))].map((n) => (n === 'gi' ? 'diffuse + specular' : 'AO')).join(' / ');
    return `needs filter '${needOf(o)}' on ${nodes}`;
  }
  return undefined;
}

export interface NodeOptions {
  /** realtimeDiffuseSpecular's `denoiser` (shared keys + per-signal `diffuse` / `specular`). */
  gi: Record<string, unknown> & { diffuse: Record<string, unknown>; specular: Record<string, unknown> };
  ao: Record<string, unknown>;
  shadows: Record<string, unknown>;
}

/** The `denoiser` options of each node of a side: every applicable override, nothing else (defaults stay the package's). */
export function nodeOptions(cfg: SideConfig): NodeOptions {
  const out: NodeOptions = { gi: { diffuse: {}, specular: {} }, ao: {}, shadows: {} };
  for (const [id, v] of Object.entries(cfg)) {
    const o = optionById.get(id);
    if (!o || inapplicable(o, cfg)) continue;
    const sh = payloadOf(cfg) === 'sh' && filterOf(cfg, 'gi') === 'svgf';
    for (const t of liveTargets(o, cfg)) {
      if (t === 'gi' && sh && o.radianceOnly) out.gi.specular[o.key] = v; // the SH diffuse node can't take it
      else if (t === 'gi') out.gi[o.key] = v;
      else if (t === 'gi.diffuse') out.gi.diffuse[o.key] = v;
      else if (t === 'gi.specular') out.gi.specular[o.key] = v;
      else out[t][o.key] = v;
    }
  }
  return out;
}

/** A stable key per node: a node is rebuilt only when its key changes (options are structural). */
export function nodeKeys(cfg: SideConfig): Record<'gi' | 'ao' | 'shadows', string> {
  const n = nodeOptions(cfg);
  return { gi: JSON.stringify(n.gi), ao: JSON.stringify(n.ao), shadows: JSON.stringify(n.shadows) };
}

/** Removes overrides equal to the registry default (keeps configs minimal, so "shipped" is {}). */
export function normalize(cfg: SideConfig): SideConfig {
  const out: SideConfig = {};
  for (const [id, v] of Object.entries(cfg)) { const o = optionById.get(id); if (o && v !== o.default) out[id] = v; }
  return out;
}

/** Value of option `o` as the package shipped it before date `d` (YYYY-MM-DD): the `from` of its first change on or after d. */
export function defaultBefore(o: ReviewOption, d: string): Value {
  const c = (o.changes ?? []).find((x) => x.on >= d);
  return c ? c.from : o.default;
}

/** Dates on which registered defaults changed, newest first, with the decisions that changed them. */
export function changeDates(): { on: string; by: string[] }[] {
  const m = new Map<string, Set<string>>();
  for (const o of OPTIONS) for (const c of o.changes ?? []) (m.get(c.on) ?? m.set(c.on, new Set()).get(c.on)!).add(c.by);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([on, s]) => ({ on, by: [...s].sort() }));
}

/**
 * "Defaults before date d": the package defaults as they were before the flips of date d and later. Explicit for every
 * option with a recorded change (also the ones that changed earlier), so the preset holds even if the package's defaults
 * differ from the registry's.
 */
export function defaultsBefore(d: string): SideConfig {
  const cfg: SideConfig = {};
  for (const o of OPTIONS) if (o.changes?.length) cfg[o.id] = defaultBefore(o, d);
  return cfg;
}

/** The value a proposal turns on: `candidate`, else the non-default value of a two-value option, else the last change's `from`'s opposite. */
export function candidateOf(o: ReviewOption): Value {
  if (o.candidate !== undefined) return o.candidate;
  if (o.changes?.length) return o.default; // a flipped default: the flip itself is the change
  return o.values.find((v) => v !== o.default) ?? o.default;
}

/** The "without" value of a decision's option: the default if the candidate isn't the default yet, else what it replaced. */
export function offOf(o: ReviewOption): Value {
  const on = candidateOf(o);
  if (on !== o.default) return o.default;
  return o.changes?.length ? o.changes[o.changes.length - 1].from : o.values.find((v) => v !== on) ?? on;
}

/** Options that a decision preset flips (its `set`, else every non-tuning option with that decision id). */
export function decisionOptions(d: Decision): { o: ReviewOption; off: Value; on: Value }[] {
  if (d.set) return Object.entries(d.set).map(([id, [off, on]]) => ({ o: optionById.get(id)!, off, on }));
  return OPTIONS.filter((o) => o.decision === d.id && !o.tuning).map((o) => ({ o, off: offOf(o), on: candidateOf(o) }));
}

/**
 * B = A + that change: A is `base` with the decision's options off, B the same with them on. Values are explicit on both
 * sides (not left to the package default), so a flip test stays a flip test while a default is being changed.
 */
export function decisionPreset(d: Decision): Pair {
  const A: SideConfig = { ...(d.base ?? {}) }, B: SideConfig = { ...(d.base ?? {}) };
  for (const { o, off, on } of decisionOptions(d)) { A[o.id] = off; B[o.id] = on; }
  return { A, B };
}

/** Where a decision shows best: its own `where`, else its first option's. */
export function decisionWhere(d: Decision): Where | undefined {
  return d.where ?? decisionOptions(d)[0]?.o.where;
}

/** Decisions with at least one option or a `set` (the ones a preset can be built for). */
export const PRESET_DECISIONS = DECISIONS.filter((d) => decisionOptions(d).length > 0);

const short = (v: Value) => (typeof v === 'number' ? String(+v.toFixed(3)) : String(v));
/** Value label for a control. */
export function valueLabel(o: ReviewOption, v: Value): string { return o.valueLabels?.[String(v)] ?? short(v); }

/** One line describing a side's overrides ("shipped defaults" when empty). */
export function describe(cfg: SideConfig): string {
  const e = Object.entries(cfg);
  if (!e.length) return 'shipped defaults';
  return e.map(([id, v]) => { const o = optionById.get(id); return `${o?.key ?? id}=${o ? valueLabel(o, v) : short(v)}`; }).join(', ');
}

// ---- URL mirror (sharing only; the page never needs it) -------------------------------------------------------------
/** Compact encoding of a side for the URL: id:value pairs joined by '~' (values JSON-encoded). */
export function encodeSide(cfg: SideConfig): string {
  return Object.entries(cfg).map(([id, v]) => `${id}:${JSON.stringify(v)}`).join('~');
}
export function decodeSide(s: string | null): SideConfig {
  const out: SideConfig = {};
  if (!s) return out;
  for (const part of s.split('~')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const id = part.slice(0, i);
    try { const v = JSON.parse(part.slice(i + 1)); if (optionById.has(id) && ['boolean', 'number', 'string'].includes(typeof v)) out[id] = v; } catch { /* ignore */ }
  }
  return out;
}
