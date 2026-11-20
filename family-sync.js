/* Family QR extension. Personal cloud data is retained, never silently migrated. */
let activeFamily=null,familyBusy=false,familyTimer=null;
const familyVersionKey=()=>CLOUD_VERSION_KEY+'_family_'+activeFamily.family_id;
const personalRead=readCloudRow,personalWrite=writeCloudRow,personalVersion=scopedCloudVersionKey;
const personalRender=renderSyncPanel;
const familyDirtyKey=()=>CLOUD_VERSION_KEY+'_dirty_'+(cloudSession?.user?.id||'none');
const originalSchedule=scheduleCloudSync;
scheduleCloudSync=function(){try{localStorage.setItem(familyDirtyKey(),'1')}catch(e){}originalSchedule();};
function clearPendingCloudWrite(){try{localStorage.removeItem(familyDirtyKey())}catch(e){}}
const originalSync=syncNow;
syncNow=async function(fromDebounce=false,options){
  if(!cloudSyncEnabled){setSyncStatus('请先完成家庭或账号连接，再同步。');return;}
  const dirtyKey=familyDirtyKey();
  await originalSync(fromDebounce,options);
  if(dirtyKey===familyDirtyKey()&&!cloudDirty)clearPendingCloudWrite();
};

let pendingInvite=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
if(pendingInvite){history.replaceState(null,'',location.pathname+location.search);}
const familyPanel=document.createElement('section');
familyPanel.innerHTML=`<hr><h3>家庭空间 · 扫码互联</h3><p>创建家庭或扫描家人的邀请，菜单和点菜共享。每台设备独立身份；清除浏览器数据后需重新邀请。邀请仅交给家人。</p><div id="familyStatus" role="status"></div><div id="familyCreateArea"><input class="input" id="familyName" maxlength="50" value="我们家" aria-label="家庭名称"><button class="btn primary" id="familyCreate">创建家庭并复制本机菜单</button></div><div id="familyJoinArea"><input class="input" id="familyInviteInput" autocomplete="off" aria-label="邀请链接" placeholder="粘贴家庭邀请链接"><button class="btn" id="familyJoin">加入家庭</button><p>加入前会备份本机菜单，然后载入家庭菜单，不会上传本机旧菜单覆盖家庭。</p></div><div id="familyMemberArea" hidden><button class="btn" id="familyInvite">生成一次性邀请二维码</button><button class="btn" id="familyRevoke">撤销未使用邀请</button><div id="familyQr"></div><textarea id="familyInviteLink" readonly hidden aria-label="邀请链接"></textarea><div id="familyMembers"></div></div><p>已有邮箱账号可继续登录，作为管理员恢复入口。匿名管理员若失去全部设备，将无法自行恢复家庭；请保留数据备份。</p>`;
document.querySelector('#syncModal .sync-card').appendChild(familyPanel);
document.querySelector('#syncModal .sync-explain').textContent='家庭扫码共享菜单与点菜；也可使用下方邮箱入口恢复已有账号。';
const fe=id=>document.getElementById(id);
function familyStatus(t){fe('familyStatus').textContent=t;}
function familyRender(){renderOrderSync();fe('familyCreateArea').hidden=!!activeFamily;fe('familyJoinArea').hidden=!!activeFamily;fe('familyMemberArea').hidden=!activeFamily;fe('familyInvite').hidden=activeFamily?.role!=='owner';fe('familyRevoke').hidden=activeFamily?.role!=='owner';fe('familyMembers').replaceChildren();if(activeFamily){familyStatus(activeFamily.name+' · '+(activeFamily.role==='owner'?'管理员':'成员'));for(const m of activeFamily.members||[]){const row=document.createElement('div');row.textContent=(m.user_id===cloudSession?.user?.id?'此设备身份':m.user_id.slice(0,8))+' · '+m.role;if(activeFamily.role==='owner'&&m.role!=='owner'){const b=document.createElement('button');b.textContent='移除';b.className='btn small';b.onclick=()=>familyAction(async()=>{if(!confirm('移除此成员的云端访问？对方设备已下载的数据无法远程删除。'))return;await familyRpc('family_remove_member',{p_family_id:activeFamily.family_id,p_user_id:m.user_id});await loadFamily();});row.appendChild(b);}fe('familyMembers').appendChild(row);}}}
renderSyncPanel=function(options){personalRender(options);if(cloudSession?.user?.is_anonymous)fe('syncAccountLabel').textContent='本机独立身份';familyRender();};
scopedCloudVersionKey=function(){return activeFamily?familyVersionKey():personalVersion();};
async function familyRpc(name,args={}){const session=await ensureCloudSession();return cloudRequest('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)},session.access_token);}
readCloudRow=async function(session){if(!activeFamily)return personalRead(session);const row=await familyRpc('family_get');if(!row||row.family_id!==activeFamily.family_id)throw Error('家庭访问已撤销，请重新加入；本机数据保留');activeFamily={...activeFamily,...row};return {app_state:row.app_state,updated_at:row.updated_at};};
writeCloudRow=async function(session,version,payload){if(!activeFamily)return personalWrite(session,version,payload);const result=await familyRpc('family_sync',{p_family_id:activeFamily.family_id,p_expected_updated_at:version,p_state:payload});return result.updated_at;};
async function identity(){if(cloudSession?.refresh_token)return ensureCloudSession();const result=await cloudRequest('/auth/v1/signup',{method:'POST',body:'{}'},SUPABASE_ANON_KEY);if(!result.access_token||!result.refresh_token)throw Error('匿名登录未开启或需要人机验证，请先完成后台配置');result.expires_at=Math.floor(Date.now()/1000)+(result.expires_in||3600);saveCloudSession(result);return result;}
async function loadFamily(){activeFamily=await familyRpc('family_get');familyRender();return activeFamily;}
async function familyAction(fn){if(familyBusy)return;familyBusy=true;try{familyStatus('正在处理…');await fn();}catch(e){familyStatus('未完成：'+e.message+'。本机数据保留。');}finally{familyBusy=false;}}
function startFamilyPolling(){
  if(familyTimer)return;
  let nextPersonalPoll=Date.now()+45000;
  function syncWhenVisible(){
    if(document.visibilityState!=='visible')return;
    if(cloudSyncEnabled)syncNow();else if(!familyBusy&&cloudSession?.refresh_token)bootFamily();
  }
  familyTimer=setInterval(()=>{
    if(activeFamily||Date.now()>=nextPersonalPoll){
      nextPersonalPoll=Date.now()+45000;
      syncWhenVisible();
    }
  },10000);
  window.addEventListener('online',syncWhenVisible);
  window.addEventListener('pageshow',event=>{if(event.persisted)syncWhenVisible()});
  document.addEventListener('visibilitychange',syncWhenVisible);
}
fe('familyCreate').onclick=()=>familyAction(async()=>{if(cloudSyncBusy)throw Error('请等待当前同步完成');if(!confirm('将当前本机菜单复制到新家庭？原个人云端数据保持不变。'))return;backupLocalBeforeCloudReplace();cloudSyncEnabled=false;clearTimeout(cloudTimer);await identity();const existing=await loadFamily();if(existing)throw Error('当前身份已属于家庭，请重新打开同步面板');activeFamily=await familyRpc('family_create',{p_name:fe('familyName').value.trim()||'我们家',p_state:snapshotAppState()});recordOrderBase(activeFamily.app_state.orders||[]);persist({share:false});saveCloudVersion(activeFamily.updated_at);cloudDirty=false;clearPendingCloudWrite();cloudSyncEnabled=true;startFamilyPolling();await loadFamily();familyStatus('家庭已创建，可以邀请家人。');});
fe('familyJoin').onclick=()=>familyAction(async()=>{if(cloudSyncBusy)throw Error('请等待当前同步完成');let value=fe('familyInviteInput').value.trim()||pendingInvite;try{if(value.includes('#'))value=new URLSearchParams(new URL(value).hash.slice(1)).get('invite')||'';}catch(e){throw Error('邀请链接无效');}if(!/^[a-f0-9]{64}$/i.test(value))throw Error('邀请链接格式不正确');if(!confirm('加入后载入家庭菜单。本机现有菜单会先备份，不会覆盖家庭。继续？'))return;backupLocalBeforeCloudReplace();cloudSyncEnabled=false;clearTimeout(cloudTimer);await identity();const joined=await familyRpc('family_join',{p_token:value});activeFamily=joined;applyCloudState(joined.app_state,joined.updated_at);clearPendingCloudWrite();cloudSyncEnabled=true;pendingInvite='';fe('familyInviteInput').value='';startFamilyPolling();await loadFamily();familyStatus('已加入家庭并载入菜单。');});
fe('familyInvite').onclick=()=>familyAction(async()=>{if(location.protocol!=='https:')throw Error('请在正式 HTTPS 网站生成邀请');const invitation=await familyRpc('family_invite',{p_family_id:activeFamily.family_id});const url=new URL(location.href);url.hash='invite='+invitation.token;fe('familyInviteLink').value=url.href;fe('familyInviteLink').hidden=false;fe('familyQr').replaceChildren();if(typeof qrcode==='function'){const qr=qrcode(0,'M');qr.addData(url.href);qr.make();fe('familyQr').innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true});fe('familyQr').style.maxWidth='260px';}familyStatus('邀请有效至 '+new Date(invitation.expires_at).toLocaleTimeString()+'，仅可使用一次。仅发给家人。');});
fe('familyRevoke').onclick=()=>familyAction(async()=>{await familyRpc('family_revoke_invites',{p_family_id:activeFamily.family_id});fe('familyQr').replaceChildren();fe('familyInviteLink').value='';fe('familyInviteLink').hidden=true;familyStatus('未使用的邀请已撤销。');});
const oldSignOut=signOutCloud;signOutCloud=function(){if(cloudSession?.user?.is_anonymous&&!confirm('退出匿名身份后可能无法恢复，需要家人重新邀请。已导出数据备份吗？'))return;activeFamily=null;oldSignOut();familyRender();};fe('syncSignOut').onclick=signOutCloud;
async function verifyCloudCode(){const token=fe('syncCode').value.trim();if(!pendingSyncEmail||!token){setSyncStatus('请输入邮件验证码。');return;}try{cloudSyncEnabled=false;const session=await cloudRequest('/auth/v1/verify',{method:'POST',body:JSON.stringify({email:pendingSyncEmail,token,type:'email'})},SUPABASE_ANON_KEY);session.expires_at=Math.floor(Date.now()/1000)+(session.expires_in||3600);saveCloudSession(session);await loadFamily();cloudSyncEnabled=true;cloudDirty=false;await syncNow(false,{preferCloud:true});startFamilyPolling();}catch(e){setSyncStatus('登录或家庭信息加载失败：'+e.message);}}
fe('verifySyncCode').onclick=verifyCloudCode;
let bootingFamily=false;
async function bootFamily(){familyRender();if(pendingInvite){fe('familyInviteInput').value=pendingInvite;openSyncPanel();familyStatus('收到邀请，请点击加入家庭。');return;}if(!cloudSession?.refresh_token||bootingFamily)return;bootingFamily=true;try{await loadFamily();cloudDirty=localStorage.getItem(familyDirtyKey())==='1';cloudSyncEnabled=true;await syncNow();startFamilyPolling();}catch(e){cloudSyncEnabled=false;orderSyncPhase='failed';startFamilyPolling();renderOrderSync();familyStatus('暂时无法确认家庭信息，自动云同步已暂停，本机保存不受影响。联网后会自动重试：'+e.message);}finally{bootingFamily=false}}
window.addEventListener('online',()=>{if(!cloudSyncEnabled&&!familyBusy)bootFamily()});
bootFamily();
