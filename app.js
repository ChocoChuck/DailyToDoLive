'use strict';
const $ = s => document.querySelector(s);
const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const todayNY = () => dateFormatter.format(new Date());
const shiftDay = (s,n) => {const d = new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const yearAgo = s => {const d = new Date(s+'T12:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10);};
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg = window.TRACKER_CONFIG;
let client, currentUser, state, selectedDay, writeQueue = Promise.resolve(), uiEpoch=0;
const noteTimers = new Map();
const statusEl = $('#save-status');
const safeError = err => err?.message || 'Something went wrong';
function setStatus(text){statusEl.textContent=text;}
function ensureConfigured(){
  if(!window.supabase?.createClient) throw Error('Supabase library did not load. Check your internet connection.');
  if(!cfg?.url || !cfg?.publishableKey || cfg.url.includes('YOUR_PROJECT') || cfg.publishableKey.includes('YOUR_')) throw Error('Add your Supabase URL and publishable key to config.js first.');
  client=window.supabase.createClient(cfg.url,cfg.publishableKey);
}
async function unwrap(promise){const {data,error}=await promise;if(error)throw error;return data;}
function authMessage(text){$('#auth-message').textContent=text;}
function showAuth(){currentUser=null;state=null;$('#auth-panel').hidden=false;$('#dashboard').hidden=true;$('#password').value='';}
async function showDashboard(user){
  currentUser=user;$('#auth-panel').hidden=true;$('#dashboard').hidden=false;$('#user-email').textContent=user.email||'Signed in';
  try{await load(todayNY());}catch(err){setStatus('Load failed');alert(safeError(err));}
}
async function load(day){
  if(!currentUser)return;
  const epoch=++uiEpoch;
  const today=todayNY();const earliest=yearAgo(today);
  if(!day||day>today||day<earliest)day=today;
  setStatus('Loading…');
  // All-time history includes dates before the one-year edit window.
  const [profile,goals]=await Promise.all([
    unwrap(client.from('tracker_profiles').select('started_on').eq('user_id',currentUser.id).single()),
    unwrap(client.from('tracker_goals').select('id,name,created_on,archived_on').eq('user_id',currentUser.id).order('created_on',{ascending:true}))
  ]);
  const start=profile.started_on<today?profile.started_on:today;
  // Supabase/PostgREST defaults to max 1,000 rows per response; page to avoid losing historical records.
  const entries=[];const pageSize=500;
  for(let offset=0;;offset+=pageSize){
    const page=await unwrap(client.from('tracker_entries').select('goal_id,day,completed,note')
      .eq('user_id',currentUser.id).gte('day',start).lte('day',today)
      .order('day',{ascending:true}).order('goal_id',{ascending:true}).range(offset,offset+pageSize-1));
    entries.push(...page);
    if(page.length<pageSize)break;
  }
  if(epoch!==uiEpoch||!currentUser)return;
  state={today,earliest,start,goals,entries};selectedDay=day;
  $('#day-picker').min=earliest;$('#day-picker').max=today;$('#day-picker').value=day;
  setStatus('Saved');render();
}
function active(g,day){return g.created_on<=day && (!g.archived_on||day<g.archived_on);}
function dayTasks(day){
  return state.goals.filter(g=>active(g,day)).map(g=>{
    const entry=state.entries.find(e=>e.day===day&&e.goal_id===g.id);
    return {...g,completed:!!entry?.completed,note:entry?.note||'',archived:!!g.archived_on};
  });
}
function history(){
  const byDay=new Map();
  for(const e of state.entries){if(e.completed){if(!byDay.has(e.day))byDay.set(e.day,new Set());byDay.get(e.day).add(e.goal_id);}}
  const out=[];
  for(let day=state.today;day>=state.start;day=shiftDay(day,-1)){
    const eligible=state.goals.filter(g=>active(g,day));
    const completed=eligible.filter(g=>byDay.get(day)?.has(g.id)).length;
    out.push({day,completed,total:eligible.length,percent:eligible.length?Math.round(completed/eligible.length*1000)/10:0});
  }
  return out;
}
function percent(n){return (Math.round(n*10)/10).toString()+'%';}
function avg(items,count){const days=items.slice(0,count);return days.length?percent(days.reduce((n,h)=>n+h.percent,0)/days.length):'0%';}
function renderStats(){
  const rows=history();
  const types=[['7-day',7],['30-day',30],['6-month',183],['1-year',365],['All-time',rows.length]];
  $('#averages').innerHTML=types.map(([label,n])=>`<div class="average"><span>${label} average</span><strong>${avg(rows,n)}</strong><span>Daily completion</span></div>`).join('');
  $('#history').innerHTML=rows.map(h=>`<button type="button" class="history-row ${h.day===selectedDay?'selected':''}" data-day="${h.day}" ${h.day<state.earliest?'disabled title="Older than one year: read only"':''}><strong>${h.day}${h.day===state.today?' · Today':''}</strong><span>${h.completed}/${h.total} goals</span><span class="percent">${percent(h.percent)}</span></button>`).join('');
}
function updateScore(){
  const tasks=dayTasks(selectedDay);const completed=tasks.filter(t=>t.completed).length;
  const score=tasks.length?Math.round(completed/tasks.length*1000)/10:0;
  $('#score').textContent=percent(score);
  $('#count').textContent=`${completed} of ${tasks.length} goals completed`;
  $('#bar').style.width=score+'%';
}
function render(){
  const isToday=selectedDay===state.today;
  $('#date').textContent=new Date(selectedDay+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('#view-label').textContent=isToday?"TODAY'S COMPLETION":'COMPLETION FOR SELECTED DAY';
  $('#goals-label').textContent=isToday?"Today's goals":`Goals for ${selectedDay}`;
  $('#today-button').disabled=isToday;
  $('#add-goal-form').hidden=!isToday;
  $('#tasks').innerHTML=dayTasks(selectedDay).map(t=>`<article class="task ${t.completed?'done':''}" data-id="${t.id}">
    <button class="check" type="button" aria-label="Toggle ${escapeHTML(t.name)}" aria-pressed="${t.completed}">${t.completed?'✓':''}</button>
    <div class="task-content"><div class="task-heading"><div class="task-title">${escapeHTML(t.name)}${t.archived?' <span class="archived-label">Archived</span>':''}</div>
    ${isToday&&!t.archived?'<button class="archive" type="button" title="Archive goal and keep history">Delete goal</button>':''}</div>
    <textarea maxlength="3000" placeholder="Add a note for this date…">${escapeHTML(t.note)}</textarea>
    <div class="note-status">Notes save automatically</div></div></article>`).join('')||'<p class="empty">There were no active goals on this date.</p>';
  updateScore();renderStats();
}
function pendingTask(goalId,day){const g=state?.goals.find(x=>x.id===goalId);if(!g)return null;const e=state.entries.find(x=>x.goal_id===goalId&&x.day===day);return {goal_id:goalId,day,completed:e?.completed||false,note:e?.note||''};}
function setLocal(task){
  const index=state.entries.findIndex(e=>e.goal_id===task.goal_id&&e.day===task.day);
  if(index<0)state.entries.push({...task});else state.entries[index]={...task};
}
function enqueueSave(task){
  const payload={p_goal_id:task.goal_id,p_day:task.day,p_completed:task.completed,p_note:task.note};
  writeQueue=writeQueue.catch(()=>{}).then(async()=>{
    setStatus('Saving…');
    await unwrap(client.rpc('tracker_save_entry',payload));
    setStatus('Saved');
  });
  writeQueue.catch(err=>{setStatus('Save failed');alert(safeError(err));});
  return writeQueue;
}
function flushNotes(){
  for(const [id,timer] of noteTimers){clearTimeout(timer);const task=pendingTask(id,selectedDay);if(task)enqueueSave(task);}
  noteTimers.clear();
}
async function changeDay(day){
  flushNotes();try{await writeQueue;await load(day);}catch(err){alert(safeError(err));if(state)$('#day-picker').value=selectedDay;}
}
$('#tasks').addEventListener('click',async e=>{
  const article=e.target.closest('.task');if(!article||!state)return;
  const id=article.dataset.id;
  const goal=state.goals.find(g=>g.id===id);
  if(e.target.closest('.archive')){
    if(!confirm(`Delete "${goal.name}" from current goals? Past checkmarks and notes remain saved.`))return;
    flushNotes();try{await writeQueue;await unwrap(client.rpc('tracker_archive_goal',{p_goal_id:id}));await load(selectedDay);}catch(err){alert(safeError(err));}return;
  }
  if(!e.target.closest('.check'))return;
  if(noteTimers.has(id)){clearTimeout(noteTimers.get(id));noteTimers.delete(id);}
  const task=pendingTask(id,selectedDay);if(!task)return;
  task.completed=!task.completed;setLocal(task);render();
  enqueueSave(task).then(()=>{if(state){renderStats();}}).catch(()=>{});
});
$('#tasks').addEventListener('input',e=>{
  if(!e.target.matches('textarea')||!state)return;
  const id=e.target.closest('.task').dataset.id;
  const day=selectedDay;const task=pendingTask(id,day);if(!task)return;
  task.note=e.target.value;setLocal(task);
  if(noteTimers.has(id))clearTimeout(noteTimers.get(id));
  noteTimers.set(id,setTimeout(()=>{noteTimers.delete(id);const current=pendingTask(id,day);if(current)enqueueSave(current);},550));
});
$('#add-goal-form').addEventListener('submit',async e=>{
  e.preventDefault();const input=$('#new-goal');const name=input.value.trim();if(!name)return;
  flushNotes();try{await writeQueue;await unwrap(client.rpc('tracker_add_goal',{p_name:name}));input.value='';await load(selectedDay);}catch(err){alert(safeError(err));}
});
$('#day-picker').addEventListener('change',()=>changeDay($('#day-picker').value));
$('#today-button').addEventListener('click',()=>changeDay(todayNY()));
$('#history').addEventListener('click',e=>{const row=e.target.closest('[data-day]');if(row&&!row.disabled)changeDay(row.dataset.day);});
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault();authMessage('Signing in…');try{
    const {data,error}=await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;authMessage('');await showDashboard(data.user);
  }catch(err){authMessage(safeError(err));}
});
$('#sign-up').addEventListener('click',async()=>{
  if(!$('#auth-form').reportValidity())return;
  authMessage('Creating account…');try{
    const {data,error}=await client.auth.signUp({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;
    if(data.session&&data.user){authMessage('');await showDashboard(data.user);}
    else authMessage('Account request submitted. Check your email for a confirmation link, then log in.');
  }catch(err){authMessage(safeError(err));}
});
$('#sign-out').addEventListener('click',async()=>{
  flushNotes();try{await writeQueue;await unwrap(client.auth.signOut());showAuth();}catch(err){alert(safeError(err));}
});
async function boot(){
  try{
    ensureConfigured();
    const {data,error}=await client.auth.getUser();if(error&&error.name!=='AuthSessionMissingError')throw error;
    if(data?.user)await showDashboard(data.user);else showAuth();
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){++uiEpoch;showAuth();}
      // Auth INITIAL_SESSION is handled above; login/signup handlers directly show dashboard.
    });
  }catch(err){$('#auth-panel').hidden=false;authMessage(safeError(err));$('#sign-in').disabled=true;$('#sign-up').disabled=true;}
}
setInterval(()=>{
  if(!state||!currentUser)return;
  if(todayNY()!==state.today){const wasToday=selectedDay===state.today;changeDay(wasToday?todayNY():selectedDay);}
},20000);
boot();
