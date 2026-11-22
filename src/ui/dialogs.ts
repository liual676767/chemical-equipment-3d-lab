import { DEVICES, deviceById } from '../data/devices';
import {
  exportRecords, importRecords, clearRecords, recordsSummary, getFeedback,
  addFeedback, getRecord, practiceCompatible, taskState, getSelfCheck, fmtTime
} from '../state/store';
import { el, button, icon, ICONS } from './dom';

export const MODE_LABEL: Record<string, string> = {
  observe: '整体观察', section: '剖视', xray: '透明观察',
  explode: '爆炸图', principle: '工作原理', practice: '拆装练习'
};

function modal(title: string): { overlay: HTMLElement; body: HTMLElement; close: () => void } {
  const overlay = el('div', 'modal-overlay');
  const card = el('div', 'modal-card');
  const head = el('div', 'modal-head');
  head.appendChild(el('h3', 'modal-title', title));
  const closeBtn = button('', 'btn btn-ghost icon-btn', () => close(), '关闭');
  closeBtn.appendChild(icon(ICONS.close, 18));
  head.appendChild(closeBtn);
  card.appendChild(head);
  const body = el('div', 'modal-body');
  card.appendChild(body);
  overlay.appendChild(card);
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') close(); }
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { overlay, body, close };
}

/* ============ 学习记录管理 ============ */

