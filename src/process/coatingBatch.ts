export type CoatingMode = 'production' | 'drain' | 'rinse';
export type CoatingRelease = 'awaiting-sample' | 'sampled' | 'released' | 'held';
export type CoatingFilter = 'clear' | 'loaded' | 'blocked';

export interface CoatingBatch {
  raw: number;
  premix: number;
  blend: number;
  filter: number;
  packed: number;
  staged: number;
  quarantined: number;
  samples: number;
  collected: number;
  rinse: number;
  release: CoatingRelease;
  filterCondition: CoatingFilter;
  mode: CoatingMode;
}

export type CoatingAction =
  | 'advance' | 'sample' | 'release' | 'hold' | 'next-batch' | 'quarantine' | 'reset' | 'start-raw'
  | CoatingMode | CoatingFilter;

/** 计数只代表课堂处理单位。未采用厂区容积、流量和工艺时间。 */
export function initialCoatingBatch(): CoatingBatch {
  return {
    raw: 4, premix: 0, blend: 2, filter: 0, packed: 0, staged: 0, quarantined: 0, samples: 0, collected: 0, rinse: 1,
    release: 'awaiting-sample', filterCondition: 'clear', mode: 'production'
  };
}

export interface CoatingConditions {
  canTransfer(pipeline: string): boolean;
  disperserRunning: boolean;
  mixerRunning: boolean;
}

export function actOnCoatingBatch(state: CoatingBatch, action: CoatingAction, conditions: CoatingConditions):
{ state: CoatingBatch; message: string } {
  const { canTransfer } = conditions;
  const reject = (message: string) => ({ state, message });
  const update = (change: Partial<CoatingBatch>, message: string) => ({ state: { ...state, ...change }, message });

  switch (action) {
    case 'reset': return { state: initialCoatingBatch(), message: '已恢复教学初始批次。' };
    case 'start-raw': return { state: { ...initialCoatingBatch(), blend: 0 }, message: '收料练习已准备。先推进原料进预混，再把预混浆送入调配罐。' };
    case 'production': return update({ mode: action }, '已切换到涂料批次操作。');
    case 'drain': return update({ mode: action }, '已隔离生产管路。滤器存液可经 PL-212 送到清洗液收集桶。');
    case 'rinse': return update({ mode: action }, '已隔离生产管路。PL-213 的演示清洗液只进入独立收集桶。');
    case 'clear': return update({ filterCondition: action }, '过滤器通路可用。');
    case 'loaded': return update({ filterCondition: action }, '设置过滤阻力增大情境。观察液侧输送受限。');
    case 'blocked': return update({ filterCondition: action }, '设置滤路阻断情境。进料暂停，过滤器存量保留。');
    case 'sample':
      if (state.release !== 'awaiting-sample') return reject('当前批次已有取样状态。');
      if (state.mode !== 'production' || state.blend < 1 || !conditions.mixerRunning || !canTransfer('PL-206')) {
        return reject('取样需要调配料、搅拌及通畅的 PL-206。请检查 SV-201。');
      }
      return update({ blend: state.blend - 1, samples: state.samples + 1, release: 'sampled' },
        '已记录教学样品。请根据本次情境选择放行或暂缓。');
    case 'release':
    case 'hold':
      if (state.mode !== 'production' || state.release !== 'sampled') {
        return reject('请先取样，再给出这批料的教学判定。');
      }
      return action === 'release'
        ? update({ release: 'released' }, '本批按教学条件放行。检查液路、驱动空气和过滤器。')
        : update({ release: 'held' }, '本批暂缓，主液路停止出料，罐内存料保留。');
    case 'quarantine':
      if (state.mode !== 'production' || state.release !== 'held' || !state.blend) {
        return reject('只有已暂缓的批次才能登记为隔离料。');
      }
      return update({ blend: 0, quarantined: state.quarantined + state.blend },
        '剩余调配料已记入教学隔离台账。现场隔离位置和处置程序待确认。');
    case 'next-batch':
      if (state.blend || state.filter) return reject('调配罐或过滤器仍有留存。先完成本批处置，再开始新批。');
      return update({ release: 'awaiting-sample', mode: 'production' }, '可以接收下一批调配料。');
    case 'advance': break;
  }

  if (state.mode === 'drain') {
    return state.filter > 0 && canTransfer('PL-212')
      ? update({ filter: state.filter - 1, collected: state.collected + 1 }, '一份滤器排净液已进入 CL-201。')
      : reject('过滤器没有可排净的存量。');
  }
  if (state.mode === 'rinse') {
    return state.rinse > 0 && canTransfer('PL-213')
      ? update({ rinse: state.rinse - 1, collected: state.collected + 1 }, '一份示意清洗来液已由 PL-213 进入 CL-201。')
      : reject('本次清洗来液已用完。');
  }

  // 每段只输送在该步开始时已经可用的物料。新到的物料在下一步才可继续输送。
  const receive = Number(state.raw > 0 && canTransfer('PL-202') && conditions.disperserRunning);
  const preMix = Number(state.release === 'awaiting-sample' && state.premix > 0 && canTransfer('PL-205') && conditions.mixerRunning);
  const filter = Number(state.blend > 0 && state.release === 'released' && canTransfer('PL-208'));
  const pack = Number(state.filter > 0 && state.release === 'released' && canTransfer('PL-209'));
  const stage = Number(state.packed > 0 && canTransfer('PL-210'));
  if (!receive && !preMix && !filter && !pack && !stage) return reject('当前条件没有可推进的操作。请检查存量、批次放行、阀门、动力与滤路。');
  return update({
    raw: state.raw - receive, premix: state.premix + receive - preMix,
    blend: state.blend + preMix - filter, filter: state.filter + filter - pack, packed: state.packed + pack - stage,
    staged: state.staged + stage
  }, '已推进一轮。各位置的教学存量已更新。');
}
