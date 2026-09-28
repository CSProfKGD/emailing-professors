import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
const reader='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const moderator='00000000-0000-0000-0000-000000000003';
let db;
async function as(user, fn) {
 await db.exec(`set role ${user?'authenticated':'anon'};`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
 try { return await fn(); } finally { await db.exec('reset role'); }
}
async function rpc(name,args){const names=Object.keys(args);return (await db.query(`select public.${name}(${names.map((n,i)=>`${n}=>$${i+1}`).join(',')}) as result`,Object.values(args))).rows[0].result;}
const anchor={sectionId:'intro:0',exact:'specific',prefix:'Be ',suffix:' and genuine.',start:3,end:11};
const create=(body,priv=false)=>rpc('create_annotation',{p_article:'test',p_body:body,p_name:'A reader',p_private:priv,p_anchor:JSON.stringify(anchor)});
test('real PostgreSQL policies and guarded functions cover the reader/moderator lifecycle', async t=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated; insert into auth.users values('${reader}'),('${other}'),('${moderator}');`);
 await db.exec(await readFile('supabase/migrations/001_margin_notes.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/002_article.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/003_update_introduction.sql','utf8'));
 await db.query('insert into public.articles(id,title,sections) values($1,$2,$3)',['test','Test',JSON.stringify({'intro:0':'Be specific and genuine.'})]);
 await db.query('insert into margin_private.moderators values($1)',[moderator]);
 let privateId,pendingId,replyId;
 await t.test('anonymous writes rejected',async()=>{await assert.rejects(as(null,()=>create('Anonymous')));});
 await t.test('private notes only readable by creator, not other users or moderator',async()=>{
 privateId=await as(reader,()=>create('Private thoughts',true));
 for(const user of [null,other,moderator]) await as(user,async()=>{assert.equal((await db.query('select * from public.annotations where id=$1',[privateId])).rows.length,0);assert.equal((await db.query('select * from public.annotation_anchors where annotation_id=$1',[privateId])).rows.length,0);});
 await as(reader,async()=>assert.equal((await db.query('select * from public.annotations where id=$1',[privateId])).rows.length,1));
 });
 await t.test('pending notes visible to creator and moderator only',async()=>{
 pendingId=await as(reader,()=>create('A thoughtful question'));
 for(const user of [null,other]) await as(user,async()=>assert.equal((await db.query('select * from public.annotations where id=$1',[pendingId])).rows.length,0));
 await as(moderator,async()=>assert.equal((await db.query('select * from public.annotations where id=$1',[pendingId])).rows.length,1));
 });
 await t.test('direct writes and fake moderator actions fail',async()=>{
 await assert.rejects(as(reader,()=>db.query("update public.annotations set state='approved' where id=$1",[pendingId])));
 await assert.rejects(as(reader,()=>rpc('moderate',{p_kind:'annotation',p_id:pendingId,p_action:'approve'})));
 await assert.rejects(as(reader,()=>rpc('moderation_queue',{})));
 await assert.rejects(as(moderator,()=>rpc('moderate',{p_kind:'annotation',p_id:privateId,p_action:'approve'})));
 });
 await t.test('approval publishes note; replies wait for separate approval',async()=>{
 await as(moderator,()=>rpc('moderate',{p_kind:'annotation',p_id:pendingId,p_action:'approve'}));
 await as(null,async()=>assert.equal((await db.query('select * from public.annotations where id=$1',[pendingId])).rows.length,1));
 replyId=await as(other,()=>rpc('create_reply',{p_annotation:pendingId,p_body:'A relevant reply',p_name:'Another reader'}));
 await as(null,async()=>assert.equal((await db.query('select * from public.replies')).rows.length,0));
 await as(moderator,()=>rpc('moderate',{p_kind:'reply',p_id:replyId,p_action:'approve'}));
 await as(null,async()=>assert.equal((await db.query('select * from public.replies')).rows.length,1));
 });
 await t.test('HTML, overlong, email names, invalid anchors, and duplicate submissions rejected',async()=>{
 await assert.rejects(as(reader,()=>create('<script>alert(1)</script>')));
 await assert.rejects(as(reader,()=>create('x'.repeat(2001))));
 await assert.rejects(as(reader,()=>create('A thoughtful question')));
 await assert.rejects(as(reader,()=>rpc('create_annotation',{p_article:'test',p_body:'Bad anchor',p_name:'Name',p_private:false,p_anchor:JSON.stringify({...anchor,exact:'nonexistent'})})));
 await assert.rejects(as(reader,()=>rpc('create_annotation',{p_article:'test',p_body:'Email name',p_name:'reader@example.org',p_private:false,p_anchor:JSON.stringify(anchor)})));
 });
 await t.test('blocking prevents public notes and replies, private notes still work',async()=>{
 await as(moderator,()=>rpc('block_reader',{p_user:other,p_block:true}));
 await assert.rejects(as(other,()=>create('Blocked note')));
 await assert.rejects(as(other,()=>rpc('create_reply',{p_annotation:pendingId,p_body:'Blocked reply',p_name:'Reader'})));
 await as(other,()=>create('Still private',true));
 });
 await t.test('removal hides both parent and replies, moderator retains queue access',async()=>{
 await as(moderator,()=>rpc('moderate',{p_kind:'annotation',p_id:pendingId,p_action:'reject'}));
 await as(null,async()=>{assert.equal((await db.query('select * from public.annotations')).rows.length,0);assert.equal((await db.query('select * from public.replies')).rows.length,0);});
 const queue=await as(moderator,()=>rpc('moderation_queue',{}));assert.ok(queue.replies.some(r=>r.id===replyId));assert.ok(!queue.annotations.some(n=>n.id===privateId));
 });
 await t.test('rate limits are enforced in database and timestamps/user IDs are stored',async()=>{
 await db.exec('delete from margin_private.submission_log');
 for(let i=0;i<5;i++) await as(reader,()=>create(`Rate check ${i}`,true));
 await assert.rejects(as(reader,()=>create('Sixth note',true)),/Too many/);
 const row=(await db.query('select user_id,created_at from public.annotations where id=$1',[privateId])).rows[0];assert.equal(row.user_id,reader);assert.ok(row.created_at);
 });
 await t.test('orphan flag and deletion are moderator-only and cascade',async()=>{
 await assert.rejects(as(reader,()=>rpc('mark_anchor',{p_id:pendingId,p_orphaned:true})));
 await as(moderator,()=>rpc('mark_anchor',{p_id:pendingId,p_orphaned:true}));
 assert.equal((await db.query('select orphaned from public.annotation_anchors where annotation_id=$1',[pendingId])).rows[0].orphaned,true);
 await as(moderator,()=>rpc('moderate',{p_kind:'annotation',p_id:pendingId,p_action:'delete'}));
 assert.equal((await db.query('select * from public.replies where id=$1',[replyId])).rows.length,0);
 });
 await db.close();
});
