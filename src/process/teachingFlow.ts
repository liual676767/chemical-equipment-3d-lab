import type { PipeEndpoint } from '../data/plant';
import type { ValveState } from '../data/valveOperations';

export interface PipeFlowState { state: 'full' | 'halt' | 'off'; haltT: number; throttle: boolean }
export function teachingFlowLabel(flow: PipeFlowState): string {
  if (flow.state === 'off') return '无上游供给';
  if (flow.state === 'halt') return '示踪止于关闭阀';
  return flow.throttle ? '通路受限' : '通路可用';
}

type Supply = 0 | 1 | 2;
type Inlet = (node: string, port: string) => Supply;
type Outlet = (node: string, port: string, inlet: Inlet) => Supply;
type Pipe = { id: string; from: PipeEndpoint; to: PipeEndpoint };

// A port has no supply, throttled supply or full teaching supply. No engineering flow rates are calculated.
export function strongest(...ranks: Supply[]): Supply {
  return ranks.reduce<Supply>((best, rank) => rank > best ? rank : best, 0);
}

export function solveTeachingFlow(
  pipes: readonly Pipe[],
  valves: (pipeId: string) => { at: number; state: ValveState }[],
  outlet: Outlet,
  boundarySupply: (pipe: Pipe) => Supply = () => 2
) {
  const supplied = new Map<string, Map<string, Supply>>();
  const inlet: Inlet = (node, port) => supplied.get(node)?.get(port) ?? 0;
  const segments = pipes.map(pipe => {
    const controls = valves(pipe.id);
    return { pipe, halt: controls.filter(v => v.state === 'closed').sort((a, b) => a.at - b.at)[0]?.at,
      restricted: controls.some(v => v.state === 'partial') };
  });
  const upstream = (pipe: Pipe): Supply => {
    const { from } = pipe;
    return from.type === 'cap' ? boundarySupply(pipe) : outlet(from.node, from.port, inlet);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const { pipe, halt, restricted } of segments) {
      if (halt !== undefined || pipe.to.type !== 'port') continue;
      const rank = upstream(pipe);
      const next = restricted && rank ? 1 : rank;
      const { node, port } = pipe.to;
      if (next <= inlet(node, port)) continue;
      let ports = supplied.get(node);
      if (!ports) supplied.set(node, ports = new Map());
      ports.set(port, next);
      changed = true;
    }
  }
  const flows = new Map<string, PipeFlowState>();
  for (const { pipe, halt, restricted } of segments) {
    const rank = upstream(pipe);
    flows.set(pipe.id, { state: !rank ? 'off' : halt === undefined ? 'full' : 'halt',
      haltT: rank ? halt ?? 1 : 1, throttle: !!rank && (restricted || rank === 1) });
  }
  return { flows, inlet, supplied };
}
