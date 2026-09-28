-- Apply once in the Supabase SQL editor. All writes go through guarded RPCs.
create schema if not exists margin_private;
revoke all on schema margin_private from public, anon, authenticated;
create type public.note_state as enum ('private','pending','approved','rejected');
create table public.articles (
 id text primary key, title text not null, sections jsonb not null,
 updated_at timestamptz not null default now()
);
create table margin_private.moderators (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.blocked_users (
 user_id uuid primary key references auth.users(id) on delete cascade,
 blocked_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.annotations (
 id uuid primary key default gen_random_uuid(), article_id text not null references public.articles(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check (length(display_name) between 1 and 60 and display_name !~ '[<>@]'),
 body text not null check(length(btrim(body)) between 1 and 2000 and body !~ '<[^>]*>'),
 state public.note_state not null default 'pending', created_at timestamptz not null default now(),
 moderated_at timestamptz
);
create table public.annotation_anchors (
 annotation_id uuid primary key references public.annotations(id) on delete cascade,
 section_id text not null, exact text not null check(length(exact) between 1 and 2000),
 prefix text not null default '' check(length(prefix)<=64), suffix text not null default '' check(length(suffix)<=64),
 start_offset integer not null check(start_offset>=0), end_offset integer not null check(end_offset>start_offset),
 orphaned boolean not null default false
);
create table public.replies (
 id uuid primary key default gen_random_uuid(), annotation_id uuid not null references public.annotations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(length(display_name) between 1 and 60 and display_name !~ '[<>@]'),
 body text not null check(length(btrim(body)) between 1 and 1000 and body !~ '<[^>]*>'),
 state public.note_state not null default 'pending' check(state <> 'private'),
 created_at timestamptz not null default now(), moderated_at timestamptz
);
create table public.moderation_events (
 id bigint generated always as identity primary key,
 moderator_id uuid not null references auth.users(id), target_id uuid not null,
 action text not null, created_at timestamptz not null default now()
);
create table margin_private.submission_log (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null, created_at timestamptz not null default now()
);
create index on public.annotations(article_id, state, created_at);
create index on public.annotations(user_id);
create index on public.replies(annotation_id,state);
create index on margin_private.submission_log(user_id,created_at);

create function public.is_moderator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from margin_private.moderators where user_id=auth.uid());
$$;
revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to anon,authenticated;

alter table public.articles enable row level security;
alter table public.annotations enable row level security;
alter table public.annotation_anchors enable row level security;
alter table public.replies enable row level security;
alter table public.blocked_users enable row level security;
alter table public.moderation_events enable row level security;
alter table margin_private.moderators enable row level security;
alter table margin_private.submission_log enable row level security;
create policy article_read on public.articles for select to anon,authenticated using(true);
create policy note_read on public.annotations for select to anon,authenticated using(
 state='approved' or user_id=(select auth.uid()) or (state<>'private' and (select public.is_moderator()))
);
create policy anchor_read on public.annotation_anchors for select to anon,authenticated using(
 exists(select 1 from public.annotations n where n.id=annotation_id)
);
create policy reply_read on public.replies for select to anon,authenticated using(
 exists(select 1 from public.annotations n where n.id=annotation_id and n.state='approved')
 and (state='approved' or user_id=(select auth.uid()) or (select public.is_moderator()))
);
create policy blocked_read on public.blocked_users for select to authenticated using((select public.is_moderator()));
create policy events_read on public.moderation_events for select to authenticated using((select public.is_moderator()));
revoke all on public.articles,public.annotations,public.annotation_anchors,public.replies,public.blocked_users,public.moderation_events from anon,authenticated;
grant select on public.articles,public.annotations,public.annotation_anchors,public.replies to anon,authenticated;
grant select on public.blocked_users,public.moderation_events to authenticated;

-- Called inside the same transaction as every submission; the lock serializes per-user limits.
create function margin_private.check_submission(p_body text,p_name text,p_limit integer,p_fingerprint text,p_public boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in before saving a note.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_public and exists(select 1 from public.blocked_users where user_id=auth.uid()) then raise exception 'This account cannot submit public notes.'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and p_limit or p_body ~ '<[^>]*>' then raise exception 'Use plain text within the length limit.'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 60 or p_name ~ '[<>@]' then raise exception 'Use a display name, not an email address.'; end if;
 if (select count(*) from margin_private.submission_log where user_id=auth.uid() and created_at>now()-interval '1 hour')>=20
 or (select count(*) from margin_private.submission_log where user_id=auth.uid() and created_at>now()-interval '1 minute')>=5 then raise exception 'Too many submissions. Please try again later.'; end if;
 if exists(select 1 from margin_private.submission_log where user_id=auth.uid() and fingerprint=p_fingerprint and created_at>now()-interval '1 day') then raise exception 'This note was already submitted.'; end if;
 delete from margin_private.submission_log where user_id=auth.uid() and created_at<now()-interval '1 day';
 insert into margin_private.submission_log(user_id,fingerprint) values(auth.uid(),p_fingerprint);
end;
$$;
revoke all on function margin_private.check_submission(text,text,integer,text,boolean) from public,anon,authenticated;

create function public.create_annotation(p_article text,p_body text,p_name text,p_private boolean,p_anchor jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_text text; v_quote text; v_prefix text; v_suffix text; v_start integer; v_end integer;
begin
 if p_private is null or p_anchor is null then raise exception 'Choose a note visibility and passage.'; end if;
 v_quote:=p_anchor->>'exact'; v_prefix:=p_anchor->>'prefix'; v_suffix:=p_anchor->>'suffix';
 v_start:=(p_anchor->>'start')::integer; v_end:=(p_anchor->>'end')::integer;
 select sections->>(p_anchor->>'sectionId') into v_text from public.articles where id=p_article;
 if v_text is null or v_quote is null or length(btrim(v_quote)) not between 1 and 2000 or v_prefix is null or v_suffix is null
 or length(v_prefix)>64 or length(v_suffix)>64 or v_start is null or v_end is null or v_start<0 or v_end<=v_start
 or strpos(v_text,v_prefix||v_quote||v_suffix)=0 then raise exception 'The selected passage has changed. Please select it again.'; end if;
 perform margin_private.check_submission(p_body,p_name,2000,md5(p_article||v_quote||lower(regexp_replace(btrim(p_body),'\s+',' ','g'))),not p_private);
 insert into public.annotations(article_id,user_id,display_name,body,state)
 values(p_article,auth.uid(),btrim(p_name),btrim(p_body),case when p_private then 'private'::public.note_state else 'pending'::public.note_state end) returning id into v_id;
 insert into public.annotation_anchors(annotation_id,section_id,exact,prefix,suffix,start_offset,end_offset)
 values(v_id,p_anchor->>'sectionId',v_quote,v_prefix,v_suffix,v_start,v_end);
 return v_id;
end;
$$;

create function public.create_reply(p_annotation uuid,p_body text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 -- Lock the parent to serialize against removal by a moderator.
 perform 1 from public.annotations where id=p_annotation and state='approved' for share;
 if not found then raise exception 'This note is no longer open for replies.'; end if;
 perform margin_private.check_submission(p_body,p_name,1000,md5(p_annotation::text||lower(regexp_replace(btrim(p_body),'\s+',' ','g'))),true);
 insert into public.replies(annotation_id,user_id,display_name,body) values(p_annotation,auth.uid(),btrim(p_name),btrim(p_body)) returning id into v_id;
 return v_id;
end;
$$;

create function public.moderate(p_kind text,p_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_state public.note_state;
begin
 if not public.is_moderator() then raise exception 'Moderator access required.'; end if;
 if p_kind not in ('annotation','reply') or p_action not in ('approve','reject','delete') or p_kind is null or p_action is null then raise exception 'Invalid moderation action.'; end if;
 if p_kind='annotation' then
  select state into v_state from public.annotations where id=p_id for update;
  if v_state is null or v_state='private' then raise exception 'Note not available for moderation.'; end if;
  if p_action='delete' then delete from public.annotations where id=p_id;
  else update public.annotations set state=case when p_action='approve' then 'approved'::public.note_state else 'rejected'::public.note_state end,moderated_at=now() where id=p_id; end if;
 else
  select state into v_state from public.replies where id=p_id for update;
  if v_state is null then raise exception 'Reply not found.'; end if;
  if p_action='delete' then delete from public.replies where id=p_id;
  else update public.replies set state=case when p_action='approve' then 'approved'::public.note_state else 'rejected'::public.note_state end,moderated_at=now() where id=p_id; end if;
 end if;
 insert into public.moderation_events(moderator_id,target_id,action) values(auth.uid(),p_id,p_kind||':'||p_action);
end;
$$;

create function public.block_reader(p_user uuid,p_block boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_moderator() then raise exception 'Moderator access required.'; end if;
 if p_user=auth.uid() or p_user is null or p_block is null then raise exception 'Invalid user.'; end if;
 if p_block then insert into public.blocked_users(user_id,blocked_by) values(p_user,auth.uid()) on conflict(user_id) do nothing;
 else delete from public.blocked_users where user_id=p_user; end if;
 insert into public.moderation_events(moderator_id,target_id,action) values(auth.uid(),p_user,case when p_block then 'block' else 'unblock' end);
end;
$$;

create function public.mark_anchor(p_id uuid,p_orphaned boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_moderator() then raise exception 'Moderator access required.'; end if;
 update public.annotation_anchors set orphaned=p_orphaned where annotation_id=p_id and exists(select 1 from public.annotations where id=p_id and state<>'private');
end;
$$;

-- Includes replies whose parent was removed from publication; private notes are excluded.
create function public.moderation_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_moderator() then raise exception 'Moderator access required.'; end if;
 return jsonb_build_object(
 'annotations',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('anchor',to_jsonb(a)) order by n.created_at) from public.annotations n join public.annotation_anchors a on a.annotation_id=n.id where n.state<>'private'),'[]'::jsonb),
 'replies',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('parent_body',n.body,'parent_state',n.state,'anchor',to_jsonb(a)) order by r.created_at) from public.replies r join public.annotations n on n.id=r.annotation_id join public.annotation_anchors a on a.annotation_id=n.id),'[]'::jsonb),
 'blocked',coalesce((select jsonb_agg(to_jsonb(b)) from public.blocked_users b),'[]'::jsonb));
end;
$$;

revoke all on function public.create_annotation(text,text,text,boolean,jsonb),public.create_reply(uuid,text,text),public.moderate(text,uuid,text),public.block_reader(uuid,boolean),public.mark_anchor(uuid,boolean),public.moderation_queue() from public,anon;
grant execute on function public.create_annotation(text,text,text,boolean,jsonb),public.create_reply(uuid,text,text),public.moderate(text,uuid,text),public.block_reader(uuid,boolean),public.mark_anchor(uuid,boolean),public.moderation_queue() to authenticated;
