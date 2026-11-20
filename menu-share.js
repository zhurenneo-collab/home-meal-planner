'use strict';
window.MenuShare = (() => {
  const livePage = 'https://zhurenneo-collab.github.io/home-meal-planner/share.html';
  const labels = ['荤菜', '素菜', '汤品'];
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  function dateLabel(iso, weekday = false) {
    const date = new Date(iso + 'T12:00:00Z');
    const label = (date.getUTCMonth() + 1) + '月' + date.getUTCDate() + '日';
    return weekday ? weekdays[date.getUTCDay()] + ' · ' + label : label;
  }
  function period(days) {
    const first = days[0][0], last = days[days.length - 1][0];
    return first.slice(0,4) + '年' + dateLabel(first) +
      (first === last ? '' : ' — ' + (last.slice(0,4) === first.slice(0,4) ? '' : last.slice(0,4) + '年') + dateLabel(last));
  }
  function makeLink(days) {
    const bytes = new TextEncoder().encode(JSON.stringify([1,days]));
    const base = location.protocol === 'file:' ? new URL(livePage) : new URL('share.html', location.href);
    base.hash = btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    return base.href;
  }
  function readLink(hash) {
    const code = hash.slice(1);
    if (!/^[A-Za-z0-9_-]{1,16000}$/.test(code)) throw Error('invalid link');
    const bytes = Uint8Array.from(atob(code.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    if (!Array.isArray(payload) || payload.length !== 2 || payload[0] !== 1) throw Error('unknown format');
    const days = payload[1];
    if (!Array.isArray(days) || ![1,5].includes(days.length)) throw Error('invalid menu');
    let previous = 0;
    for (const row of days) {
      if (!Array.isArray(row) || row.length !== 4 || typeof row[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) throw Error('invalid day');
      const date = new Date(row[0] + 'T12:00:00Z');
      if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== row[0] || ![1,2,3,4,5].includes(date.getUTCDay()) || (previous && +date - previous !== 86400000)) throw Error('invalid date');
      if (row.slice(1).some(name => typeof name !== 'string' || !name.trim() || name.length > 60)) throw Error('invalid dish');
      previous = +date;
    }
    return days;
  }
  function draw(list, days) {
    list.replaceChildren(...days.map(([date,...names]) => {
      const card = document.createElement('article');
      card.className = 'share-day';
      card.append(element('h3',dateLabel(date,true)));
      const dl = document.createElement('dl');
      names.forEach((name,i) => dl.append(element('dt',labels[i]),element('dd',name)));
      card.append(dl);
      return card;
    }));
  }
  function plainText(days) {
    return '家庭菜单 · ' + period(days) + '\n\n' + days.map(([date,...names]) =>
      [dateLabel(date,true),...names.map((name,i) => labels[i] + '：' + name)].join('\n')).join('\n\n');
  }
  function actions(root, getDays) {
    const primary=root.querySelector('[data-send]'), copyLink=root.querySelector('[data-link]'),
      feedback=root.querySelector('[data-feedback]'), manual=root.querySelector('[data-manual]');
    const reset=()=>{feedback.textContent='';manual.hidden=true;manual.value=''};
    async function copy(value, message) {
      reset();
      try {
        await navigator.clipboard.writeText(value);
        feedback.textContent=message;
      } catch {
        manual.hidden=false;manual.value=value;manual.focus();manual.select();
        try { if(document.execCommand('copy')) {manual.hidden=true;feedback.textContent=message;return} } catch {}
        feedback.textContent='请选中下方内容，手动复制。';
      }
    }
    const canSend=typeof navigator.share==='function';
    primary.textContent=canSend?'分享链接':'复制链接';
    copyLink.hidden=!canSend;
    copyLink.onclick=()=>copy(makeLink(getDays()),'链接已复制');
    root.querySelector('[data-text]').onclick=()=>copy(plainText(getDays()),'菜单文字已复制');
    primary.onclick=async()=>{
      if(!canSend)return copyLink.onclick();
      reset();
      const days=getDays(), url=makeLink(days);
      try { await navigator.share({title:'家庭菜单 · '+period(days),url}); }
      catch(error){if(error.name!=='AbortError')feedback.textContent='系统分享暂不可用，请点「复制链接」。'}
    };
    return reset;
  }
  function open(entries, initialDate) {
    const dialog=document.getElementById('menuShare');
    const scopes=dialog.querySelector('.share-segments'), choice=dialog.querySelector('[data-choice]');
    const weekCount=Math.ceil(entries.length/5);
    let selected=[], dateIndex=Math.max(0,entries.findIndex(d=>d.row[0]===initialDate));
    const reset=actions(dialog,()=>selected);
    function update() {
      const single=scopes.querySelector('input:checked').value==='day', first=Math.floor(dateIndex/5)*5;
      const group=single?[entries[dateIndex]]:entries.slice(first,first+5);
      selected=group.map(d=>d.row);
      choice.replaceChildren();
      const step=single?1:5;
      for(let i=0;i<entries.length;i+=step){
        const label=single?dateLabel(entries[i].row[0],true):period(entries.slice(i,i+5).map(d=>d.row));
        choice.add(new Option(label,String(i)));
      }
      choice.value=String(single?dateIndex:first);
      choice.parentElement.hidden=!single&&weekCount===1;
      choice.setAttribute('aria-label',single?'选择分享日期':'选择分享周');
      dialog.querySelector('[data-period]').textContent=period(selected);
      dialog.querySelector('[data-preview]').hidden=group.every(d=>d.saved);
      draw(dialog.querySelector('[data-days]'), selected);
      reset();
    }
    scopes.querySelector('[value=week]').checked=true;
    scopes.onchange=update;
    choice.onchange=()=>{dateIndex=Number(choice.value);update()};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    update();dialog.showModal();
  }
  function showReceived(root) {
    try {
      const days=readLink(location.hash);
      root.querySelector('[data-period]').textContent=period(days);
      draw(root.querySelector('[data-days]'),days);
      root.querySelector('[data-actions]').hidden=false;
      actions(root,()=>days);
    } catch {
      root.querySelector('[data-period]').textContent='这条菜单链接不完整或已损坏，请让分享人重新发送。';
      root.querySelector('[data-days]').replaceChildren();
      root.querySelector('[data-actions]').hidden=true;
    }
  }
  return {open, showReceived};
})();
