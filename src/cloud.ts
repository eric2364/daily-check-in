import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { setActiveOwner, getActiveOwner, cloudRecords, guestEntries, importEntries, applyCloudResult, resolveCloudConflict, subscribeData, type RemoteRecord } from './data';
import type { Entry } from './types';
export interface CloudState {
  configured: boolean; initialized: boolean; passwordRecovery:boolean; user: { id: string; email?: string } | null;
  status: 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error' | 'conflict';
  pendingCount: number; conflicts: {date:string;local:Entry|null;remote:Entry|null}[];
  error: string | null; lastSyncedAt: string | null; revision: number;
}
let state: CloudState = {configured:Boolean(supabase),initialized:false,passwordRecovery:false,user:null,status:'signed-out',pendingCount:0,conflicts:[],error:null,lastSyncedAt:null,revision:0};
const listeners = new Set<() => void>();
export function getCloudState() { return state; }
export function subscribeCloud(fn:()=>void) { listeners.add(fn); return ()=>{listeners.delete(fn);}; }
function publish(patch:Partial<CloudState>) { state={...state,...patch}; listeners.forEach(fn=>fn()); }
let initialized: Promise<void> | null = null;
let inFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let applying = false;
let generation = 0;
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
async function refresh(owner:string) {
  const rows=await cloudRecords(owner);
  if (state.user?.id !== owner) return;
  const conflicts=rows.filter(row=>row.conflict).map(row=>({date:row.date,local:row.entry,remote:row.conflict!.entry}));
  publish({pendingCount:rows.filter(row=>row.pending).length,conflicts,revision:state.revision+1});
}
function scheduleRetry() {
  clearTimeout(retryTimer);
  if(state.user && online()) retryTimer=setTimeout(()=>{void syncNow();},30000);
}
async function useSession(session:Session|null) {
  const user=session?.user && !session.user.is_anonymous ? {id:session.user.id,email:session.user.email} : null;
  if(state.initialized && state.user?.id === user?.id) return;
  generation++;
  clearTimeout(retryTimer);
  applying=true;
  try { setActiveOwner(user?.id ?? null); } finally { applying=false; }
  publish({user,initialized:true,passwordRecovery:false,status:user?'idle':'signed-out',pendingCount:0,conflicts:[],error:null,lastSyncedAt:null,revision:state.revision+1});
  if(user) { await refresh(user.id); void syncNow(); }
}
export function initializeCloud():Promise<void> {
  if(initialized) return initialized;
  initialized=(async()=>{
    subscribeData(()=>{
      if(applying) return;
      publish({revision:state.revision+1});
      if(state.user) { void refresh(state.user.id); void syncNow(); }
    });
    if(typeof window !== 'undefined') {
      window.addEventListener('online',()=>{void syncNow();});
      window.addEventListener('offline',()=>{if(state.user) publish({status:'offline'});});
      window.addEventListener('focus',()=>{void syncNow();});
    }
    if(!supabase) { publish({initialized:true}); return; }
    supabase.auth.onAuthStateChange((event,eventSession)=>{
      // Run outside Supabase's auth callback to avoid its auth lock deadlock.
      setTimeout(()=>{
        void supabase!.auth.getSession().then(async ({data})=>{
          await useSession(data.session);
          if(event === 'PASSWORD_RECOVERY' && eventSession?.user.id === data.session?.user.id && data.session?.user.id === state.user?.id) publish({passwordRecovery:true});
        });
      },0);
    });
    const {data,error}=await supabase.auth.getSession();
    if(error) { publish({initialized:true,error:error.message,status:'error'}); return; }
    if(!state.initialized) await useSession(data.session);
  })();
  return initialized;
}
function client() { if(!supabase) throw new Error('Cloud sync is not configured yet. Your local journal still works.'); return supabase; }
export async function signIn(email:string,password:string) {
  const {data,error}=await client().auth.signInWithPassword({email:email.trim(),password});
  if(error) throw new Error(error.message);
  await useSession(data.session);
}
export async function signUp(email:string,password:string):Promise<{confirmationRequired:boolean}> {
  const {data,error}=await client().auth.signUp({email:email.trim(),password,options:{emailRedirectTo:typeof location==='undefined'?undefined:location.origin+import.meta.env.BASE_URL}});
  if(error) throw new Error(error.message);
  if(data.session) await useSession(data.session);
  return {confirmationRequired:!data.session};
}
export async function resetPassword(email:string) {
  const {error}=await client().auth.resetPasswordForEmail(email.trim(),{redirectTo:typeof location==='undefined'?undefined:location.origin+import.meta.env.BASE_URL});
  if(error) throw new Error(error.message);
}
export async function updatePassword(password:string) {
  const {error}=await client().auth.updateUser({password});
  if(error) throw new Error(error.message);
  publish({passwordRecovery:false});
}
export async function signOut(force=false) {
  if(state.user) await refresh(state.user.id);
  if(!force && (state.pendingCount || state.conflicts.length)) throw new Error('Sync or export your pending entries and resolve conflicts before signing out.');
  const {error}=await client().auth.signOut({scope:'local'});
  if(error) throw new Error(error.message);
  await useSession(null);
  publish({passwordRecovery:false});
}
export async function syncNow():Promise<void> {
  if(inFlight) return inFlight;
  if(!state.user || !supabase) return;
  const owner=state.user.id, epoch=generation;
  if(!online()) { publish({status:'offline'}); return; }
  const task=(async()=>{
    publish({status:'syncing',error:null});
    try {
      const {data:auth,error:authError}=await supabase.auth.getSession();
      if(authError) throw authError;
      if(epoch !== generation || auth.session?.user.id !== owner) return;
      const records=await cloudRecords(owner);
      if(epoch !== generation) return;
      const pending=records.filter(row=>row.pending && !row.conflict);
      // Server bounds each request. Send at most 100, then continue until drained.
      const sent=pending.slice(0,100);
      const {data,error}=await supabase.rpc('journal_sync',{p_operations:sent.map(row=>row.pending)}).setHeader('Authorization',`Bearer ${auth.session.access_token}`);
      if(error) throw new Error(error.message);
      if(!data || !Array.isArray(data.records) || !Array.isArray(data.conflicts) || !Array.isArray(data.acknowledged)) throw new Error('Unexpected cloud response. Your pending entries remain saved locally.');
      if(epoch !== generation || owner !== getActiveOwner()) return;
      applying=true;
      try { await applyCloudResult(owner,sent,data.records as RemoteRecord[],data.acknowledged as string[],data.conflicts.map((row:RemoteRecord)=>row.date)); }
      finally { applying=false; }
      await refresh(owner);
      if(epoch !== generation) return;
      publish({status:state.conflicts.length?'conflict':'idle',lastSyncedAt:new Date().toISOString(),error:null});
    } catch(error) {
      if(epoch !== generation) return;
      await refresh(owner);
      publish({status:online()?'error':'offline',error:error instanceof Error?error.message:'Could not sync. Your entries are saved on this phone.'});
      scheduleRetry();
    }
  })();
  inFlight=task;
  await task;
  inFlight=null;
  // New local edits during the request and batches >100 are safely retried.
  if(state.user?.id === owner && (state.status === 'idle' || state.status === 'conflict') && state.pendingCount) {
    const remaining=await cloudRecords(owner);
    if(remaining.some(row=>row.pending && !row.conflict)) queueMicrotask(()=>{void syncNow();});
  }
  else if(state.user?.id !== owner && state.user) queueMicrotask(()=>{void syncNow();});
}
export async function getGuestEntries() { return guestEntries(); }
export async function copyGuestEntries() {
  if(!state.user) throw new Error('Sign in before copying local guest entries.');
  const owner=state.user.id, epoch=generation;
  const assertOwner=()=>{if(epoch !== generation || state.user?.id !== owner || getActiveOwner() !== owner) throw new Error('Your account changed. Please try copying entries again.');};
  // Avoid replacing any account record silently. Existing dates are reported for manual import.
  await syncNow();
  assertOwner();
  if(state.status === 'error' || state.status === 'offline') throw new Error('Connect and sync your account before copying guest entries.');
  const guest=await guestEntries(), account=await cloudRecords(owner);
  assertOwner();
  const dates=new Set(account.map(row=>row.date));
  const duplicates=guest.filter(entry=>dates.has(entry.date));
  if(duplicates.length) throw new Error(`The account already has ${duplicates.length} matching date(s). Export a backup and restore it explicitly to replace them, or edit those dates manually.`);
  await importEntries(guest);
  assertOwner();
  await syncNow();
}
export async function resolveConflict(date:string,choice:'local'|'remote') {
  if(!state.user) throw new Error('Sign in to resolve a conflict.');
  const owner=state.user.id,epoch=generation;
  await resolveCloudConflict(owner,date,choice==='remote'?'cloud':'local');
  if(epoch !== generation || state.user?.id !== owner) throw new Error('Your account changed. Please check the selected account before syncing.');
  await syncNow();
}
