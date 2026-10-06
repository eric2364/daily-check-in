import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const entry = {date:'2026-10-05',intake:3,weight:70};
async function storage() { return import('../src/data'); }
beforeEach(()=>{vi.resetModules(); globalThis.indexedDB=new IDBFactory();});
describe('account journals and durable sync',()=>{
  it('retains guest records but isolates signed-in accounts',async()=>{
    const data=await storage();
    await data.saveEntry(entry);
    data.setActiveOwner('alice'); expect(await data.listEntries()).toEqual([]);
    await data.saveEntry({...entry,weight:80});
    data.setActiveOwner('bob'); expect(await data.listEntries()).toEqual([]);
    await data.saveEntry({...entry,weight:90});
    data.setActiveOwner('alice'); expect((await data.listEntries())[0].weight).toBe(80);
    data.setActiveOwner(null); expect(await data.listEntries()).toEqual([entry]);
  });
  it('persists pending edits and deletion tombstones',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice'), id=sent[0].pending!.mutation_id;
    await data.applyCloudResult('alice',sent,[{date:entry.date,entry,revision:id}],[id],[]);
    await data.deleteEntry(entry.date);
    expect(await data.listEntries()).toEqual([]);
    const record=(await data.cloudRecords('alice'))[0];
    expect(record.pending).toMatchObject({entry:null,base_revision:id});
    expect(record.pending!.mutation_id).not.toBe(id);
  });
  it('keeps concurrent edits when an earlier request succeeds',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice'), id=sent[0].pending!.mutation_id;
    await data.saveEntry({...entry,weight:71});
    await data.applyCloudResult('alice',sent,[{date:entry.date,entry,revision:id}],[id],[]);
    const next=(await data.cloudRecords('alice'))[0];
    expect(next.entry!.weight).toBe(71); expect(next.pending!.base_revision).toBe(id);
  });
  it('preserves local changes on conflict and resolves cloud selection',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice');
    await data.applyCloudResult('alice',sent,[{date:entry.date,entry:{...entry,weight:90},revision:'remote'}],[],[entry.date]);
    const conflict=(await data.cloudRecords('alice'))[0];
    expect(conflict.entry!.weight).toBe(70); expect(conflict.conflict!.entry!.weight).toBe(90);
    await data.resolveCloudConflict('alice',entry.date,'cloud');
    expect((await data.listEntries())[0].weight).toBe(90);
    expect((await data.cloudRecords('alice'))[0].pending).toBeUndefined();
  });
  it('explicit local conflict resolution targets the remote revision',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice');
    await data.applyCloudResult('alice',sent,[{date:entry.date,entry:null,revision:'deleted'}],[],[entry.date]);
    await data.resolveCloudConflict('alice',entry.date,'local');
    expect((await data.cloudRecords('alice'))[0].pending).toMatchObject({base_revision:'deleted',entry});
  });
  it('reapplying an acknowledged result is safe',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice'), id=sent[0].pending!.mutation_id;
    for(let i=0;i<2;i++) await data.applyCloudResult('alice',sent,[{date:entry.date,entry,revision:id}],[id],[]);
    expect(await data.listEntries()).toEqual([entry]);
    expect((await data.cloudRecords('alice'))[0].pending).toBeUndefined();
  });
  it('pending edits survive reopening the local database',async()=>{
    let data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const id=(await data.cloudRecords('alice'))[0].pending!.mutation_id;
    vi.resetModules(); data=await storage(); data.setActiveOwner('alice');
    expect((await data.cloudRecords('alice'))[0].pending!.mutation_id).toBe(id);
    expect(await data.listEntries()).toEqual([entry]);
  });
  it('keeps later edits based on the acknowledged revision even if another device has advanced',async()=>{
    const data=await storage(); data.setActiveOwner('alice'); await data.saveEntry(entry);
    const sent=await data.cloudRecords('alice'), id=sent[0].pending!.mutation_id;
    await data.saveEntry({...entry,weight:71});
    await data.applyCloudResult('alice',sent,[{date:entry.date,entry:{...entry,weight:90},revision:'newer-remote'}],[id],[]);
    await data.saveEntry({...entry,weight:72});
    expect((await data.cloudRecords('alice'))[0].pending!.base_revision).toBe(id);
  });
  it('sync engine acknowledges edits and deletion tombstones using the captured token',async()=>{
    const session={access_token:'alice-token',user:{id:'alice',email:'alice@example.com'}};
    const remote=new Map<string,{date:string;entry:typeof entry|null;revision:string}>();
    const headers:string[]=[];
    const rpc=vi.fn((_name:string,args:{p_operations:{date:string;entry:typeof entry|null;mutation_id:string}[]})=>({setHeader:vi.fn((_name:string,value:string)=>{
      headers.push(value);
      for(const op of args.p_operations) remote.set(op.date,{date:op.date,entry:op.entry,revision:op.mutation_id});
      return Promise.resolve({data:{records:[...remote.values()],conflicts:[],acknowledged:args.p_operations.map(op=>op.mutation_id)},error:null});
    })}));
    vi.doMock('../src/supabaseClient',()=>({supabase:{rpc,auth:{onAuthStateChange:vi.fn(),getSession:vi.fn().mockResolvedValue({data:{session},error:null})}}}));
    const cloud=await import('../src/cloud');await cloud.initializeCloud();
    await vi.waitFor(()=>expect(cloud.getCloudState().lastSyncedAt).not.toBeNull());
    const data=await storage();await data.saveEntry(entry);
    await vi.waitFor(()=>expect(remote.get(entry.date)?.entry).toEqual(entry));
    await vi.waitFor(()=>expect(cloud.getCloudState().pendingCount).toBe(0));
    await data.deleteEntry(entry.date);
    await vi.waitFor(()=>expect(remote.get(entry.date)?.entry).toBeNull());
    await vi.waitFor(()=>expect(cloud.getCloudState().pendingCount).toBe(0));
    expect(headers.every(value=>value === 'Bearer alice-token')).toBe(true);
    expect(await data.listEntries()).toEqual([]);
  });
  it('pins an in-flight request to its owner and ignores its result after account switching',async()=>{
    let session={access_token:'alice-token',user:{id:'alice',email:'alice@example.com'}};
    const headers:string[]=[];
    let finish:((value:unknown)=>void)|undefined;
    let sentId='';
    const rpc=vi.fn((_name:string,args:{p_operations:{mutation_id:string}[]})=>({setHeader:vi.fn((_name:string,value:string)=>{
      headers.push(value);
      if(args.p_operations.length) {sentId=args.p_operations[0].mutation_id;return new Promise(resolve=>{finish=resolve;});}
      return Promise.resolve({data:{records:[],conflicts:[],acknowledged:[]},error:null});
    })}));
    const auth={onAuthStateChange:vi.fn(),getSession:vi.fn(async()=>({data:{session},error:null})),signInWithPassword:vi.fn(async()=>{
      session={access_token:'bob-token',user:{id:'bob',email:'bob@example.com'}};
      return {data:{session},error:null};
    })};
    vi.doMock('../src/supabaseClient',()=>({supabase:{rpc,auth}}));
    const cloud=await import('../src/cloud');await cloud.initializeCloud();
    await vi.waitFor(()=>expect(cloud.getCloudState().lastSyncedAt).not.toBeNull());
    const data=await storage();await data.saveEntry(entry);
    await vi.waitFor(()=>expect(finish).toBeDefined());
    await cloud.signIn('bob@example.com','password');
    expect(data.getActiveOwner()).toBe('bob');
    finish!({data:{records:[{date:entry.date,entry,revision:sentId}],conflicts:[],acknowledged:[sentId]},error:null});
    await vi.waitFor(()=>expect(headers).toContain('Bearer bob-token'));
    await vi.waitFor(()=>expect(cloud.getCloudState().status).toBe('idle'));
    expect(await data.listEntries()).toEqual([]);
    expect((await data.cloudRecords('alice'))[0].pending!.mutation_id).toBe(sentId);
    expect(headers.filter(value=>value === 'Bearer alice-token')).toHaveLength(2);
  });
  it('network failure leaves the same durable mutation ready for retry',async()=>{
    const rpc=vi.fn().mockReturnValue({setHeader:vi.fn().mockResolvedValue({data:null,error:{message:'network failure'}})});
    vi.doMock('../src/supabaseClient',()=>({supabase:{rpc,auth:{onAuthStateChange:vi.fn(),getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'alice',email:'alice@example.com'}}},error:null})}}}));
    const cloud=await import('../src/cloud'); await cloud.initializeCloud();
    await vi.waitFor(()=>expect(cloud.getCloudState().status).toBe('error'));
    const data=await storage(); await data.saveEntry(entry);
    await vi.waitFor(()=>expect(cloud.getCloudState().pendingCount).toBe(1));
    const before=(await data.cloudRecords('alice'))[0].pending!.mutation_id;
    await cloud.syncNow();
    expect((await data.cloudRecords('alice'))[0].pending!.mutation_id).toBe(before);
    // Unref the scheduled retry by switching to signed-out state through mocked auth.
    vi.useFakeTimers(); vi.clearAllTimers(); vi.useRealTimers();
  });
});
