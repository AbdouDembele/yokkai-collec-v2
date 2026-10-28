begin;
set local lock_timeout='3s';

-- Reuse the private exact-object receipts for every content deletion and sweeps.
alter table public.wall_reply_media_cleanup
  alter column user_id drop not null,
  add column content_type text,
  add column content_id uuid,
  add column created_at timestamptz not null default now();
create index wall_media_cleanup_content on public.wall_reply_media_cleanup(user_id,content_type,content_id);

create or replace function public.delete_wall_content_core(p_context_type text,p_context_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare item record; paths jsonb:='[]';
begin
  if p_context_type='wall_post' then
    select user_id,media_path into item from public.profile_wall_posts where id=p_context_id for update;
    if not found then return jsonb_build_object('alreadyDeleted',true,'mediaPaths','[]'::jsonb); end if;
    -- Lock replies before capturing the cascade, including concurrent deletes.
    perform 1 from public.wall_post_replies where post_id=p_context_id order by id for update;
    select coalesce(jsonb_agg(path),'[]'::jsonb) into paths from (
      select item.media_path path where item.media_path is not null
      union select media_path from public.wall_post_replies where post_id=p_context_id and media_path is not null
    ) files;
  elsif p_context_type='wall_reply' then
    select user_id,media_path into item from public.wall_post_replies where id=p_context_id for update;
    if not found then return jsonb_build_object('alreadyDeleted',true,'mediaPaths','[]'::jsonb); end if;
    if item.media_path is not null then paths:=jsonb_build_array(item.media_path); end if;
  else raise exception 'REPORT_INVALID'; end if;
  insert into public.wall_reply_media_cleanup(media_path,user_id,object_id,content_type,content_id,created_at)
    select o.name,auth.uid(),to_jsonb(o)->>'id',p_context_type,p_context_id,now()
    from storage.objects o where o.bucket_id='profile-wall-media' and o.name in (select jsonb_array_elements_text(paths))
      and to_jsonb(o)->>'id' is not null
    on conflict(media_path) do update set user_id=excluded.user_id,object_id=excluded.object_id,
      content_type=excluded.content_type,content_id=excluded.content_id,created_at=excluded.created_at;
  if p_context_type='wall_post' then delete from public.profile_wall_posts where id=p_context_id;
  else delete from public.wall_post_replies where id=p_context_id; end if;
  return jsonb_build_object('alreadyDeleted',false,'mediaPaths',paths,'authorId',item.user_id,'mediaPath',item.media_path);
end; $$;

-- Keep the existing argument AND text return type: JSON text extends the old
-- scalar path without dropping the RPC or any dependent privileges.
create or replace function public.delete_profile_wall_post(p_id uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  if not public.can_read_profile_wall(auth.uid()) then raise exception 'WALL_UNAVAILABLE'; end if;
  perform 1 from public.profile_wall_posts where id=p_id and user_id=auth.uid() for update;
  if found then result:=public.delete_wall_content_core('wall_post',p_id);
  else
    if exists(select 1 from public.profile_wall_posts where id=p_id) then raise exception 'WALL_POST_NOT_FOUND'; end if;
    select jsonb_build_object('alreadyDeleted',true,'mediaPaths',coalesce(jsonb_agg(media_path),'[]'::jsonb)) into result
      from public.wall_reply_media_cleanup where user_id=auth.uid() and content_type='wall_post' and content_id=p_id;
  end if;
  return result::text;
end; $$;

-- Missing bytes are already clean, including idempotent retries.
create or replace function public.authorize_wall_reply_media_cleanup(p_path text) returns text
language plpgsql stable security definer set search_path='' as $$
declare receipt public.wall_reply_media_cleanup%rowtype; current_id text;
begin
  if auth.uid() is null or not public.wall_actor_visible(auth.uid()) then raise exception 'AUTH_REQUIRED'; end if;
  select to_jsonb(o)->>'id' into current_id from storage.objects o where o.bucket_id='profile-wall-media' and o.name=p_path;
  if not found then return null; end if;
  select * into receipt from public.wall_reply_media_cleanup where media_path=p_path
    and (user_id=auth.uid() or (public.is_current_user_admin() and content_type in ('wall_post','wall_reply')));
  if not found or current_id is distinct from receipt.object_id
    or exists(select 1 from public.profile_wall_posts where media_path=p_path)
    or exists(select 1 from public.wall_post_replies where media_path=p_path) then raise exception 'WALL_MEDIA_INVALID'; end if;
  return p_path;
end; $$;

-- Prevent republishing or re-uploading an object while privileged cleanup is in
-- flight. Publication and sweep claiming use the same existing binding lock.
create function public.guard_wall_media_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
declare path text;
begin
  if tg_table_schema='storage' then
    if new.bucket_id<>'profile-wall-media' then return new; end if;
    path:=new.name;
  else path:=new.media_path; end if;
  if path is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('wall-media-binding:'||path,0));
  if exists(select 1 from public.wall_reply_media_cleanup where media_path=path) then raise exception 'WALL_MEDIA_INVALID'; end if;
  return new;
end; $$;
create trigger wall_post_cleanup_guard before insert or update of media_path on public.profile_wall_posts
  for each row execute function public.guard_wall_media_cleanup();
create trigger wall_reply_cleanup_guard before insert or update of media_path on public.wall_post_replies
  for each row execute function public.guard_wall_media_cleanup();
create trigger wall_storage_cleanup_guard before insert or update of name,bucket_id on storage.objects
  for each row execute function public.guard_wall_media_cleanup();
-- Remove obsolete pre-migration capabilities, never storage metadata/bytes.
-- New receipts also fence same-path uploads after deletion: UUID paths are
-- single-use, preventing a concurrent cleanup from deleting a recreated file.
delete from public.wall_reply_media_cleanup c where not exists(select 1 from storage.objects o
  where o.bucket_id='profile-wall-media' and o.name=c.media_path and to_jsonb(o)->>'id'=c.object_id);

-- Server/operator only, bounded name cursor. A receipt is an in-flight lease
-- for 24h; a crashed cleanup is then reclaimable, not exempted forever.
create function public.get_orphan_wall_media(p_after text default null,p_claim boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare item record; items jsonb:='[]'; last_name text; current_id text;
begin
  for item in select o.name,to_jsonb(o)->>'id' object_id,
      case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,15}$' then (to_jsonb(o)->'metadata'->>'size')::bigint else 0 end bytes
    from storage.objects o where o.bucket_id='profile-wall-media'
      and (p_after is null or o.name>p_after)
      and (to_jsonb(o)->>'created_at')::timestamptz < now()-interval '24 hours'
      and to_jsonb(o)->>'id' is not null
      and not exists(select 1 from public.profile_wall_posts p where p.media_path=o.name)
      and not exists(select 1 from public.wall_post_replies r where r.media_path=o.name)
      and not exists(select 1 from public.wall_reply_media_cleanup c where c.media_path=o.name
        and c.object_id=to_jsonb(o)->>'id' and c.created_at>now()-interval '24 hours')
    order by o.name limit 1000
  loop
    last_name:=item.name;
    if p_claim then
      perform pg_advisory_xact_lock(hashtextextended('wall-media-binding:'||item.name,0));
      select to_jsonb(o)->>'id' into current_id from storage.objects o
        where o.bucket_id='profile-wall-media' and o.name=item.name for update;
      if not found or current_id is distinct from item.object_id
        or exists(select 1 from public.profile_wall_posts where media_path=item.name)
        or exists(select 1 from public.wall_post_replies where media_path=item.name)
        or exists(select 1 from public.wall_reply_media_cleanup where media_path=item.name and object_id=current_id
          and created_at>now()-interval '24 hours') then continue; end if;
      insert into public.wall_reply_media_cleanup(media_path,user_id,object_id,created_at)
        values(item.name,null,item.object_id,now()) on conflict(media_path) do update
        set user_id=null,object_id=excluded.object_id,content_type=null,content_id=null,created_at=excluded.created_at;
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('name',item.name,'bytes',item.bytes));
  end loop;
  return jsonb_build_object('items',items,'next',last_name);
end; $$;
revoke all on function public.delete_wall_content_core(text,uuid),public.guard_wall_media_cleanup(),
  public.delete_profile_wall_post(uuid),public.get_orphan_wall_media(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.delete_profile_wall_post(uuid) to authenticated;
grant execute on function public.get_orphan_wall_media(text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