export function openRecordsDialog() {
  const { body, close } = modal('学习记录管理');
  const render = (notice?: { text: string; ok?: boolean }) => {
    body.innerHTML = '';
    body.appendChild(el('p', 'modal-note',
      '记录仅保存在当前浏览器的本地存储中，不会上传服务器；清除浏览器数据会丢失记录，建议定期导出备份。记录按「设备 + 内容版本」保存，内容更新后不兼容的旧练习进度会自动作废，收藏与成绩保留。'));
    const sum = recordsSummary();
    body.appendChild(el('p', 'records-summary',
      `${sum.devices} 台设备有记录 · 累计完成练习 ${sum.completions} 次 · 本地反馈 ${sum.feedback} 条`));

    const list = el('div', 'records-list');
    for (const d of DEVICES) {
      const r = getRecord(d.id);
      const tasks = taskState(d.id);
      const manual = d.tasks.filter((t) => !t.exercise);
      const checks = d.tasks.filter((t) => t.exercise);
      const done = manual.filter((t) => tasks[t.id]).length;
      const doneChecks = checks.filter((t) => getSelfCheck(d.id, t.id)?.done).length;
      const row = el('div', 'records-row');
      row.appendChild(el('span', 'records-name', d.name));
      const meta: string[] = [];
      meta.push(r.completions ? `完成 ${r.completions} 次` : '未完成练习');
      if (r.best) meta.push(`最佳 ${fmtTime(r.best.elapsed)} · ${r.best.assisted ? '辅助' : '独立'}`);
      meta.push(`观察任务 手动 ${done}/${manual.length}${checks.length ? ` · 自测 ${doneChecks}/${checks.length}` : ''}`);
      if (r.favorite) meta.push('已收藏');
      row.appendChild(el('span', 'records-meta', meta.join(' · ')));
      if (r.practice && !practiceCompatible(d.id)) {
        row.appendChild(el('span', 'records-warn', '旧版本练习进度不兼容，进入练习时将重新开始'));
      } else if (r.practice && !r.practice.completed) {
        row.appendChild(el('span', 'records-ok', '有未完成的练习进度'));
      }
      row.appendChild(el('span', 'records-ver', `内容版本 ${d.contentVersion}`));
      list.appendChild(row);
    }
    body.appendChild(list);

    const actions = el('div', 'modal-actions');
    actions.appendChild(button('导出记录（JSON）', 'btn btn-primary', () => {
      const blob = new Blob([exportRecords()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url;
      a.download = `chem3d-lab-records-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      msg.textContent = '已导出记录文件，可用于备份或迁移到其他浏览器。';
    }, '把全部学习记录与反馈下载为 JSON 文件'));

    const importLabel = el('label', 'btn btn-outline records-import');
    importLabel.textContent = '导入记录…';
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      f.text().then((text) => {
        const res = importRecords(text);
        render(res.ok
          ? { text: `导入成功：${res.devices} 台设备的记录已恢复（不兼容的旧练习进度已自动作废）。`, ok: true }
          : { text: `导入失败：${res.error}`, ok: false });
      });
      file.value = '';
    });
    importLabel.appendChild(file);
    actions.appendChild(importLabel);

    let armed = false;
    let disarmTimer = 0;
    const clearBtn = button('清除全部记录', 'btn btn-warn', () => {
      if (!armed) {
        armed = true;
        clearBtn.textContent = '再次点击确认清除';
        disarmTimer = window.setTimeout(() => {
          armed = false;
          clearBtn.textContent = '清除全部记录';
        }, 3500);
        return;
      }
      window.clearTimeout(disarmTimer);
      armed = false;
      clearRecords();
      clearBtn.textContent = '清除全部记录';
      render({ text: '已清除本浏览器中的全部学习记录与反馈。' });
    }, '删除本浏览器保存的全部记录（需二次确认）');
    actions.appendChild(clearBtn);
    body.appendChild(actions);

    const msg = el('p', 'modal-msg', notice?.text ?? '');
    if (notice) msg.className = notice.ok ? 'modal-msg modal-msg-ok' : 'modal-msg modal-msg-bad';
    body.appendChild(msg);

    const fb = getFeedback();
    body.appendChild(el('h4', 'modal-h4', `本地反馈（${fb.length} 条）`));
    if (!fb.length) {
      body.appendChild(el('p', 'modal-note', '暂无反馈。在工作台顶栏点击「反馈」按钮可提交带设备与模式上下文的问题描述。'));
    } else {
      const fl = el('div', 'feedback-list');
      for (const f of fb.slice(-5).reverse()) {
        const row = el('div', 'feedback-row');
        row.appendChild(el('span', 'feedback-ctx',
          `${new Date(f.date).toLocaleString('zh-CN')} · ${f.deviceName} · ${MODE_LABEL[f.mode] ?? f.mode} · v${f.contentVersion}`));
        row.appendChild(el('p', 'feedback-text', f.text));
        fl.appendChild(row);
      }
      body.appendChild(fl);
    }
    body.appendChild(el('p', 'modal-note', '反馈随记录一起导出，可发送给内容维护者；真实试用反馈的组织方式见维护文档。'));
    const closeRow = el('div', 'modal-actions');
    closeRow.appendChild(button('关闭', 'btn btn-outline', close));
    body.appendChild(closeRow);
  };
  render();
}

/* ============ 反馈入口 ============ */

export function openFeedbackDialog(deviceId: string, getMode: () => string) {
  const device = deviceById(deviceId);
  const { body, close } = modal('问题反馈');
  body.appendChild(el('p', 'modal-note',
    '反馈会附带当前设备、所在模式与内容版本，便于定位问题；内容保存在本浏览器并随记录导出，不会自动上传。'));
  const ctx = el('p', 'feedback-context');
  const syncCtx = () => {
    ctx.textContent = `当前设备：${device?.name ?? deviceId} · 模式：${MODE_LABEL[getMode()] ?? getMode()} · 内容版本：${device?.contentVersion ?? '-'}`;
  };
  syncCtx();
  body.appendChild(ctx);
  const ta = el('textarea', 'feedback-input') as HTMLTextAreaElement;
  ta.rows = 5;
  ta.placeholder = '描述遇到的问题或建议，例如：在哪一步停顿、哪个零件说明看不懂、哪处操作不顺手…';
  ta.setAttribute('aria-label', '反馈内容');
  body.appendChild(ta);
  const msg = el('p', 'modal-msg', '');
  body.appendChild(msg);
  const actions = el('div', 'modal-actions');
  const submit = button('提交反馈', 'btn btn-primary', () => {
    const text = ta.value.trim();
    if (!text) {
      msg.textContent = '请先填写反馈内容。';
      msg.className = 'modal-msg modal-msg-bad';
      return;
    }
    addFeedback({
      deviceId,
      deviceName: device?.name ?? deviceId,
      mode: getMode(),
      contentVersion: device?.contentVersion ?? '-',
      text
    });
    msg.textContent = '已保存到本地反馈列表，可在「学习记录管理」中查看与导出。';
    msg.className = 'modal-msg modal-msg-ok';
    ta.value = '';
    setTimeout(close, 1100);
  });
  actions.appendChild(submit);
  actions.appendChild(button('取消', 'btn btn-outline', close));
  body.appendChild(actions);
  setTimeout(() => ta.focus(), 60);
}