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
    const bytes = new TextEncoder().encode(JSON.stringify([2,days]));
    const base = location.protocol === 'file:' ? new URL(livePage) : new URL('share.html', location.href);
    base.hash = btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    return base.href;
  }
  function readLink(hash) {
    const code = hash.slice(1);
    if (!/^[A-Za-z0-9_-]{1,16000}$/.test(code)) throw Error('invalid link');
    const bytes = Uint8Array.from(atob(code.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    if (!Array.isArray(payload) || payload.length !== 2 || ![1,2].includes(payload[0])) throw Error('unknown format');
    const days = payload[1];
    if (!Array.isArray(days) || ![1,5].includes(days.length)) throw Error('invalid menu');
    let previous = 0;
    for (const row of days) {
      if (!Array.isArray(row) || row.length !== 4 || typeof row[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) throw Error('invalid day');
      const date = new Date(row[0] + 'T12:00:00Z');
      if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== row[0] || ![1,2,3,4,5].includes(date.getUTCDay()) || (previous && +date - previous !== 86400000)) throw Error('invalid date');
      for(let i=1;i<=3;i++){
        const dish=payload[0]===1?[row[i],'']:row[i];
        if(!Array.isArray(dish)||dish.length!==2||typeof dish[0]!=='string'||!dish[0].trim()||dish[0].length>60||typeof dish[1]!=='string'||(dish[1]&&!pictureSource(dish[1])))throw Error('invalid dish');
        row[i]=dish;
      }
      previous = +date;
    }
    return days;
  }
  // Snapshots contain only a known local image key and, for a sheet, its tile number.
  function pictureSource(key) {
    if(['beefRadishStew','garlicEnoki','blanchedOkra'].includes(key))return {url:'assets/dishes/dish-'+key+'.jpg',grid:1,x:0,y:0};
    const match=/^(meat[ABCDEG]?|soup[ABC]?|veg[ABC]|vegetable):([0-8])$/.exec(key);
    if(!match)return null;
    const tile=Number(match[2]);
    return {url:'assets/dishes/sheet-'+match[1]+'.jpg',grid:3,x:tile%3,y:Math.floor(tile/3)};
  }
  function thumbnail(source) {
    const frame=document.createElement('span'), img=new Image();
    frame.className='share-thumbnail';
    img.alt='';img.src=source.url;
    const zoom=source.grid===3?1.16:1;
    img.style.width=img.style.height=(100*source.grid*zoom)+'%';
    img.style.left=(-100*source.x*zoom-50*(zoom-1))+'%';
    img.style.top=(-100*source.y*zoom-50*(zoom-1))+'%';
    img.onerror=()=>{frame.hidden=true};
    frame.append(img);
    return frame;
  }
  function draw(list, days) {
    list.replaceChildren(...days.map(([date,...names]) => {
      const card = document.createElement('article');
      card.className = 'share-day';
      card.append(element('h3',dateLabel(date,true)));
      const dl = document.createElement('dl');
      names.forEach(([name,key],i) => {
        const detail=element('dd',''), source=pictureSource(key);
        detail.append(element('span',name));
        if(source)detail.append(thumbnail(source));
        dl.append(element('dt',labels[i]),detail);
      });
      card.append(dl);
      return card;
    }));
  }
  function plainText(days) {
    return '家庭菜单 · ' + period(days) + '\n\n' + days.map(([date,...names]) =>
      [dateLabel(date,true),...names.map(([name],i) => labels[i] + '：' + name)].join('\n')).join('\n\n');
  }
  async function createPoster(days) {
    const width=760, canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
    if(!ctx)throw Error('canvas unavailable');
    const font='-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    const images=new Map();
    const sections=days.map(([date,...dishes])=>({
      date, dishes:dishes.map(([name,key],i)=>{
        const source=pictureSource(key);
        if(source&&!images.has(source.url)){
          const img=new Image();img.src=source.url;
          images.set(source.url,img);
        }
        ctx.font='600 28px '+font;
        const lines=[];
        let line='';
        for(const char of name){
          if(line&&ctx.measureText(line+char).width>510){lines.push(line);line=''}
          line+=char;
        }
        lines.push(line);
        return {source,lines,label:labels[i],height:Math.max(110,56+lines.length*36)};
      })
    }));
    await Promise.all([...images.values()].map(img=>img.decode()));
    canvas.width=width;
    canvas.height=144+sections.reduce((h,s)=>h+80+s.dishes.reduce((sum,d)=>sum+d.height,0),0);
    ctx.fillStyle='#f5f7fb';ctx.fillRect(0,0,width,canvas.height);
    ctx.textBaseline='top';
    function text(value,x,y,style,color){ctx.font=style+' '+font;ctx.fillStyle=color;ctx.fillText(value,x,y)}
    text('家庭菜单',32,28,'700 42px','#192636');
    text(period(days),34,84,'24px','#455975');
    let y=124;
    for(const section of sections){
      const height=56+section.dishes.reduce((sum,d)=>sum+d.height,0);
      ctx.fillStyle='white';ctx.fillRect(24,y,width-48,height);
      text(dateLabel(section.date,true),44,y+15,'600 26px','#174984');
      y+=56;
      for(const dish of section.dishes){
        const s=dish.source, x=s?168:46;
        if(s){
          const img=images.get(s.url), tw=img.naturalWidth/s.grid, th=img.naturalHeight/s.grid;
          // Leave the thin separator around each tile out of the poster.
          const side=Math.min(tw,th)/(s.grid===3?1.16:1);
          ctx.drawImage(img,s.x*tw+(tw-side)/2,s.y*th+(th-side)/2,side,side,46,y+6,94,94);
        }
        text(dish.label,x,y+12,'21px','#536782');
        dish.lines.forEach((line,i)=>text(line,x,y+44+i*36,'600 28px','#192636'));
        y+=dish.height;
      }
      y+=24;
    }
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('export failed')),'image/png'));
  }
  function posterActions(root,getDays,feedback) {
    // Also release the previous dialog session when reopening or forwarding a different hash.
    if(root.releasePoster)root.releasePoster();
    const button=root.querySelector('[data-picture]'),tools=root.querySelector('[data-poster]'),
      download=root.querySelector('[data-download]'),send=root.querySelector('[data-file-share]');
    let generation=0,objectURL='';
    const reset=()=>{
      generation++;
      if(objectURL)URL.revokeObjectURL(objectURL);
      objectURL='';tools.hidden=true;send.hidden=true;send.onclick=null;
      download.removeAttribute('href');download.removeAttribute('download');
      download.textContent='保存长图';button.disabled=false;button.textContent='生成长图';
    };
    root.releasePoster=reset;
    if(root.tagName==='DIALOG')root.onclose=reset;
    button.onclick=async()=>{
      const job=++generation, days=getDays();
      button.disabled=true;button.textContent='生成中…';feedback.textContent='';
      try{
        const blob=await createPoster(days);
        if(job!==generation)return;
        objectURL=URL.createObjectURL(blob);
        const filename='家庭菜单-'+days[0][0]+'.png';
        download.href=objectURL;download.download=filename;
        tools.hidden=false;button.textContent='长图已生成';
        const file=new File([blob],filename,{type:blob.type});
        if(navigator.canShare?.({files:[file]})){
          send.hidden=false;
          send.onclick=async()=>{
            try{await navigator.share({files:[file]})}
            catch(error){if(error.name!=='AbortError')feedback.textContent='请点「保存长图」后发送。'}
          };
        }
      }catch{
        if(job!==generation)return;
        button.disabled=false;button.textContent='重新生成长图';
        if(location.protocol==='file:'){
          tools.hidden=false;download.textContent='打开网页版生成长图';
          download.href=makeLink(days);feedback.textContent='当前浏览器限制本地图片导出，可在网页版生成。';
        }else feedback.textContent='图片未能加载，请稍后再试。';
      }
    };
    return reset;
  }
  function actions(root, getDays) {
    const primary=root.querySelector('[data-send]'), copyLink=root.querySelector('[data-link]'),
      feedback=root.querySelector('[data-feedback]'), manual=root.querySelector('[data-manual]');
    const reset=()=>{feedback.textContent='';manual.hidden=true;manual.value=''};
    const resetPoster=posterActions(root,getDays,feedback);
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
    return ()=>{reset();resetPoster()};
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
      actions(root,()=>days)();
    } catch {
      root.releasePoster?.();
      root.querySelector('[data-period]').textContent='这条菜单链接不完整或已损坏，请让分享人重新发送。';
      root.querySelector('[data-days]').replaceChildren();
      root.querySelector('[data-actions]').hidden=true;
    }
  }
  return {open, showReceived};
})();
